// ===========================================
// image-checker.js - 画像チェッカー
// ===========================================

/**
 * Check image quality - size, format, alt, dimensions
 * @param {import('playwright').Page} page
 * @param {object} options
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkImages(page, options = {}) {
  const { max_size_kb = 1024 } = options;
  const items = [];

  // Get all images and their attributes
  const images = await page.evaluate(() => {
    const imgs = document.querySelectorAll('img');
    return Array.from(imgs).map((img) => ({
      src: img.src,
      alt: img.getAttribute('alt'),
      hasAlt: img.hasAttribute('alt'),
      width: img.getAttribute('width'),
      height: img.getAttribute('height'),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      loading: img.getAttribute('loading'),
      decoding: img.getAttribute('decoding'),
    }));
  });

  if (images.length === 0) {
    items.push({
      name: '画像',
      status: 'pass',
      detail: 'ページに画像がありません',
    });
    return { name: '画像チェック', status: 'pass', items };
  }

  // 1. Check image file sizes
  const largeImages = [];
  let unmeasuredCount = 0;
  const imageFormats = { webp: 0, svg: 0, png: 0, jpg: 0, gif: 0, avif: 0, other: 0 };

  for (const img of images) {
    if (!img.src || img.src.startsWith('data:')) continue;

    // Detect format from URL
    const urlLower = img.src.toLowerCase();
    if (urlLower.includes('.webp')) imageFormats.webp++;
    else if (urlLower.includes('.svg')) imageFormats.svg++;
    else if (urlLower.includes('.png')) imageFormats.png++;
    else if (urlLower.match(/\.(jpg|jpeg)/)) imageFormats.jpg++;
    else if (urlLower.includes('.gif')) imageFormats.gif++;
    else if (urlLower.includes('.avif')) imageFormats.avif++;
    else imageFormats.other++;

    // Check file size via fetch
    try {
      const response = await page.context().request.head(img.src, {
        timeout: 5000,
        failOnStatusCode: false,
      });
      const contentLength = response.headers()['content-length'];
      if (contentLength) {
        const sizeBytes = parseInt(contentLength);
        if (sizeBytes > 0) {
          const sizeKb = sizeBytes / 1024;
          if (sizeKb > max_size_kb) {
            largeImages.push({
              src: img.src.split('/').pop().slice(0, 40),
              size: `${Math.round(sizeKb)}KB`,
            });
          }
        }
      } else {
        // content-length 未送信（CDN/HTTP2等）— サイズ未計測としてカウント
        unmeasuredCount++;
      }
    } catch {
      // Skip if we can't check size
    }
  }

  // Large images
  if (largeImages.length > 0) {
    items.push({
      name: `画像サイズ (${max_size_kb}KB超)`,
      status: 'fail',
      detail: `${largeImages.length}枚の画像が${max_size_kb}KBを超えています — TinyPNG等で圧縮、またはWebP/AVIF形式への変換を検討してください`,
      subItems: largeImages.slice(0, 10).map((img) => ({
        message: `${img.src} (${img.size})`,
      })),
    });
  } else {
    items.push({
      name: `画像サイズ (${max_size_kb}KB以下)`,
      status: 'pass',
      detail: `全画像が${max_size_kb}KB以下です`,
    });
  }

  // Report unmeasured images (CDN/HTTP2 without content-length)
  if (unmeasuredCount > 0) {
    items.push({
      name: '画像サイズ（未計測）',
      status: 'warn',
      detail: `${unmeasuredCount}枚の画像はcontent-length未送信のためサイズ未計測（CDN/HTTP2環境）`,
    });
  }

  // 2. Image format analysis
  const modernFormats = imageFormats.webp + imageFormats.avif + imageFormats.svg;
  const legacyFormats = imageFormats.png + imageFormats.jpg + imageFormats.gif;
  const formatDetail = Object.entries(imageFormats)
    .filter(([, count]) => count > 0)
    .map(([fmt, count]) => `${fmt}: ${count}`)
    .join(', ');

  if (legacyFormats > 0 && modernFormats === 0) {
    items.push({
      name: '画像フォーマット',
      status: 'warn',
      detail: `WebP/AVIF未使用 (${formatDetail})`,
    });
  } else {
    items.push({
      name: '画像フォーマット',
      status: modernFormats > 0 ? 'pass' : 'pass',
      detail: formatDetail,
    });
  }

  // 3. alt attribute (detailed - already checked in SEO, but more detail here)
  const noAlt = images.filter((img) => !img.hasAlt);
  const emptyAlt = images.filter((img) => img.hasAlt && img.alt === '');
  if (noAlt.length > 0) {
    items.push({
      name: 'alt属性（未設定）',
      status: 'fail',
      detail: `${noAlt.length}枚の画像にalt属性がありません`,
    });
  } else {
    items.push({
      name: 'alt属性',
      status: 'pass',
      detail: `全${images.length}枚にalt属性設定済み（空alt: ${emptyAlt.length}枚）`,
    });
  }

  // 4. width/height attributes
  const noDimensions = images.filter(
    (img) => !img.width || !img.height
  );
  if (noDimensions.length > 0) {
    items.push({
      name: 'width/height属性',
      status: 'warn',
      detail: `${noDimensions.length}枚の画像にwidth/height属性がありません（表示中の画面ガタつき防止に推奨）`,
    });
  } else {
    items.push({
      name: 'width/height属性',
      status: 'pass',
      detail: 'OK',
    });
  }

  // 5. Lazy loading — 統合済み: asset-checker で実施（ファーストビュー判定あり）
  // 重複を避けるためimage-checkerからは削除

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: '画像チェック', status: overallStatus, items };
}
