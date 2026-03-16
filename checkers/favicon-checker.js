// ===========================================
// favicon-checker.js - ファビコンチェッカー
// ===========================================

/**
 * Check favicon existence and configuration
 * @param {import('playwright').BrowserContext|import('playwright').Page} contextOrPage
 * @param {string} [url] - URL (required when passing context)
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkFavicon(contextOrPage, url) {
  const items = [];
  const isPage = typeof contextOrPage.goto === 'function';
  const page = isPage ? contextOrPage : await contextOrPage.newPage();

  try {
    if (!isPage) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Check link tags for favicon
    const faviconLinks = await page.evaluate(() => {
      const links = document.querySelectorAll(
        'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
      );
      return Array.from(links).map((l) => ({
        rel: l.getAttribute('rel'),
        href: l.href,
        sizes: l.getAttribute('sizes'),
        type: l.getAttribute('type'),
      }));
    });

    // Check /favicon.ico directly
    const baseUrl = new URL(url);
    let faviconIcoExists = false;
    try {
      const resp = await page.context().request.head(`${baseUrl.origin}/favicon.ico`, {
        timeout: 5000,
        failOnStatusCode: false,
      });
      faviconIcoExists = resp.status() === 200;
    } catch {
      // Ignore
    }

    // Analyze results
    if (faviconLinks.length > 0 || faviconIcoExists) {
      items.push({
        name: 'ファビコン設定',
        status: 'pass',
        detail: faviconLinks.length > 0
          ? `${faviconLinks.length}個のファビコン設定あり`
          : '/favicon.ico が存在',
      });

      // Check apple-touch-icon
      const appleIcon = faviconLinks.find((l) => l.rel === 'apple-touch-icon');
      if (appleIcon) {
        items.push({
          name: 'Apple Touch Icon',
          status: 'pass',
          detail: `設定済み (${appleIcon.sizes || 'サイズ未指定'})`,
        });
      } else {
        items.push({
          name: 'Apple Touch Icon',
          status: 'warn',
          detail: 'apple-touch-iconが設定されていません（iOS推奨）',
        });
      }
    } else {
      items.push({
        name: 'ファビコン設定',
        status: 'fail',
        detail: 'ファビコンが設定されていません',
      });
    }
  } finally {
    if (!isPage) await page.close();
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'ファビコンチェック', status: overallStatus, items };
}
