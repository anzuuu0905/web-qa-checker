// ===========================================
// schema-checker.js - 構造化データチェッカー
// ===========================================

/**
 * Check structured data (JSON-LD, microdata)
 * @param {import('playwright').Page} page
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkSchema(page) {
  const items = [];

  const schemaData = await page.evaluate(() => {
    // 1. JSON-LD scripts
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    const jsonLdItems = [];
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        const types = [];
        if (data['@type']) types.push(data['@type']);
        if (data['@graph']) {
          data['@graph'].forEach(item => { if (item['@type']) types.push(item['@type']); });
        }
        jsonLdItems.push({ types, valid: true, raw: script.textContent.slice(0, 200) });
      } catch (e) {
        jsonLdItems.push({ types: [], valid: false, error: e.message });
      }
    }

    // 2. Microdata
    const microdataItems = document.querySelectorAll('[itemscope]');
    const microdata = Array.from(microdataItems).map(el => ({
      type: el.getAttribute('itemtype') || '(不明)',
      tag: el.tagName.toLowerCase(),
    }));

    // 3. Open Graph (already checked in OGP, but mention presence)
    const ogTags = document.querySelectorAll('meta[property^="og:"]');

    // 4. Twitter Card
    const twitterTags = document.querySelectorAll('meta[name^="twitter:"]');

    return {
      jsonLd: jsonLdItems,
      microdata,
      hasOg: ogTags.length > 0,
      hasTwitter: twitterTags.length > 0,
    };
  });

  // JSON-LD results
  if (schemaData.jsonLd.length > 0) {
    const validItems = schemaData.jsonLd.filter(i => i.valid);
    const invalidItems = schemaData.jsonLd.filter(i => !i.valid);

    const allTypes = validItems.flatMap(i => i.types);

    items.push({
      name: 'JSON-LD 構造化データ',
      status: invalidItems.length > 0 ? 'warn' : 'pass',
      detail: `${validItems.length}件の有効なJSON-LD${invalidItems.length > 0 ? `, ${invalidItems.length}件のパースエラー` : ''}`,
      subItems: [
        ...allTypes.map(t => ({ message: `📦 @type: ${t}` })),
        ...invalidItems.map(i => ({ message: `❌ パースエラー: ${i.error}` })),
        { message: `🔗 検証: https://search.google.com/test/rich-results` },
      ],
    });

    // Check for recommended types
    const recommendedTypes = ['Organization', 'LocalBusiness', 'WebSite', 'BreadcrumbList'];
    const missingRecommended = recommendedTypes.filter(t =>
      !allTypes.some(at => at.toLowerCase() === t.toLowerCase())
    );
    if (missingRecommended.length > 0 && missingRecommended.length < recommendedTypes.length) {
      items.push({
        name: '推奨構造化データ',
        status: 'pass',
        detail: `構造化データ検出済み（追加推奨: ${missingRecommended.join(', ')}）`,
      });
    }
  } else {
    items.push({
      name: 'JSON-LD 構造化データ',
      status: 'warn',
      detail: 'JSON-LD構造化データが見つかりません',
      subItems: [
        { message: '推奨: Organization, WebSite, BreadcrumbList 等の追加' },
        { message: '🔗 生成ツール: https://technicalseo.com/tools/schema-markup-generator/' },
        { message: '🔗 検証: https://search.google.com/test/rich-results' },
      ],
    });
  }

  // Microdata
  if (schemaData.microdata.length > 0) {
    items.push({
      name: 'Microdata (itemscope)',
      status: 'pass',
      detail: `${schemaData.microdata.length}件のMicrodataを検出`,
      subItems: schemaData.microdata.slice(0, 5).map(m => ({
        message: `<${m.tag}> → ${m.type}`,
      })),
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: '構造化データチェック', status: overallStatus, items };
}
