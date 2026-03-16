// ===========================================
// ogp-checker.js - OGP/SNS共有チェッカー
// ===========================================

/**
 * Check OGP meta tags and Twitter Card
 * @param {import('playwright').BrowserContext} context
 * @param {string} url
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkOgp(context, url) {
  const items = [];
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const ogpData = await page.evaluate(() => {
      const getMeta = (attr, value) => {
        const el = document.querySelector(`meta[${attr}="${value}"]`);
        return el ? el.getAttribute('content') : null;
      };

      return {
        // Open Graph
        ogTitle: getMeta('property', 'og:title'),
        ogDescription: getMeta('property', 'og:description'),
        ogImage: getMeta('property', 'og:image'),
        ogUrl: getMeta('property', 'og:url'),
        ogType: getMeta('property', 'og:type'),
        ogSiteName: getMeta('property', 'og:site_name'),
        ogLocale: getMeta('property', 'og:locale'),

        // Twitter Card
        twitterCard: getMeta('name', 'twitter:card'),
        twitterTitle: getMeta('name', 'twitter:title'),
        twitterDescription: getMeta('name', 'twitter:description'),
        twitterImage: getMeta('name', 'twitter:image'),
        twitterSite: getMeta('name', 'twitter:site'),
      };
    });

    // 1. OG Title
    if (ogpData.ogTitle) {
      items.push({
        name: 'og:title',
        status: 'pass',
        detail: `"${ogpData.ogTitle}"`,
      });
    } else {
      items.push({
        name: 'og:title',
        status: 'fail',
        detail: 'og:titleが設定されていません',
      });
    }

    // 2. OG Description
    if (ogpData.ogDescription) {
      items.push({
        name: 'og:description',
        status: 'pass',
        detail: `設定済み (${ogpData.ogDescription.length}文字)`,
      });
    } else {
      items.push({
        name: 'og:description',
        status: 'fail',
        detail: 'og:descriptionが設定されていません',
      });
    }

    // 3. OG Image
    if (ogpData.ogImage) {
      // Check if image is accessible
      try {
        const resp = await page.context().request.head(ogpData.ogImage, {
          timeout: 5000,
          failOnStatusCode: false,
        });
        if (resp.status() === 200) {
          items.push({
            name: 'og:image',
            status: 'pass',
            detail: '設定済み・画像アクセス可能',
          });
        } else {
          items.push({
            name: 'og:image',
            status: 'fail',
            detail: `og:imageのURLがアクセスできません (HTTP ${resp.status()})`,
          });
        }
      } catch {
        items.push({
          name: 'og:image',
          status: 'warn',
          detail: 'og:imageのURLの確認に失敗しました',
        });
      }
    } else {
      items.push({
        name: 'og:image',
        status: 'fail',
        detail: 'og:imageが設定されていません（SNS共有時に画像が表示されません）',
      });
    }

    // 4. OG URL
    if (ogpData.ogUrl) {
      items.push({
        name: 'og:url',
        status: 'pass',
        detail: ogpData.ogUrl,
      });
    } else {
      items.push({
        name: 'og:url',
        status: 'warn',
        detail: 'og:urlが設定されていません',
      });
    }

    // 5. OG Type
    if (ogpData.ogType) {
      items.push({
        name: 'og:type',
        status: 'pass',
        detail: ogpData.ogType,
      });
    } else {
      items.push({
        name: 'og:type',
        status: 'warn',
        detail: 'og:typeが設定されていません',
      });
    }

    // 6. Twitter Card
    if (ogpData.twitterCard) {
      items.push({
        name: 'twitter:card',
        status: 'pass',
        detail: ogpData.twitterCard,
      });
    } else {
      items.push({
        name: 'twitter:card',
        status: 'warn',
        detail: 'twitter:cardが設定されていません',
      });
    }

    // 7. Twitter Image
    if (ogpData.twitterImage || ogpData.ogImage) {
      items.push({
        name: 'Twitter画像',
        status: 'pass',
        detail: ogpData.twitterImage ? 'twitter:image設定済み' : 'og:imageを使用',
      });
    } else {
      items.push({
        name: 'Twitter画像',
        status: 'fail',
        detail: 'SNS共有用の画像が設定されていません',
      });
    }
  } finally {
    await page.close();
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'OGP / SNS共有チェック', status: overallStatus, items };
}
