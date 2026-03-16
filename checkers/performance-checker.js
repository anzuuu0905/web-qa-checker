// ===========================================
// performance-checker.js - パフォーマンスチェッカー (V2)
// ===========================================

/**
 * Check page performance metrics
 * @param {import('playwright').BrowserContext} context
 * @param {string} url
 * @param {object} options
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkPerformance(context, url, options = {}) {
  const { target_lcp_ms = 2500, target_cls = 0.1 } = options;
  const items = [];

  const page = await context.newPage();

  try {
    // Listen for network requests to analyze resources
    const resources = [];
    page.on('response', (response) => {
      const url = response.url();
      const headers = response.headers();
      const contentLength = parseInt(headers['content-length'] || '0');
      const contentType = headers['content-type'] || '';
      resources.push({ url, contentLength, contentType, status: response.status() });
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // 1. Page load timing via Performance API
    const timing = await page.evaluate(() => {
      const perf = performance.getEntriesByType('navigation')[0];
      if (!perf) return null;
      return {
        domContentLoaded: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
        loadComplete: Math.round(perf.loadEventEnd - perf.startTime),
        ttfb: Math.round(perf.responseStart - perf.startTime),
        domInteractive: Math.round(perf.domInteractive - perf.startTime),
      };
    });

    if (timing) {
      items.push({
        name: 'TTFB（サーバー応答速度）',
        status: timing.ttfb > 800 ? 'fail' : timing.ttfb > 600 ? 'warn' : 'pass',
        detail: `${timing.ttfb}ms${timing.ttfb <= 800 ? '（目標800ms以下 ✓）' : '（目標: 800ms以下）'}`,
      });

      items.push({
        name: 'DOMContentLoaded',
        status: timing.domContentLoaded > 3000 ? 'warn' : 'pass',
        detail: `${timing.domContentLoaded}ms`,
      });

      items.push({
        name: 'ページ読み込み完了',
        status: timing.loadComplete > 5000 ? 'warn' : 'pass',
        detail: `${timing.loadComplete}ms`,
      });
    }

    // 2. LCP
    const lcp = await page.evaluate(() => {
      return new Promise((resolve) => {
        let lcpValue = 0;
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          for (const entry of entries) {
            lcpValue = entry.startTime;
          }
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(Math.round(lcpValue));
        }, 3000);
      });
    });

    if (lcp > 0) {
      items.push({
        name: 'LCP（メインコンテンツ表示速度）',
        status: lcp > target_lcp_ms ? 'fail' : lcp > target_lcp_ms * 0.8 ? 'warn' : 'pass',
        detail: `${lcp}ms（目標: ${target_lcp_ms}ms以下）`,
      });
    } else {
      items.push({
        name: 'LCP（メインコンテンツ表示速度）',
        status: 'warn',
        detail: 'LCPを計測できませんでした（計測タイムアウト）',
      });
    }

    // 3. CLS
    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(Math.round(clsValue * 1000) / 1000);
        }, 3000);
      });
    });

    items.push({
      name: 'CLS（レイアウトのズレ量）',
      status: cls > target_cls ? 'fail' : cls > target_cls * 0.8 ? 'warn' : 'pass',
      detail: `${cls}（目標: ${target_cls}以下）`,
    });

    // 4. Total page weight (exclude resources with content-length=0 from count for accuracy)
    const measuredResources = resources.filter(r => r.contentLength > 0);
    const totalSize = measuredResources.reduce((sum, r) => sum + r.contentLength, 0);
    const unmeasuredCount = resources.length - measuredResources.length;
    const totalSizeMb = (totalSize / 1024 / 1024).toFixed(2);

    items.push({
      name: 'ページ総容量',
      status: totalSize > 5 * 1024 * 1024 ? 'fail' : totalSize > 3 * 1024 * 1024 ? 'warn' : 'pass',
      detail: `${totalSizeMb}MB（目安: 5MB以下）${unmeasuredCount > 0 ? ` ※${unmeasuredCount}件のリソースはcontent-length未送信のため未計測` : ''}${totalSize > 3 * 1024 * 1024 ? ' — 画像の圧縮・WebP変換、不要なCSS/JSの削除を検討してください' : ''}`,
    });

    // 5. V2: Resource count with breakdown
    const categorize = (ct) => {
      if (ct.includes('javascript')) return 'JS';
      if (ct.includes('css')) return 'CSS';
      if (ct.includes('image') || ct.includes('svg') || ct.includes('webp') || ct.includes('png') || ct.includes('jpeg') || ct.includes('gif')) return '画像';
      if (ct.includes('font') || ct.includes('woff') || ct.includes('ttf') || ct.includes('otf')) return 'フォント';
      if (ct.includes('html')) return 'HTML';
      if (ct.includes('json') || ct.includes('xml')) return 'データ';
      return 'その他';
    };

    const breakdown = {};
    const sizeByCategory = {};
    for (const r of resources) {
      const cat = categorize(r.contentType);
      breakdown[cat] = (breakdown[cat] || 0) + 1;
      sizeByCategory[cat] = (sizeByCategory[cat] || 0) + r.contentLength;
    }

    const breakdownStr = Object.entries(breakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => {
        const size = (sizeByCategory[cat] / 1024).toFixed(0);
        return `${cat}: ${count}件 (${size}KB)`;
      });

    items.push({
      name: 'リソース数',
      status: resources.length > 100 ? 'warn' : 'pass',
      detail: `合計 ${resources.length}件`,
      subItems: breakdownStr.map(s => ({ message: s })),
    });

    // 6. 404 resources
    const notFound = resources.filter((r) => r.status === 404);
    if (notFound.length > 0) {
      items.push({
        name: '404リソース',
        status: 'fail',
        detail: `${notFound.length}件のリソースが404エラー`,
        subItems: notFound.slice(0, 5).map((r) => ({
          message: r.url.slice(-100),
        })),
      });
    } else {
      items.push({
        name: '404リソース',
        status: 'pass',
        detail: '読み込み失敗リソースなし',
      });
    }

    // 7. Render-blocking resources
    const renderBlocking = await page.evaluate(() => {
      const links = document.querySelectorAll('link[rel="stylesheet"]:not([media="print"])');
      const scripts = document.querySelectorAll('script[src]:not([async]):not([defer])');
      return {
        blockingCss: links.length,
        blockingJs: Array.from(scripts).filter((s) => {
          return s.closest('head') !== null;
        }).length,
      };
    });

    if (renderBlocking.blockingJs > 3) {
      items.push({
        name: 'レンダリングブロック JS',
        status: 'warn',
        detail: `head内に${renderBlocking.blockingJs}個のブロッキングスクリプト（async/deferなし） — ページ表示が遅くなる原因になります`,
      });
    } else {
      items.push({
        name: 'レンダリングブロック JS',
        status: 'pass',
        detail: `ブロッキングJS: ${renderBlocking.blockingJs}個（問題なし）`,
      });
    }
  } finally {
    await page.close();
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'パフォーマンスチェック', status: overallStatus, items };
}
