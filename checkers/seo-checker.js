// ===========================================
// seo-checker.js - 内部SEOチェッカー (V2)
// ===========================================

/**
 * Check internal SEO elements
 * @param {import('playwright').Page} page
 * @param {string} html
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkSeo(page, html) {
  const items = [];

  const seoData = await page.evaluate(() => {
    const getMetaContent = (name) => {
      const el =
        document.querySelector(`meta[name="${name}"]`) ||
        document.querySelector(`meta[property="${name}"]`);
      return el ? el.getAttribute('content') : null;
    };

    // Title
    const title = document.title;

    // Meta description
    const description = getMetaContent('description');

    // Headings with hierarchy
    const headings = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      const img = h.querySelector('img');
      const hasImage = !!img;
      const imgAlt = img ? (img.getAttribute('alt') || '') : '';
      headings.push({
        tag: h.tagName.toLowerCase(),
        level: parseInt(h.tagName.charAt(1)),
        text: h.textContent.trim().slice(0, 100),
        hasImage: hasImage,
        imgAlt: imgAlt,
      });
    });

    // Images without alt
    const images = [];
    document.querySelectorAll('img').forEach((img) => {
      images.push({
        src: img.src.slice(-60),
        alt: img.getAttribute('alt'),
        hasWidth: img.hasAttribute('width'),
        hasHeight: img.hasAttribute('height'),
      });
    });

    // lang attribute
    const lang = document.documentElement.getAttribute('lang');

    // Canonical
    const canonical = document.querySelector('link[rel="canonical"]');

    return {
      title,
      description,
      headings,
      images,
      lang,
      hasCanonical: !!canonical,
      canonicalHref: canonical?.getAttribute('href'),
    };
  });

  // 1. Title tag
  if (!seoData.title || seoData.title.trim() === '') {
    items.push({
      name: 'titleタグ',
      status: 'fail',
      detail: 'titleタグが設定されていません',
    });
  } else if (seoData.title.length > 60) {
    items.push({
      name: 'titleタグ',
      status: 'warn',
      detail: `titleが長すぎます (${seoData.title.length}文字): "${seoData.title.slice(0, 60)}..." — 60文字以内に短縮してください（Google検索結果で途中で切れます）`,
    });
  } else {
    items.push({
      name: 'titleタグ',
      status: 'pass',
      detail: `"${seoData.title}" (${seoData.title.length}文字)`,
    });
  }

  // 2. Meta description
  if (!seoData.description) {
    items.push({
      name: 'meta description',
      status: 'fail',
      detail: 'meta descriptionが設定されていません',
    });
  } else if (seoData.description.length > 160) {
    items.push({
      name: 'meta description',
      status: 'warn',
      detail: `descriptionが長すぎます (${seoData.description.length}文字): "${seoData.description.slice(0, 80)}..." — 160文字以内に編集してください（検索結果のスニペットが途切れます）`,
    });
  } else {
    items.push({
      name: 'meta description',
      status: 'pass',
      detail: `"${seoData.description.slice(0, 80)}${seoData.description.length > 80 ? '...' : ''}" (${seoData.description.length}文字)`,
    });
  }

  // 3. Heading structure
  const h1Count = seoData.headings.filter((h) => h.tag === 'h1').length;
  if (h1Count === 0) {
    items.push({
      name: 'h1タグ',
      status: 'fail',
      detail: 'h1タグがありません',
    });
  } else if (h1Count > 1) {
    items.push({
      name: 'h1タグ',
      status: 'warn',
      detail: `h1タグが${h1Count}個あります（推奨: 1個）`,
      subItems: seoData.headings.filter(h => h.tag === 'h1').map(h => ({
        message: `h1: "${h.text}"`,
      })),
    });
  } else {
    const h1 = seoData.headings.find((h) => h.tag === 'h1');
    const displayText = h1.text || (h1.hasImage && h1.imgAlt ? `[alt] ${h1.imgAlt}` : '(空)');
    items.push({
      name: 'h1タグ',
      status: 'pass',
      detail: `"${displayText}"`,
    });
  }

  // Check heading hierarchy
  let lastLevel = 0;
  let headingOrderOk = true;
  const skippedHeadings = [];
  for (const h of seoData.headings) {
    if (h.level > lastLevel + 1 && lastLevel > 0) {
      headingOrderOk = false;
      skippedHeadings.push({ from: lastLevel, to: h.level, text: h.text });
    }
    lastLevel = h.level;
  }

  if (!headingOrderOk) {
    items.push({
      name: '見出し階層順序',
      status: 'warn',
      detail: `見出しレベルが${skippedHeadings.length}箇所で飛んでいます`,
      subItems: skippedHeadings.map(s => ({
        message: `h${s.from} → h${s.to} (スキップ): "${s.text}"`,
      })),
    });
  } else {
    items.push({
      name: '見出し階層順序',
      status: 'pass',
      detail: `全${seoData.headings.length}個の見出しが正しい順序です`,
    });
  }

  // V2: Heading structure list (always show)
  if (seoData.headings.length > 0) {
    items.push({
      name: '見出し構造一覧',
      status: 'pass',
      detail: `${seoData.headings.length}個の見出しを検出`,
      subItems: seoData.headings.map(h => ({
        message: `${'　'.repeat(h.level - 1)}${h.tag}: ${h.text || (h.hasImage && h.imgAlt ? '[alt] ' + h.imgAlt : '(空)')}`,
      })),
    });
  }

  // 4. alt attributes — image-checker に一本化（重複回避）

  // 5. img width/height — image-checker に一本化（重複回避）

  // 6. lang attribute
  if (!seoData.lang) {
    items.push({
      name: 'lang属性',
      status: 'fail',
      detail: 'html要素にlang属性が設定されていません',
    });
  } else {
    items.push({
      name: 'lang属性',
      status: 'pass',
      detail: `lang="${seoData.lang}" 設定済み`,
    });
  }

  // 7. canonical
  if (!seoData.hasCanonical) {
    items.push({
      name: 'canonical URL',
      status: 'warn',
      detail: 'canonical URLが設定されていません（検索エンジンが正規URLを判断できず、SEO評価が分散するリスクがあります）',
    });
  } else {
    items.push({
      name: 'canonical URL',
      status: 'pass',
      detail: `設定済み: ${seoData.canonicalHref}`,
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: '内部SEOチェック', status: overallStatus, items };
}
