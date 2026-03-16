// ===========================================
// responsive-checker.js - レスポンシブチェッカー (V2.1)
// ===========================================
import { join } from 'path';

/**
 * Force all fade-in/scroll-triggered animations to display
 * by scrolling through the entire page and setting opacity/visibility
 */
async function triggerAllAnimations(page) {
  // 1. Scroll through the entire page to trigger IntersectionObserver animations
  await page.evaluate(async () => {
    const scrollHeight = document.body.scrollHeight;
    const viewportHeight = window.innerHeight;
    const scrollStep = viewportHeight * 0.7;

    for (let y = 0; y < scrollHeight; y += scrollStep) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 100));
    }
    // Scroll to bottom to catch any remaining
    window.scrollTo(0, scrollHeight);
    await new Promise(r => setTimeout(r, 300));

    // 2. Force all elements with opacity: 0 or visibility: hidden to be visible
    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.opacity === '0') {
        el.style.opacity = '1';
      }
      if (style.visibility === 'hidden') {
        el.style.visibility = 'visible';
      }
      // Handle common animation class patterns
      if (style.transform && style.transform.includes('translateY')) {
        el.style.transform = 'none';
      }
    });

    // Scroll back to top for screenshot
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 200));
  });
}

/**
 * Check responsive layout at multiple viewports
 * @param {import('playwright').Page} page
 * @param {string} pageUrl
 * @param {string} pageName
 * @param {object} options
 * @param {string} screenshotDir
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkResponsive(page, pageUrl, pageName, options, screenshotDir) {
  const { viewports = [340, 375, 767, 768, 1440, 1920, 2560] } = options;
  const items = [];
  const screenshots = [];

  // Sanitize page name for filenames
  const safeName = pageName.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_');

  for (const width of viewports) {
    const height = width <= 768 ? 812 : 900;

    // Set viewport
    await page.setViewportSize({ width, height });

    // Wait for responsive CSS/JS to apply
    await page.waitForTimeout(500);

    // Trigger all fade-in animations so they appear in screenshots
    await triggerAllAnimations(page);

    // Check for horizontal scroll
    const scrollInfo = await page.evaluate(() => {
      return {
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        hasHorizontalScroll: document.body.scrollWidth > window.innerWidth,
      };
    });

    // Find overflowing elements
    const overflowingElements = await page.evaluate(() => {
      const vw = window.innerWidth;
      const overflowing = [];
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.right > vw + 5 && rect.width > 0) {
          overflowing.push({
            tag: el.tagName.toLowerCase(),
            class: el.className?.toString().slice(0, 40) || '',
            width: Math.round(rect.width),
            overflow: Math.round(rect.right - vw),
          });
        }
      }
      return overflowing.slice(0, 5);
    });

    // Take full-page screenshot
    const filename = `${safeName}_${width}px.png`;
    const filepath = join(screenshotDir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    screenshots.push({ width, filename, filepath });

    // Record result
    if (scrollInfo.hasHorizontalScroll) {
      items.push({
        name: `${width}px`,
        status: 'fail',
        detail: `横スクロールが発生 (body: ${scrollInfo.bodyScrollWidth}px > viewport: ${scrollInfo.viewportWidth}px)`,
        subItems: overflowingElements.map((el) => ({
          message: `<${el.tag} class="${el.class}"> がはみ出し (${el.overflow}px)`,
        })),
        screenshot: filename,
      });
    }
    // pass項目は後でまとめて1行にする
  }

  // pass項目をまとめる: failがなければ「全Nビューポート正常」と1行に
  const failViewports = items.filter(i => i.status === 'fail');
  const passViewportCount = viewports.length - failViewports.length;
  if (passViewportCount > 0) {
    items.push({
      name: 'ビューポート表示',
      status: 'pass',
      detail: `${passViewportCount}/${viewports.length} ビューポートでレイアウト正常（スクリーンショットで目視確認してください）`,
    });
  }

  // Additional responsive checks (mobile viewports only)
  const mobileViewport = viewports.find(w => w <= 768);
  if (mobileViewport) {
    await page.setViewportSize({ width: mobileViewport, height: 812 });
    await page.waitForTimeout(300);

    // Tap target size check (44x44px minimum per WCAG)
    const smallTargets = await page.evaluate(() => {
      const interactiveElements = document.querySelectorAll('a, button, input, select, textarea, [role="button"]');
      const tooSmall = [];
      for (const el of interactiveElements) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          // Ignore hidden elements
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            tooSmall.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            });
          }
        }
      }
      return tooSmall.slice(0, 10);
    });

    // 閾値 > 3: WCAG 2.2 では全要素44px以上が理想だが、ナビゲーション内のインラインリンク等は
    // CSSの制約で小さくなりがち。3個以下は許容し、4個以上で警告とする実用的妥協。
    if (smallTargets.length > 3) {
      items.push({
        name: 'タップターゲットサイズ (44px)',
        status: 'warn',
        detail: `${smallTargets.length}個の操作要素が44x44px未満（モバイルタップ困難）`,
        subItems: smallTargets.slice(0, 5).map(t => ({
          message: `<${t.tag}> "${t.text}" (${t.width}×${t.height}px)`,
        })),
      });
    } else {
      items.push({
        name: 'タップターゲットサイズ (44px)',
        status: 'pass',
        detail: '主要な操作要素は44x44px以上です',
      });
    }

    // Font size check (12px minimum for readability)
    const smallFonts = await page.evaluate(() => {
      const textElements = document.querySelectorAll('p, li, td, th, span, a, label');
      const tooSmall = [];
      for (const el of textElements) {
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize > 0 && fontSize < 12 && el.textContent.trim().length > 0) {
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            tooSmall.push({
              tag: el.tagName.toLowerCase(),
              text: el.textContent.trim().slice(0, 30),
              size: fontSize,
            });
          }
        }
      }
      return tooSmall.slice(0, 10);
    });

    if (smallFonts.length > 0) {
      items.push({
        name: 'フォントサイズ (12px)',
        status: 'warn',
        detail: `${smallFonts.length}個の要素のフォントサイズが12px未満（可読性低下）`,
        subItems: smallFonts.slice(0, 5).map(f => ({
          message: `<${f.tag}> "${f.text}" (${f.size}px)`,
        })),
      });
    } else {
      items.push({
        name: 'フォントサイズ (12px)',
        status: 'pass',
        detail: '全テキスト要素が12px以上です',
      });
    }
  }

  // Manual check reminders（パーフェクトピクセルはテンプレートの手動チェックリストに統一）
  items.push({
    name: 'デザイン目視確認',
    status: 'manual',
    detail: 'スクリーンショットを確認し、デザインカンプとの差異がないか目視チェックしてください',
  });

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'レスポンシブチェック', status: overallStatus, items, screenshots };
}
