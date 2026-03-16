// ===========================================
// analytics-checker.js - GA4/GTMタグチェッカー
// ===========================================

/**
 * Check for GA4 and GTM tags
 * @param {import('playwright').Page} page
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkAnalytics(page) {
  const items = [];

  const analyticsData = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;

    // GA4 detection
    const ga4Patterns = [
      { pattern: /gtag\(['"]config['"]\s*,\s*['"]G-/i, name: 'gtag config' },
      { pattern: /googletagmanager\.com\/gtag\/js\?id=G-/i, name: 'gtag script' },
      { pattern: /G-[A-Z0-9]{10,}/i, name: 'GA4 Measurement ID' },
    ];

    // GTM detection
    const gtmPatterns = [
      { pattern: /googletagmanager\.com\/gtm\.js\?id=GTM-/i, name: 'GTM script' },
      { pattern: /GTM-[A-Z0-9]{6,}/i, name: 'GTM Container ID' },
      { pattern: /googletagmanager\.com\/ns\.html\?id=GTM-/i, name: 'GTM noscript' },
    ];

    const ga4Found = ga4Patterns.filter(p => p.pattern.test(html));
    const gtmFound = gtmPatterns.filter(p => p.pattern.test(html));

    // Extract IDs
    const ga4IdMatch = html.match(/G-[A-Z0-9]{10,}/);
    const gtmIdMatch = html.match(/GTM-[A-Z0-9]{6,}/);

    // Check GTM noscript fallback
    const hasGtmNoscript = /googletagmanager\.com\/ns\.html\?id=GTM-/.test(html);
    const hasNoscriptTag = /<noscript[^>]*>[\s\S]*?googletagmanager/i.test(html);

    return {
      ga4Found,
      gtmFound,
      ga4Id: ga4IdMatch ? ga4IdMatch[0] : null,
      gtmId: gtmIdMatch ? gtmIdMatch[0] : null,
      hasGtmNoscript: hasGtmNoscript || hasNoscriptTag,
    };
  });

  // GA4 check
  if (analyticsData.ga4Found.length > 0) {
    items.push({
      name: 'GA4 設置',
      status: 'pass',
      detail: `GA4検出: ${analyticsData.ga4Id || '(IDを直接確認してください)'}`,
    });
  } else {
    items.push({
      name: 'GA4 設置',
      status: 'warn',
      detail: 'GA4タグが検出されません（GTM経由の場合はGTMを確認）',
    });
  }

  // GTM check
  if (analyticsData.gtmFound.length > 0) {
    items.push({
      name: 'GTM 設置',
      status: 'pass',
      detail: `GTM検出: ${analyticsData.gtmId || '(IDを直接確認してください)'}`,
    });

    // GTM noscript check
    if (analyticsData.hasGtmNoscript) {
      items.push({
        name: 'GTM noscript',
        status: 'pass',
        detail: 'GTM noscriptフォールバックが設置済み',
      });
    } else {
      items.push({
        name: 'GTM noscript',
        status: 'warn',
        detail: 'GTM noscriptフォールバックが見つかりません（<body>直後に必要）',
      });
    }
  } else {
    items.push({
      name: 'GTM 設置',
      status: 'warn',
      detail: 'GTMタグが検出されません',
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'GA4/GTMチェック', status: overallStatus, items };
}
