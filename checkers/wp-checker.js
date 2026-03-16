// ===========================================
// wp-checker.js - WordPress固有チェッカー
// ===========================================

/**
 * Check WordPress-specific items (external/HTTP access only)
 * @param {import('playwright').BrowserContext} context
 * @param {string} baseUrl
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkWordPress(context, baseUrl) {
  const items = [];
  const page = await context.newPage();

  try {
    // 1. Check if /wp-login.php is accessible (should be hidden via SiteGuard etc.)
    try {
      const loginResp = await page.context().request.get(`${baseUrl}/wp-login.php`, {
        timeout: 10000,
        failOnStatusCode: false,
        maxRedirects: 0,
      });
      const loginStatus = loginResp.status();
      if (loginStatus === 200) {
        items.push({
          name: 'ログインURL変更',
          status: 'fail',
          detail: `${baseUrl}/wp-login.php に直接アクセスできます — SiteGuard WP Plugin等でログインURLを変更し、ブルートフォース攻撃を防止してください`,
        });
      } else if (loginStatus === 302 || loginStatus === 301) {
        items.push({
          name: 'ログインURL変更',
          status: 'pass',
          detail: `${baseUrl}/wp-login.php はリダイレクトされています`,
        });
      } else {
        items.push({
          name: 'ログインURL変更',
          status: 'pass',
          detail: `${baseUrl}/wp-login.php は ${loginStatus} を返しています`,
        });
      }
    } catch {
      items.push({
        name: 'ログインURL変更',
        status: 'pass',
        detail: `${baseUrl}/wp-login.php はアクセスできません`,
      });
    }

    // 2. Check /wp-admin/
    try {
      const adminResp = await page.context().request.get(`${baseUrl}/wp-admin/`, {
        timeout: 10000,
        failOnStatusCode: false,
        maxRedirects: 0,
      });
      if (adminResp.status() === 200) {
        items.push({
          name: '/wp-admin 保護',
          status: 'warn',
          detail: `${baseUrl}/wp-admin/ がリダイレクトなしでアクセスできます`,
        });
      } else {
        items.push({
          name: '/wp-admin 保護',
          status: 'pass',
          detail: 'リダイレクトで保護済み',
        });
      }
    } catch {
      items.push({ name: '/wp-admin 保護', status: 'pass', detail: 'リダイレクトで保護済み' });
    }

    // 3. WP Version detection from meta generator or RSS
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const wpVersion = await page.evaluate(() => {
      const gen = document.querySelector('meta[name="generator"]');
      if (gen) {
        const content = gen.getAttribute('content');
        const match = content?.match(/WordPress\s+([\d.]+)/);
        return match ? match[1] : content;
      }
      return null;
    });

    if (wpVersion) {
      items.push({
        name: 'WPバージョン露出',
        status: 'warn',
        detail: `WordPress ${wpVersion} がメタタグに表示されています（非表示推奨）`,
      });
    } else {
      items.push({
        name: 'WPバージョン露出',
        status: 'pass',
        detail: 'WPバージョンはメタタグに表示されていません',
      });
    }

    // 4. XML Sitemap
    try {
      const sitemapResp = await page.context().request.get(`${baseUrl}/sitemap.xml`, {
        timeout: 10000,
        failOnStatusCode: false,
      });
      if (sitemapResp.status() === 200) {
        items.push({
          name: 'XMLサイトマップ',
          status: 'pass',
          detail: `${baseUrl}/sitemap.xml が存在します`,
        });
      } else {
        // Try sitemap_index.xml
        const indexResp = await page.context().request.get(`${baseUrl}/sitemap_index.xml`, {
          timeout: 10000,
          failOnStatusCode: false,
        });
        if (indexResp.status() === 200) {
          items.push({
            name: 'XMLサイトマップ',
            status: 'pass',
            detail: `${baseUrl}/sitemap_index.xml が存在します`,
          });
        } else {
          items.push({
            name: 'XMLサイトマップ',
            status: 'fail',
            detail: `${baseUrl}/sitemap.xml (または sitemap_index.xml) が見つかりません`,
          });
        }
      }
    } catch {
      items.push({
        name: 'XMLサイトマップ',
        status: 'fail',
        detail: 'XMLサイトマップの確認に失敗',
      });
    }

    // 5. robots.txt — 統合済み: index-checker で実施
    // 重複を避けるためwp-checkerからは削除

    // 6. 404 page check
    try {
      const notFoundPage = await context.newPage();
      await notFoundPage.goto(`${baseUrl}/this-is-a-404-test-page-qa-checker/`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      const is404Custom = await notFoundPage.evaluate(() => {
        // Check if it's a default "Not Found" or custom 404
        // Use main content area instead of entire body to avoid header/footer false positives
        const main = document.querySelector('main, .content, #content, article, .entry-content');
        const mainText = main ? main.textContent.trim() : '';
        // If no main content element, check body but subtract typical header/footer size
        const hasCustomContent = main ? mainText.length > 100 : document.body.textContent.trim().length > 500;
        return hasCustomContent;
      });
      items.push({
        name: '404ページ',
        status: is404Custom ? 'pass' : 'warn',
        detail: is404Custom ? 'カスタム404ページが設定されています' : '404ページがカスタマイズされていない可能性があります',
      });
      await notFoundPage.close();
    } catch {
      items.push({ name: '404ページ', status: 'warn', detail: '確認失敗' });
    }

    // 7. SSL/HTTPS — 統合済み: security-checker で実施
    // 重複を避けるためwp-checkerからは削除

    // 8. XML-RPC check
    try {
      const xmlrpcResp = await page.context().request.get(`${baseUrl}/xmlrpc.php`, {
        timeout: 10000,
        failOnStatusCode: false,
      });
      if (xmlrpcResp.status() === 200) {
        items.push({
          name: 'XML-RPC無効化',
          status: 'warn',
          detail: `${baseUrl}/xmlrpc.php にアクセス可能です（セキュリティ対策として無効化推奨）`,
        });
      } else {
        items.push({
          name: 'XML-RPC無効化',
          status: 'pass',
          detail: 'アクセスブロック済み',
        });
      }
    } catch {
      items.push({ name: 'XML-RPC無効化', status: 'pass', detail: 'アクセスブロック済み' });
    }

    // 9. WP settings — 言語設定はSEOチェッカーのlang属性で確認（重複回避のため削除）

    // 10. Author enumeration check (?author=1)
    try {
      const authorResp = await page.context().request.get(`${baseUrl}/?author=1`, {
        timeout: 10000,
        failOnStatusCode: false,
        maxRedirects: 0,
      });
      const authorStatus = authorResp.status();
      const authorLocation = authorResp.headers()['location'] || '';

      // 301/302 でリダイレクトされ、URLにユーザー名が含まれる場合はNG
      if (authorStatus >= 300 && authorStatus < 400 && authorLocation.includes('/author/')) {
        const username = authorLocation.split('/author/')[1]?.replace(/\//g, '') || '';
        items.push({
          name: 'ユーザー名列挙防止',
          status: 'fail',
          detail: `${baseUrl}/?author=1 でユーザー名が露出しています${username ? ` (${username})` : ''} — 攻撃者にログインIDを知られるリスクがあります`,
        });
      } else if (authorStatus === 200) {
        items.push({
          name: 'ユーザー名列挙防止',
          status: 'warn',
          detail: `${baseUrl}/?author=1 にアクセス可能です — ユーザー名推測のリスクがあります`,
        });
      } else {
        items.push({
          name: 'ユーザー名列挙防止',
          status: 'pass',
          detail: `${baseUrl}/?author=1 によるユーザー名列挙がブロックされています`,
        });
      }
    } catch {
      items.push({
        name: 'ユーザー名列挙防止',
        status: 'pass',
        detail: '確認不可（アクセスブロック済みの可能性）',
      });
    }

    // 11. REST API user enumeration (/wp-json/wp/v2/users)
    try {
      const apiResp = await page.context().request.get(`${baseUrl}/wp-json/wp/v2/users`, {
        timeout: 10000,
        failOnStatusCode: false,
      });
      if (apiResp.status() === 200) {
        let userCount = 0;
        try {
          const data = JSON.parse(await apiResp.text());
          userCount = Array.isArray(data) ? data.length : 0;
        } catch { /* parse error */ }
        items.push({
          name: 'REST APIユーザー情報',
          status: 'warn',
          detail: `${baseUrl}/wp-json/wp/v2/users でユーザー情報が${userCount > 0 ? userCount + '件' : ''}公開されています — ログインID・表示名が外部から取得可能です（制限推奨）`,
        });
      } else {
        items.push({
          name: 'REST APIユーザー情報',
          status: 'pass',
          detail: 'REST APIのユーザー情報は非公開（アクセス制限済み）',
        });
      }
    } catch {
      items.push({
        name: 'REST APIユーザー情報',
        status: 'pass',
        detail: 'REST APIアクセス不可（制限済み）',
      });
    }

    // 12. readme.html / license.txt exposure
    const sensitiveFiles = [
      {
        path: '/readme.html',
        name: 'readme.html',
        purpose: 'WordPressのバージョン情報が記載されており、攻撃者に脆弱性の特定材料を与えてしまいます',
      },
      {
        path: '/license.txt',
        name: 'license.txt',
        purpose: 'WordPressであることが明示され、攻撃の標的にされやすくなります',
      },
    ];

    for (const file of sensitiveFiles) {
      try {
        const resp = await page.context().request.get(`${baseUrl}${file.path}`, {
          timeout: 5000,
          failOnStatusCode: false,
        });
        if (resp.status() === 200) {
          items.push({
            name: `${file.name} 露出`,
            status: 'warn',
            detail: `${baseUrl}${file.path} にアクセス可能です — ${file.purpose}`,
          });
        } else {
          items.push({
            name: `${file.name} 露出`,
            status: 'pass',
            detail: `${baseUrl}${file.path} はアクセスブロック済み`,
          });
        }
      } catch {
        items.push({
          name: `${file.name} 露出`,
          status: 'pass',
          detail: `${file.path} アクセス不可`,
        });
      }
    }

    // 13. Directory listing (/wp-content/uploads/)
    try {
      const dirResp = await page.context().request.get(`${baseUrl}/wp-content/uploads/`, {
        timeout: 10000,
        failOnStatusCode: false,
      });
      if (dirResp.status() === 200) {
        const body = await dirResp.text();
        // ディレクトリリスティングの典型的なパターンを検出
        const isListing = body.includes('Index of') || body.includes('Parent Directory') || body.includes('<title>Index of');
        if (isListing) {
          items.push({
            name: 'ディレクトリリスティング',
            status: 'fail',
            detail: `${baseUrl}/wp-content/uploads/ のファイル一覧が外部から閲覧可能です — アップロード画像やファイル名から情報が漏洩するリスクがあります`,
          });
        } else {
          items.push({
            name: 'ディレクトリリスティング',
            status: 'pass',
            detail: `${baseUrl}/wp-content/uploads/ のディレクトリリスティングは無効`,
          });
        }
      } else {
        items.push({
          name: 'ディレクトリリスティング',
          status: 'pass',
          detail: `${baseUrl}/wp-content/uploads/ はアクセス制限済み`,
        });
      }
    } catch {
      items.push({
        name: 'ディレクトリリスティング',
        status: 'pass',
        detail: '確認不可',
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

  return { name: 'WordPress固有チェック', status: overallStatus, items };
}
