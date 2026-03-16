// ===========================================
// asset-checker.js - アセット最適化チェッカー
// (次世代画像、Lazy Loading、ルートパス、フォント)
// ===========================================

/**
 * Check asset optimization (next-gen images, lazy loading, root paths, fonts)
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkAssets(page, baseUrl) {
  const items = [];

  const assetData = await page.evaluate((baseUrl) => {
    const baseUrlObj = new URL(baseUrl);

    // ===== Images =====
    const images = Array.from(document.querySelectorAll('img')).map(img => {
      const src = img.src || img.getAttribute('data-src') || '';
      const ext = src.split('?')[0].split('.').pop().toLowerCase();
      return {
        src: src.slice(-80),
        ext,
        hasLazy: img.loading === 'lazy' || img.hasAttribute('data-src') || img.classList.contains('lazyload') || img.classList.contains('lazy'),
        isAboveTheFold: img.getBoundingClientRect().top < window.innerHeight,
        isNextGen: ['webp', 'avif', 'svg'].includes(ext),
      };
    });

    // Picture/source elements with next-gen formats
    const pictureElements = document.querySelectorAll('picture source[type]');
    const hasWebpSource = Array.from(pictureElements).some(s =>
      s.type === 'image/webp' || s.type === 'image/avif'
    );

    // ===== Links & Root Paths =====
    const internalLinks = Array.from(document.querySelectorAll('a[href]')).filter(a => {
      try {
        const url = new URL(a.href);
        return url.hostname === baseUrlObj.hostname;
      } catch { return false; }
    });

    const relativeLinks = internalLinks.filter(a => {
      const href = a.getAttribute('href');
      // Check if using relative path (not starting with /)
      return href && !href.startsWith('/') && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:');
    });

    // ===== Fonts =====
    const fontFamilies = new Set();
    const computedFonts = [];

    // Check key elements for fonts
    const elementsToCheck = [
      { selector: 'body', label: 'body' },
      { selector: 'h1', label: 'h1' },
      { selector: 'h2', label: 'h2' },
      { selector: 'p', label: 'p' },
      { selector: 'a', label: 'a' },
      { selector: 'button, input[type="submit"]', label: 'button' },
      { selector: 'nav', label: 'nav' },
      { selector: '.site-title, .logo', label: 'logo' },
    ];

    for (const { selector, label } of elementsToCheck) {
      const el = document.querySelector(selector);
      if (el) {
        const style = window.getComputedStyle(el);
        const family = style.fontFamily;
        const size = style.fontSize;
        const weight = style.fontWeight;
        if (family) {
          fontFamilies.add(family.split(',')[0].trim().replace(/['"]/g, ''));
          computedFonts.push({
            element: label,
            family: family.slice(0, 60),
            size,
            weight,
          });
        }
      }
    }

    // Google Fonts detection
    const googleFontLinks = Array.from(document.querySelectorAll('link[href*="fonts.googleapis.com"]'));
    const googleFonts = googleFontLinks.map(l => {
      const match = l.href.match(/family=([^&:]+)/);
      return match ? match[1].replace(/\+/g, ' ') : l.href;
    });

    return {
      images,
      hasWebpSource,
      relativeLinks: relativeLinks.map(a => ({
        href: a.getAttribute('href'),
        text: a.textContent.trim().slice(0, 50),
      })),
      totalInternalLinks: internalLinks.length,
      fontFamilies: Array.from(fontFamilies),
      computedFonts,
      googleFonts,
    };
  }, baseUrl);

  // 1. Next-gen image format check
  const images = assetData.images;
  const nonSvgImages = images.filter(i => i.ext !== 'svg' && i.ext !== '');
  const nextGenImages = nonSvgImages.filter(i => i.isNextGen);
  const legacyImages = nonSvgImages.filter(i => !i.isNextGen);

  if (nonSvgImages.length === 0) {
    items.push({
      name: '次世代画像フォーマット',
      status: 'pass',
      detail: '画像なし',
    });
  } else if (legacyImages.length === 0 || assetData.hasWebpSource) {
    items.push({
      name: '次世代画像フォーマット',
      status: 'pass',
      detail: `全${nonSvgImages.length}枚が次世代フォーマット対応${assetData.hasWebpSource ? '（picture/source使用）' : ''}`,
    });
  } else {
    const ratio = Math.round((nextGenImages.length / nonSvgImages.length) * 100);
    items.push({
      name: '次世代画像フォーマット',
      status: ratio >= 50 ? 'warn' : 'fail',
      detail: `${nextGenImages.length}/${nonSvgImages.length}枚 (${ratio}%) がWebP/AVIF。残り${legacyImages.length}枚はJPG/PNG等`,
      subItems: legacyImages.slice(0, 5).map(i => ({
        message: `${i.ext}: ...${i.src}`,
      })),
    });
  }

  // 2. Lazy loading check
  const belowFoldImages = images.filter(i => !i.isAboveTheFold && i.ext !== 'svg');
  const lazyImages = belowFoldImages.filter(i => i.hasLazy);

  if (belowFoldImages.length === 0) {
    items.push({
      name: 'Lazy Loading',
      status: 'pass',
      detail: 'ファーストビュー外の画像なし',
    });
  } else if (lazyImages.length === belowFoldImages.length) {
    items.push({
      name: 'Lazy Loading',
      status: 'pass',
      detail: `ファーストビュー外の全${belowFoldImages.length}枚にlazy loading設定済み`,
    });
  } else {
    items.push({
      name: 'Lazy Loading',
      status: 'warn',
      detail: `${belowFoldImages.length - lazyImages.length}/${belowFoldImages.length}枚にloading="lazy"未設定（ファーストビュー外） — 初期表示の高速化のために設定を推奨`,
    });
  }

  // 3. Root absolute path check
  if (assetData.relativeLinks.length > 0) {
    items.push({
      name: 'ルート絶対パス',
      status: 'warn',
      detail: `${assetData.relativeLinks.length}/${assetData.totalInternalLinks}件の内部リンクが相対パスです（/始まりの絶対パス推奨）`,
      subItems: assetData.relativeLinks.slice(0, 5).map(l => ({
        message: `"${l.text}" → href="${l.href}"`,
      })),
    });
  } else {
    items.push({
      name: 'ルート絶対パス',
      status: 'pass',
      detail: `全${assetData.totalInternalLinks}件の内部リンクがルート絶対パス or 完全URL`,
    });
  }

  // 4. Font info (always show as informational)
  const fontDetails = assetData.computedFonts.map(f => ({
    message: `${f.element}: ${f.family} (${f.size}, weight: ${f.weight})`,
  }));

  if (assetData.googleFonts.length > 0) {
    fontDetails.unshift({
      message: `📦 Google Fonts: ${assetData.googleFonts.join(', ')}`,
    });
  }

  items.push({
    name: 'フォント情報',
    status: 'pass',
    detail: `${assetData.fontFamilies.length}種類のフォントファミリーを検出: ${assetData.fontFamilies.join(', ')}`,
    subItems: fontDetails,
  });

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'アセット最適化チェック', status: overallStatus, items };
}
