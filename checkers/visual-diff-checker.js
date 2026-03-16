// ===========================================
// visual-diff-checker.js - ビジュアルデザイン比較チェッカー
// Figmaデザイン画像と実サイトスクリーンショットを比較
// ===========================================
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { exportFrame, verifyToken } from '../figma/client.js';

/**
 * Resize a PNG buffer to target width/height.
 * Simple nearest-neighbor resize.
 */
function resizePng(pngBuf, targetWidth, targetHeight) {
  const src = PNG.sync.read(pngBuf);

  if (src.width === targetWidth && src.height === targetHeight) {
    return src;
  }

  const dst = new PNG({ width: targetWidth, height: targetHeight });

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor(x * src.width / targetWidth);
      const srcY = Math.floor(y * src.height / targetHeight);
      const srcIdx = (srcY * src.width + srcX) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      dst.data[dstIdx] = src.data[srcIdx];
      dst.data[dstIdx + 1] = src.data[srcIdx + 1];
      dst.data[dstIdx + 2] = src.data[srcIdx + 2];
      dst.data[dstIdx + 3] = src.data[srcIdx + 3];
    }
  }

  return dst;
}

/**
 * Run visual comparison between Figma design and live site.
 * @param {import('playwright').Page} page - Playwright page (already navigated)
 * @param {object} designCompare - design_compare from config
 * @param {string} pageName - Current page name
 * @param {string} screenshotDir - Directory for output images
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkVisualDiff(page, designCompare, pageName, screenshotDir) {
  const items = [];

  // Find config for this page
  const pageConfig = designCompare.pages?.find(p => p.name === pageName);
  if (!pageConfig) {
    return { name: 'デザイン比較', status: 'pass', items: [] };
  }

  const figmaUrl = pageConfig.figma_url;
  if (!figmaUrl) {
    items.push({
      name: 'デザイン比較',
      status: 'warn',
      detail: `ページ "${pageName}" にfigma_urlが設定されていません`,
    });
    return { name: 'デザイン比較', status: 'warn', items };
  }

  // Get Figma token
  const token = process.env.FIGMA_TOKEN || designCompare.figma_token;
  if (!token) {
    items.push({
      name: 'Figma接続',
      status: 'warn',
      detail: 'FIGMA_TOKEN が設定されていません — .env に FIGMA_TOKEN=xxxx を追加してください',
    });
    return { name: 'デザイン比較', status: 'warn', items };
  }

  // Verify token
  const tokenValid = await verifyToken(token);
  if (!tokenValid) {
    items.push({
      name: 'Figma接続',
      status: 'warn',
      detail: 'Figma APIトークンが無効です — トークンを再発行してください',
    });
    return { name: 'デザイン比較', status: 'warn', items };
  }

  try {
    // Set viewport for comparison
    const viewport = pageConfig.viewport || { width: 1440 };
    await page.setViewportSize({ width: viewport.width, height: viewport.height || 900 });
    await page.waitForTimeout(1000); // Let layout settle

    // 1. Take site screenshot
    const siteScreenshot = await page.screenshot({ fullPage: false, type: 'png' });
    const sitePng = PNG.sync.read(siteScreenshot);

    // 2. Get Figma design image
    const cacheDir = join(screenshotDir, '..', 'figma-cache');
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

    const figmaBuffer = await exportFrame(figmaUrl, token, cacheDir, {
      useCache: designCompare.cache !== false,
      scale: 2,
    });

    // 3. Resize Figma image to match site screenshot dimensions
    const figmaPng = resizePng(figmaBuffer, sitePng.width, sitePng.height);

    // 4. Compare with pixelmatch
    const diffPng = new PNG({ width: sitePng.width, height: sitePng.height });
    const pixelThreshold = designCompare.pixel_threshold || 0.4;

    const diffPixels = pixelmatch(
      figmaPng.data,
      sitePng.data,
      diffPng.data,
      sitePng.width,
      sitePng.height,
      { threshold: pixelThreshold, alpha: 0.3 }
    );

    const totalPixels = sitePng.width * sitePng.height;
    const diffPercent = ((diffPixels / totalPixels) * 100).toFixed(1);
    const threshold = designCompare.threshold || 15; // percent

    // 5. Save images for report
    const safeName = pageName.replace(/[^a-zA-Z0-9\u3040-\u9fff]/g, '_');
    const figmaFile = `design_figma_${safeName}.png`;
    const siteFile = `design_site_${safeName}.png`;
    const diffFile = `design_diff_${safeName}.png`;

    writeFileSync(join(screenshotDir, figmaFile), PNG.sync.write(figmaPng));
    writeFileSync(join(screenshotDir, siteFile), siteScreenshot);
    writeFileSync(join(screenshotDir, diffFile), PNG.sync.write(diffPng));

    // 6. Analyze diff concentration (top/middle/bottom)
    const thirdHeight = Math.floor(sitePng.height / 3);
    let topDiff = 0, midDiff = 0, btmDiff = 0;

    for (let y = 0; y < sitePng.height; y++) {
      for (let x = 0; x < sitePng.width; x++) {
        const idx = (y * sitePng.width + x) * 4;
        // Check if diff pixel is highlighted (red channel high, green low)
        if (diffPng.data[idx] > 200 && diffPng.data[idx + 1] < 100) {
          if (y < thirdHeight) topDiff++;
          else if (y < thirdHeight * 2) midDiff++;
          else btmDiff++;
        }
      }
    }

    const areas = [];
    if (topDiff > midDiff && topDiff > btmDiff) areas.push('上部（ヘッダー周辺）');
    if (midDiff > topDiff && midDiff > btmDiff) areas.push('中部（メインコンテンツ）');
    if (btmDiff > topDiff && btmDiff > midDiff) areas.push('下部（フッター周辺）');
    const areaText = areas.length > 0 ? ` — 差分集中エリア: ${areas.join(', ')}` : '';

    // 7. Build result
    const status = parseFloat(diffPercent) <= threshold ? 'pass' : 'fail';
    items.push({
      name: `ビジュアル差分 (${pageName})`,
      status,
      detail: `差分率: ${diffPercent}%（閾値: ${threshold}%）${areaText}`,
      screenshots: {
        figma: figmaFile,
        site: siteFile,
        diff: diffFile,
      },
      diffPercent: parseFloat(diffPercent),
    });

  } catch (err) {
    items.push({
      name: `ビジュアル差分 (${pageName})`,
      status: 'warn',
      detail: `デザイン比較中にエラー: ${err.message}`,
    });
  }

  const overallStatus = items.some(i => i.status === 'fail')
    ? 'fail'
    : items.some(i => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'デザイン比較', status: overallStatus, items };
}
