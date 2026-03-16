// ===========================================
// web-runner.js - Web版チェック実行エンジン (SSE対応)
// ===========================================
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Checkers (symlink経由)
import { checkHtml } from './checkers/html-validator.js';
import { checkSeo } from './checkers/seo-checker.js';
import { checkLinks } from './checkers/link-checker.js';
import { checkImages } from './checkers/image-checker.js';
import { checkConsole } from './checkers/console-checker.js';
import { checkResponsive } from './checkers/responsive-checker.js';
import { checkForm } from './checkers/form-checker.js';
import { checkPerformance } from './checkers/performance-checker.js';
import { checkFavicon } from './checkers/favicon-checker.js';
import { checkOgp } from './checkers/ogp-checker.js';
import { checkWordPress } from './checkers/wp-checker.js';
import { checkDummy } from './checkers/dummy-checker.js';
import { checkIndex } from './checkers/index-checker.js';
import { checkDevices } from './checkers/device-checker.js';
import { checkAnalytics } from './checkers/analytics-checker.js';
import { checkAssets } from './checkers/asset-checker.js';
import { checkSchema } from './checkers/schema-checker.js';
import { checkSecurity } from './checkers/security-checker.js';

/**
 * Scroll through page to trigger IntersectionObserver animations
 */
async function triggerAnimations(page) {
  await page.evaluate(async () => {
    const scrollHeight = document.body.scrollHeight;
    const viewportHeight = window.innerHeight;
    const scrollStep = viewportHeight * 0.7;
    for (let y = 0; y < scrollHeight; y += scrollStep) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 100));
    }
    window.scrollTo(0, scrollHeight);
    await new Promise(r => setTimeout(r, 300));
    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.opacity === '0') el.style.opacity = '1';
      if (style.visibility === 'hidden') el.style.visibility = 'visible';
      if (style.transform && style.transform.includes('translateY')) el.style.transform = 'none';
    });
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 200));
  });
}

/**
 * Run a single checker with progress notification
 */
async function runChecker(name, fn, emit) {
  emit('checker', name);
  try {
    const result = await fn();
    return result;
  } catch (err) {
    return {
      name,
      status: 'fail',
      items: [{ name: 'チェック実行', status: 'fail', detail: err.message }],
    };
  }
}

/**
 * Calculate summary counts from report
 */
function calculateSummary(report) {
  const countItems = (items) => {
    if (!items) return;
    for (const item of items) {
      report.summary.total++;
      if (item.status === 'pass') report.summary.pass++;
      else if (item.status === 'fail') report.summary.fail++;
      else if (item.status === 'warn') report.summary.warn++;
      else if (item.status === 'manual') report.summary.manual++;
    }
  };
  for (const checker of Object.values(report.siteWide)) countItems(checker.items);
  for (const pageResults of Object.values(report.pages)) {
    for (const checker of Object.values(pageResults)) countItems(checker.items);
  }
  if (report.crossBrowser) {
    for (const checker of Object.values(report.crossBrowser)) countItems(checker.items);
  }
  if (report.deviceCheck) countItems(report.deviceCheck.items);
}

/**
 * Detect if URL is WordPress
 */
async function detectWordPress(page) {
  try {
    return await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      return html.includes('wp-content') || html.includes('wp-includes') || html.includes('wordpress');
    });
  } catch {
    return false;
  }
}

/**
 * Fetch sitemap URLs
 */
async function fetchSitemapUrls(sitemapUrl, baseUrl) {
  try {
    const response = await fetch(sitemapUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];
    const xml = await response.text();
    const urlPattern = /<loc>\s*(.*?)\s*<\/loc>/gi;
    const urls = [];
    let match;
    while ((match = urlPattern.exec(xml)) !== null) {
      const url = match[1].trim();
      if (url.endsWith('.xml') || url.endsWith('.xml.gz')) {
        const subUrls = await fetchSitemapUrls(url, baseUrl);
        urls.push(...subUrls);
      } else {
        try {
          const urlObj = new URL(url);
          const baseObj = new URL(baseUrl);
          if (urlObj.hostname === baseObj.hostname) {
            const path = urlObj.pathname;
            const name = path === '/' ? 'TOP' : decodeURIComponent(
              path.replace(/^\/|\/$/g, '').split('/').pop() || path
            ).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            urls.push({ name, path });
          }
        } catch { /* skip */ }
      }
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * Auto-discover pages from URL
 */
async function discoverPages(baseUrl) {
  // Try sitemap first
  const sitemapUrls = [
    baseUrl + '/sitemap.xml',
    baseUrl + '/sitemap_index.xml',
    baseUrl + '/wp-sitemap.xml',
  ];

  for (const sitemapUrl of sitemapUrls) {
    const pages = await fetchSitemapUrls(sitemapUrl, baseUrl);
    if (pages.length > 0) {
      // Limit to 5 pages for memory (512MB free tier)
      return pages.slice(0, 5);
    }
  }

  // Fallback: just TOP page
  return [{ name: 'TOP', path: '/' }];
}

/**
 * Run all checks (Web version with SSE progress)
 * @param {object} options
 * @param {string} options.url - Target URL
 * @param {string} [options.siteName] - Site name
 * @param {string} options.reportDir - Report output directory
 * @param {string} options.screenshotDir - Screenshot output directory
 * @param {function} options.emit - SSE emit function
 * @returns {Promise<object>} Report data
 */
export async function runWebChecks({ url, siteName, reportDir, screenshotDir, emit }) {
  const startTime = Date.now();

  // Ensure directories exist
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

  // Parse URL
  const urlObj = new URL(url);
  const name = siteName || urlObj.hostname;

  emit('phase', 'サイトを分析中...');

  // Discover pages
  const pages = await discoverPages(url);
  emit('info', `${pages.length}ページを検出`);

  // Build config
  const config = {
    site: {
      name,
      url: urlObj.origin,
      is_wordpress: false,
    },
    pages,
    checkers: {
      responsive: { viewports: [375, 768, 1440] },
      images: { max_size_kb: 1024 },
      links: { check_external: true, timeout_ms: 10000 },
      performance: { target_lcp_ms: 2500, target_cls: 0.1 },
      browsers: ['chromium'],
    },
  };

  const report = {
    site: config.site,
    timestamp: new Date().toISOString(),
    pages: {},
    siteWide: {},
    summary: { pass: 0, fail: 0, warn: 0, manual: 0, total: 0 },
  };

  // Launch browser
  emit('phase', 'ブラウザを起動中...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--single-process',
    ],
  });
  const context = await browser.newContext();

  // Detect WordPress
  const detectPage = await context.newPage();
  try {
    await detectPage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    config.site.is_wordpress = await detectWordPress(detectPage);
    if (config.site.is_wordpress) {
      emit('info', 'WordPressサイトを検出');
    }
  } catch { /* skip */ }
  await detectPage.close();

  // ===== Site-wide checks (shared page - single goto) =====
  emit('phase', 'サイト全体チェック');

  const topPage = config.pages.find(p => p.path === '/') || config.pages[0];
  const topUrl = config.site.url + topPage.path;

  // Single shared page for most site-wide checks
  const siteWidePage = await context.newPage();
  try {
    await siteWidePage.goto(topUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // All these checkers reuse the same loaded page (no additional goto)
    report.siteWide.ogp = await runChecker('OGP / SNS共有', () =>
      checkOgp(siteWidePage), emit);

    report.siteWide.favicon = await runChecker('ファビコン', () =>
      checkFavicon(siteWidePage), emit);

    report.siteWide.indexCheck = await runChecker('インデックス許可', () =>
      checkIndex(siteWidePage, config.site.url), emit);

    report.siteWide.analytics = await runChecker('GA4/GTM', () =>
      checkAnalytics(siteWidePage), emit);

    report.siteWide.security = await runChecker('セキュリティ', () =>
      checkSecurity(siteWidePage, config.site.url), emit);

    if (config.site.is_wordpress) {
      report.siteWide.wordpress = await runChecker('WordPress', () =>
        checkWordPress(siteWidePage, config.site.url), emit);
    }
  } catch (err) {
    emit('info', `サイト全体チェックでエラー: ${err.message}`);
  }
  await siteWidePage.close();

  // Performance needs its own page (response listeners must be set before goto)
  report.siteWide.performance = await runChecker('パフォーマンス', () =>
    checkPerformance(context, topUrl, config.checkers.performance), emit);

  // ===== Per-page checks =====
  for (let i = 0; i < config.pages.length; i++) {
    const pageConfig = config.pages[i];
    const pageUrl = config.site.url + pageConfig.path;
    const pageName = pageConfig.name;

    emit('phase', `ページチェック: ${pageName} (${i + 1}/${config.pages.length})`);

    const pageResults = {};
    const page = await context.newPage();

    // Console capture
    const consoleResults = { errors: [], warnings: [], failedRequests: [] };
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleResults.errors.push(msg.text());
      if (msg.type() === 'warning') consoleResults.warnings.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      consoleResults.failedRequests.push({
        url: req.url(),
        failure: req.failure()?.errorText || 'Unknown error',
      });
    });

    try {
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (err) {
      pageResults.navigation = {
        name: 'ページ読み込み', status: 'fail',
        items: [{ name: 'ナビゲーション', status: 'fail', detail: err.message }],
      };
      await page.close();
      report.pages[pageName] = pageResults;
      continue;
    }

    const htmlContent = await page.content();

    pageResults.html = await runChecker('HTML品質', () => checkHtml(htmlContent, pageUrl), emit);
    pageResults.seo = await runChecker('内部SEO', () => checkSeo(page, htmlContent), emit);
    pageResults.links = await runChecker('リンク', () => checkLinks(page, config.site.url, config.checkers.links), emit);
    pageResults.images = await runChecker('画像', () => checkImages(page, config.checkers.images), emit);
    pageResults.console = await runChecker('コンソール', () => checkConsole(consoleResults), emit);
    pageResults.responsive = await runChecker('レスポンシブ', () =>
      checkResponsive(page, pageUrl, pageName, config.checkers.responsive, screenshotDir), emit);
    pageResults.dummy = await runChecker('ダミーコンテンツ', () => checkDummy(page), emit);
    pageResults.assets = await runChecker('アセット最適化', () => checkAssets(page, config.site.url), emit);
    pageResults.schema = await runChecker('構造化データ', () => checkSchema(page), emit);

    await page.close();
    report.pages[pageName] = pageResults;
  }

  // ===== Device emulation =====
  emit('phase', 'マルチデバイスチェック');
  const topPageConfig = config.pages.find(p => p.path === '/') || config.pages[0];
  report.deviceCheck = await runChecker('マルチデバイス', () =>
    checkDevices(context, config.site.url + topPageConfig.path, topPageConfig.name, screenshotDir, {}), emit);

  await browser.close();
  calculateSummary(report);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  report.elapsed = elapsed;

  emit('phase', 'レポート生成中...');

  return report;
}
