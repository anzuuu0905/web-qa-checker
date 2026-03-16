// ===========================================
// device-checker.js - マルチデバイス表示チェッカー (V2)
// ===========================================
import { devices } from 'playwright';
import { join } from 'path';

// Device presets
const DEVICE_PRESETS = [
  { name: 'iPhone SE', preset: 'iPhone SE' },
  { name: 'iPhone 14', preset: 'iPhone 14' },
  { name: 'iPhone 14 Pro Max', preset: 'iPhone 14 Pro Max' },
  { name: 'Pixel 7', preset: 'Pixel 7' },
  { name: 'iPad Mini', preset: 'iPad Mini' },
  { name: 'iPad Pro 11', preset: 'iPad Pro 11' },
];

/**
 * Take screenshots across multiple device emulations
 * @param {import('playwright').BrowserContext} context
 * @param {string} pageUrl
 * @param {string} pageName
 * @param {string} screenshotDir
 * @param {object} [authOptions]
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkDevices(context, pageUrl, pageName, screenshotDir, authOptions = {}) {
  const items = [];
  const deviceScreenshots = [];

  const safeName = pageName.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_');
  const browser = context.browser();

  for (const device of DEVICE_PRESETS) {
    try {
      const deviceConfig = devices[device.preset];
      if (!deviceConfig) {
        items.push({
          name: device.name,
          status: 'warn',
          detail: `デバイスプリセット "${device.preset}" が見つかりません`,
        });
        continue;
      }

      // Create context with device emulation
      const deviceContext = await browser.newContext({
        ...deviceConfig,
        ...(authOptions.username ? { httpCredentials: authOptions } : {}),
      });
      const page = await deviceContext.newPage();

      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(500);

      // Trigger fade-in animations before screenshot
      await page.evaluate(async () => {
        const scrollHeight = document.body.scrollHeight;
        const viewportHeight = window.innerHeight;
        for (let y = 0; y < scrollHeight; y += viewportHeight * 0.7) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 80));
        }
        window.scrollTo(0, scrollHeight);
        await new Promise(r => setTimeout(r, 200));
        document.querySelectorAll('*').forEach(el => {
          const style = window.getComputedStyle(el);
          if (style.opacity === '0') el.style.opacity = '1';
          if (style.visibility === 'hidden') el.style.visibility = 'visible';
        });
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 150));
      });

      // Take full-page screenshot
      const filename = `device_${safeName}_${device.name.replace(/\s+/g, '_')}.png`;
      const filepath = join(screenshotDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });

      // Check for horizontal scroll
      const hasOverflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);

      deviceScreenshots.push({
        device: device.name,
        viewport: `${deviceConfig.viewport.width}x${deviceConfig.viewport.height}`,
        filename,
        isMobile: deviceConfig.isMobile,
      });

      items.push({
        name: device.name,
        status: hasOverflow ? 'fail' : 'pass',
        detail: `${deviceConfig.viewport.width}×${deviceConfig.viewport.height} ${deviceConfig.isMobile ? '(モバイル)' : '(タブレット)'}${hasOverflow ? ' — 横スクロール発生' : ''}`,
        screenshot: filename,
      });

      await deviceContext.close();
    } catch (err) {
      items.push({
        name: device.name,
        status: 'fail',
        detail: `エミュレーション失敗: ${err.message}`,
      });
    }
  }

  // pass項目をまとめる: failがないデバイスは「全Nデバイス正常」と1行に集約
  const passDevices = items.filter(i => i.status === 'pass');
  const failDevices = items.filter(i => i.status !== 'pass');
  if (passDevices.length > 0 && failDevices.length > 0) {
    // failがある場合: passデバイスをまとめ、failだけ個別表示
    const newItems = [...failDevices];
    newItems.push({
      name: 'その他デバイス',
      status: 'pass',
      detail: `${passDevices.length}デバイスで横スクロールなし（正常）`,
    });
    items.length = 0;
    items.push(...newItems);
  } else if (passDevices.length > 0 && failDevices.length === 0) {
    // 全pass: 1行にまとめ
    items.length = 0;
    items.push({
      name: 'デバイス表示',
      status: 'pass',
      detail: `全${passDevices.length}デバイスで横スクロールなし（スクリーンショットで目視確認してください）`,
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return {
    name: 'ビューポートエミュレーション',
    status: overallStatus,
    items,
    deviceScreenshots,
  };
}
