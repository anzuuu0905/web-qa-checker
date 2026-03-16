// ===========================================
// security-checker.js - セキュリティチェッカー
// (SSL, Mixed Content, target="_blank", HTTP redirect)
// ===========================================

/**
 * Check security-related items
 * @param {import('playwright').Page} page
 * @param {string} siteUrl - Base URL of the site
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkSecurity(page, siteUrl) {
  const items = [];

  // 1. SSL / HTTPS check
  const isHttps = siteUrl.startsWith('https://');
  items.push({
    name: 'HTTPS',
    status: isHttps ? 'pass' : 'fail',
    detail: isHttps ? 'HTTPS で提供中' : 'HTTPで提供されています（HTTPS推奨）',
  });

  // 2. Mixed Content check
  if (isHttps) {
    const mixedContent = await page.evaluate(() => {
      const mixed = [];

      // Check images
      document.querySelectorAll('img[src^="http:"]').forEach(el => {
        mixed.push({ type: 'img', src: el.src.slice(0, 100) });
      });

      // Check scripts
      document.querySelectorAll('script[src^="http:"]').forEach(el => {
        mixed.push({ type: 'script', src: el.src.slice(0, 100) });
      });

      // Check stylesheets
      document.querySelectorAll('link[href^="http:"]').forEach(el => {
        if (el.rel === 'stylesheet') {
          mixed.push({ type: 'css', src: el.href.slice(0, 100) });
        }
      });

      // Check iframes
      document.querySelectorAll('iframe[src^="http:"]').forEach(el => {
        mixed.push({ type: 'iframe', src: el.src.slice(0, 100) });
      });

      return mixed;
    });

    if (mixedContent.length > 0) {
      items.push({
        name: 'Mixed Content',
        status: 'fail',
        detail: `${mixedContent.length}件 — 安全な(HTTPS)ページ内にセキュリティ保護のない(HTTP)リソースが混在`,
        subItems: mixedContent.slice(0, 5).map(m => ({
          message: `[${m.type}] ${m.src}`,
        })),
      });
    } else {
      items.push({
        name: 'Mixed Content',
        status: 'pass',
        detail: 'HTTPリソースの混在なし（全てHTTPSで安全）',
      });
    }
  }

  // 3. target="_blank" with rel="noopener" check
  const blankLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a[target="_blank"]');
    const unsafe = [];
    let total = 0;

    for (const a of links) {
      total++;
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      if (!rel.includes('noopener') && !rel.includes('noreferrer')) {
        unsafe.push({
          href: a.href.slice(0, 80),
          text: a.textContent.trim().slice(0, 40) || a.querySelector('img')?.alt || '(テキストなし)',
          rel: rel || '(なし)',
        });
      }
    }

    return { unsafe, total };
  });

  if (blankLinks.unsafe.length > 0) {
    items.push({
      name: 'target="_blank" セキュリティ',
      status: 'warn',
      detail: `${blankLinks.unsafe.length}/${blankLinks.total}件にセキュリティ属性(rel="noopener")が未設定 — 悪意あるページからの操作リスクがあります`,
      subItems: blankLinks.unsafe.slice(0, 5).map(l => ({
        message: `"${l.text}" → ${l.href} (rel="${l.rel}")`,
      })),
    });
  } else {
    items.push({
      name: 'target="_blank" セキュリティ',
      status: 'pass',
      detail: `全${blankLinks.total}件にrel="noopener"設定済み`,
    });
  }

  // 4. HTTP → HTTPS redirect check (site-wide)
  try {
    const httpUrl = siteUrl.replace('https://', 'http://');
    const response = await page.context().request.get(httpUrl, {
      timeout: 10000,
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const status = response.status();
    const location = response.headers()['location'] || '';

    if (status >= 300 && status < 400 && location.startsWith('https://')) {
      items.push({
        name: 'HTTP → HTTPS リダイレクト',
        status: 'pass',
        detail: `HTTP → HTTPS に正常リダイレクト (${status})`,
      });
    } else if (status >= 300 && status < 400) {
      items.push({
        name: 'HTTP → HTTPS リダイレクト',
        status: 'warn',
        detail: `リダイレクト先がHTTPSではありません: ${location.slice(0, 80)}`,
      });
    } else {
      items.push({
        name: 'HTTP → HTTPS リダイレクト',
        status: 'fail',
        detail: `HTTPからHTTPSへのリダイレクトが設定されていません (status: ${status}) — .htaccessまたはサーバー設定で301リダイレクトを設定してください`,
      });
    }
  } catch {
    items.push({
      name: 'HTTP → HTTPS リダイレクト',
      status: 'warn',
      detail: 'リダイレクト確認不可（ネットワークエラー）',
    });
  }

  // 5. www redirect consistency check
  try {
    const url = new URL(siteUrl);
    const hasWww = url.hostname.startsWith('www.');
    const alternateHost = hasWww
      ? url.hostname.replace('www.', '')
      : 'www.' + url.hostname;
    const alternateUrl = `${url.protocol}//${alternateHost}${url.pathname}`;

    const response = await page.context().request.get(alternateUrl, {
      timeout: 10000,
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const status = response.status();

    if (status >= 300 && status < 400) {
      items.push({
        name: 'www 正規化',
        status: 'pass',
        detail: `${hasWww ? 'non-www' : 'www'} → ${hasWww ? 'www' : 'non-www'} にリダイレクト設定済み`,
      });
    } else {
      items.push({
        name: 'www 正規化',
        status: 'warn',
        detail: `${alternateHost} からのリダイレクトが未設定（URL正規化推奨）`,
      });
    }
  } catch {
    items.push({
      name: 'www 正規化',
      status: 'warn',
      detail: 'www正規化の確認不可',
    });
  }

  // 6. Security Headers check
  try {
    const response = await page.context().request.get(siteUrl, {
      timeout: 10000,
      failOnStatusCode: false,
    });
    const headers = response.headers();

    // セキュリティヘッダーの定義（name, headerKey, 意図説明）
    const securityHeaders = [
      {
        name: 'X-Frame-Options',
        key: 'x-frame-options',
        purpose: '他サイトからiframe経由でページを埋め込まれる「クリックジャッキング攻撃」を防止',
        recommendation: 'DENY または SAMEORIGIN を設定してください',
      },
      {
        name: 'X-Content-Type-Options',
        key: 'x-content-type-options',
        purpose: 'ブラウザがファイルの種類を勝手に推測（MIME sniffing）するのを防止し、悪意あるスクリプト実行を阻止',
        recommendation: 'nosniff を設定してください',
      },
      {
        name: 'Strict-Transport-Security (HSTS)',
        key: 'strict-transport-security',
        purpose: 'ブラウザに「常にHTTPSで接続する」よう強制し、HTTP経由の盗聴・改ざんを防止',
        recommendation: 'max-age=31536000; includeSubDomains を設定してください',
      },
      {
        name: 'Content-Security-Policy',
        key: 'content-security-policy',
        purpose: '許可されていない外部スクリプトやリソースの読み込みを制限し、XSS攻撃を防止',
        recommendation: '適切なCSPポリシーの設定を検討してください',
        severity: 'warn', // CSPは複雑で必須ではないためwarn
      },
      {
        name: 'Referrer-Policy',
        key: 'referrer-policy',
        purpose: '他サイトへ移動する際にURLの情報がどこまで送信されるかを制御し、プライバシーを保護',
        recommendation: 'strict-origin-when-cross-origin 等を設定してください',
        severity: 'warn',
      },
      {
        name: 'Permissions-Policy',
        key: 'permissions-policy',
        purpose: 'カメラ・マイク・位置情報など、ブラウザのAPI利用を制限し、悪用を防止',
        recommendation: '不要なAPIを無効化する設定を検討してください',
        severity: 'warn',
      },
    ];

    const missingHeaders = [];
    const presentHeaders = [];

    for (const sh of securityHeaders) {
      const value = headers[sh.key];
      if (value) {
        presentHeaders.push(sh);
      } else {
        missingHeaders.push(sh);
      }
    }

    // 基本ヘッダー（warn相当＝推奨）とオプショナル（warn相当）を分離
    const criticalMissing = missingHeaders.filter(h => !h.severity);
    const optionalMissing = missingHeaders.filter(h => h.severity === 'warn');

    if (criticalMissing.length > 0) {
      items.push({
        name: 'セキュリティヘッダー（推奨）',
        status: 'warn',
        detail: `${criticalMissing.length}個の推奨セキュリティヘッダーが未設定`,
        subItems: criticalMissing.map(h => ({
          message: `⚠️ ${h.name} — ${h.purpose}`,
        })),
      });
    } else {
      items.push({
        name: 'セキュリティヘッダー（推奨）',
        status: 'pass',
        detail: '推奨セキュリティヘッダー3種が全て設定済み',
      });
    }

    if (optionalMissing.length > 0) {
      items.push({
        name: 'セキュリティヘッダー（推奨）',
        status: 'warn',
        detail: `${optionalMissing.length}個の推奨ヘッダーが未設定`,
        subItems: optionalMissing.map(h => ({
          message: `⚠️ ${h.name} — ${h.purpose}`,
        })),
      });
    }

    if (presentHeaders.length > 0) {
      items.push({
        name: 'セキュリティヘッダー一覧',
        status: 'pass',
        detail: `${presentHeaders.length}/${securityHeaders.length}種類のセキュリティヘッダーを検出`,
        subItems: presentHeaders.map(h => ({
          message: `✅ ${h.name}: ${headers[h.key].slice(0, 80)}`,
        })),
      });
    }

    // 7. Cookie security flags
    const setCookieHeaders = response.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
    if (setCookieHeaders.length > 0) {
      const insecureCookies = [];
      for (const cookie of setCookieHeaders) {
        const value = cookie.value.toLowerCase();
        const cookieName = cookie.value.split('=')[0].trim();
        const issues = [];
        if (!value.includes('secure')) issues.push('Secure属性なし');
        if (!value.includes('httponly')) issues.push('HttpOnly属性なし');
        if (!value.includes('samesite')) issues.push('SameSite属性なし');
        if (issues.length > 0) {
          insecureCookies.push({ name: cookieName, issues });
        }
      }

      if (insecureCookies.length > 0) {
        items.push({
          name: 'Cookieセキュリティ',
          status: 'warn',
          detail: `${insecureCookies.length}/${setCookieHeaders.length}個のCookieにセキュリティ属性が不足 — Cookie盗用やCSRF攻撃のリスクがあります`,
          subItems: insecureCookies.slice(0, 5).map(c => ({
            message: `${c.name}: ${c.issues.join(', ')}`,
          })),
        });
      } else {
        items.push({
          name: 'Cookieセキュリティ',
          status: 'pass',
          detail: `全${setCookieHeaders.length}個のCookieにSecure/HttpOnly/SameSite設定済み`,
        });
      }
    }
  } catch {
    items.push({
      name: 'セキュリティヘッダー',
      status: 'warn',
      detail: 'セキュリティヘッダーの確認不可（ネットワークエラー）',
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'セキュリティチェック', status: overallStatus, items };
}
