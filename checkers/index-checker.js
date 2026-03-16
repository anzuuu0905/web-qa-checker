// ===========================================
// index-checker.js - インデックス許可チェッカー
// ===========================================

/**
 * Check if the site allows/disallows search engine indexing
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkIndex(page, baseUrl) {
  const items = [];
  let metaNoIndexDetected = false;

  // 1. Check meta robots tag
  const metaRobots = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="robots"]');
    return meta ? meta.getAttribute('content') : null;
  });

  if (metaRobots) {
    const isNoIndex = metaRobots.toLowerCase().includes('noindex');
    const isNoFollow = metaRobots.toLowerCase().includes('nofollow');

    if (isNoIndex) {
      metaNoIndexDetected = true;
      items.push({
        name: 'meta robots (noindex)',
        status: 'fail',
        detail: `noindex が設定されています: "${metaRobots}" — 公開前に解除が必要`,
      });
    } else {
      items.push({
        name: 'meta robots',
        status: 'pass',
        detail: `"${metaRobots}" — インデックス許可されています`,
      });
    }

    if (isNoFollow) {
      items.push({
        name: 'meta robots (nofollow)',
        status: 'warn',
        detail: 'nofollow が設定されています — リンクのクロールが無効になっています',
      });
    }
  } else {
    items.push({
      name: 'meta robots',
      status: 'pass',
      detail: 'meta robotsタグなし（デフォルト: インデックス許可）',
    });
  }

  // 2. Check X-Robots-Tag header
  try {
    const response = await page.context().request.get(baseUrl, {
      timeout: 10000,
      failOnStatusCode: false,
    });
    const xRobotsTag = response.headers()['x-robots-tag'];
    if (xRobotsTag) {
      const isNoIndex = xRobotsTag.toLowerCase().includes('noindex');
      items.push({
        name: 'X-Robots-Tag ヘッダー',
        status: isNoIndex ? 'fail' : 'pass',
        detail: isNoIndex
          ? `noindex が設定されています: "${xRobotsTag}" — 公開前に解除が必要`
          : `"${xRobotsTag}"`,
      });
    }
  } catch {
    // Skip if check fails
  }

  // 3. Check robots.txt
  try {
    const robotsResp = await page.context().request.get(`${baseUrl}/robots.txt`, {
      timeout: 10000,
      failOnStatusCode: false,
    });

    if (robotsResp.status() === 200) {
      const robotsTxt = await robotsResp.text();

      // Check for Disallow: /
      const lines = robotsTxt.split('\n').map((l) => l.trim());
      const disallowAll = lines.some(
        (l) => l.toLowerCase() === 'disallow: /' && !l.toLowerCase().startsWith('#')
      );

      if (disallowAll) {
        items.push({
          name: 'robots.txt (Disallow: /)',
          status: 'fail',
          detail: 'robots.txtで検索エンジンのアクセスが全面禁止されています — 公開前に修正が必要です',
        });
      } else {
        const disallowLines = lines.filter(
          (l) => l.toLowerCase().startsWith('disallow:') && l.toLowerCase() !== 'disallow:'
        );
        items.push({
          name: 'robots.txt',
          status: 'pass',
          detail: `OK（${disallowLines.length}件の Disallow ルール）`,
        });
      }

      // Check for Sitemap declaration
      const hasSitemap = lines.some((l) => l.toLowerCase().startsWith('sitemap:'));
      items.push({
        name: 'robots.txt Sitemap宣言',
        status: hasSitemap ? 'pass' : 'warn',
        detail: hasSitemap ? 'Sitemap URLが宣言されています' : 'robots.txt にSitemap宣言がありません（推奨）',
      });
    } else {
      items.push({
        name: 'robots.txt',
        status: 'warn',
        detail: `robots.txt が見つかりません (HTTP ${robotsResp.status()})`,
      });
    }
  } catch {
    items.push({
      name: 'robots.txt',
      status: 'warn',
      detail: 'robots.txt の確認に失敗しました',
    });
  }

  // 4. Check WordPress "Discourage search engines" setting (visible in page source)
  const wpNoIndex = await page.evaluate(() => {
    // WordPress adds this when "Discourage search engines" is checked
    const meta = document.querySelector('meta[name="robots"][content*="noindex"]');
    const wpNoindexComment = document.documentElement.outerHTML.includes('noindex');
    return {
      hasMeta: !!meta,
      hasInSource: wpNoindexComment,
    };
  });

  // Report WP noindex if detected and not already caught by meta robots check above
  if (wpNoIndex.hasMeta && !metaNoIndexDetected) {
    items.push({
      name: 'WordPress noindex設定',
      status: 'fail',
      detail: 'WordPressの「検索エンジンがインデックスしないようにする」が有効です — 公開前に解除が必要',
    });
  }

  // Summary
  const hasBlockingIssue = items.some((i) => i.status === 'fail');
  if (!hasBlockingIssue) {
    items.push({
      name: 'インデックス総合判定',
      status: 'pass',
      detail: '検索エンジンのインデックスが許可されています',
    });
  } else {
    items.push({
      name: 'インデックス総合判定',
      status: 'fail',
      detail: '⚠️ 検索エンジンからのインデックスがブロックされています — 公開前に設定を確認してください',
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'インデックス許可チェック', status: overallStatus, items };
}
