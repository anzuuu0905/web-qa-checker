// ===========================================
// html-validator.js - HTML品質チェッカー (V2)
// ===========================================

/**
 * Check HTML quality - W3C validation, closing tags, debug code
 * @param {string} html - Page HTML content
 * @param {string} url - Page URL for context
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkHtml(html, url) {
  const items = [];

  // 1. Debug code detection
  const debugPatterns = [
    { pattern: /var_dump\s*\(/gi, name: 'var_dump()' },
    { pattern: /console\.(log|debug|info)\s*\(/gi, name: 'console.log()' },
    { pattern: /\bdd\s*\(/gi, name: 'dd()' },
    { pattern: /print_r\s*\(/gi, name: 'print_r()' },
    { pattern: /error_log\s*\(/gi, name: 'error_log()' },
  ];

  let debugFound = false;
  // Exclude <script> tag contents to avoid false positives from minified JS (WP plugins/themes)
  const htmlWithoutScript = html.replace(/<script[\s\S]*?<\/script>/gi, '');

  for (const { pattern, name } of debugPatterns) {
    const matches = htmlWithoutScript.match(pattern);
    if (matches) {
      debugFound = true;
      // V2: Show context around debug code
      const contexts = [];
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(htmlWithoutScript)) !== null && contexts.length < 3) {
        const start = Math.max(0, match.index - 40);
        const end = Math.min(htmlWithoutScript.length, match.index + match[0].length + 40);
        const line = htmlWithoutScript.slice(0, match.index).split('\n').length;
        contexts.push({
          message: `行${line}: ...${htmlWithoutScript.slice(start, end).replace(/\n/g, ' ').trim()}...`,
        });
      }
      items.push({
        name: `デバッグコード: ${name}`,
        status: 'fail',
        detail: `${matches.length}箇所のデバッグコードが残っています`,
        subItems: contexts,
      });
    }
  }
  if (!debugFound) {
    items.push({
      name: 'デバッグコード残存',
      status: 'pass',
      detail: 'var_dump, console.log, dd, print_r, error_log いずれも検出なし',
    });
  }

  // 2. Unnecessary HTML comments
  const commentPattern = /<!--(?!\[if|\s*\/?wp:|<!)\s*(?!-->)([\s\S]*?)-->/g;
  const comments = html.match(commentPattern) || [];
  const suspiciousComments = comments.filter((c) => {
    const content = c.replace(/<!--|-->/g, '').trim();
    return (
      content.length > 0 &&
      !content.startsWith('[if') &&
      !content.startsWith('wp:') &&
      !content.startsWith('/wp:') &&
      !content.startsWith('Google') &&
      !content.startsWith('Global') &&
      content.length < 500
    );
  });

  if (suspiciousComments.length > 5) {
    items.push({
      name: 'HTMLコメント',
      status: 'warn',
      detail: `${suspiciousComments.length}個のHTMLコメントが残っています`,
      subItems: suspiciousComments.slice(0, 3).map(c => ({
        message: c.replace(/<!--|-->/g, '').trim().slice(0, 80),
      })),
    });
  } else {
    items.push({
      name: 'HTMLコメント',
      status: 'pass',
      detail: `${suspiciousComments.length}個（問題なし）`,
    });
  }

  // 3. W3C HTML Validation via API
  try {
    const w3cResult = await validateW3C(html);
    const allErrors = w3cResult.filter((m) => m.type === 'error');
    const warnings = w3cResult.filter((m) => m.type === 'info' && m.subType === 'warning');

    // V2.1: Separate real errors from known false positives (OK errors)
    const { realErrors, okErrors } = classifyErrors(allErrors);

    // Generate W3C validator URL
    const w3cUrl = `https://validator.w3.org/nu/?doc=${encodeURIComponent(url)}`;

    // Real errors
    if (realErrors.length > 0) {
      items.push({
        name: 'W3C HTMLバリデーション',
        status: 'fail',
        detail: `${realErrors.length}件のエラー, ${warnings.length}件の警告`,
        subItems: [
          { message: `🔗 W3C検証結果: ${w3cUrl}` },
          ...realErrors.slice(0, 8).map((e) => ({
            message: `行${e.lastLine || '?'}: ${e.message}`,
          })),
        ],
      });
    } else if (warnings.length > 0) {
      items.push({
        name: 'W3C HTMLバリデーション',
        status: 'warn',
        detail: `エラーなし, ${warnings.length}件の警告`,
        subItems: [
          { message: `🔗 W3C検証結果: ${w3cUrl}` },
          ...warnings.slice(0, 5).map(w => ({
            message: `行${w.lastLine || '?'}: ${w.message}`,
          })),
        ],
      });
    } else {
      items.push({
        name: 'W3C HTMLバリデーション',
        status: 'pass',
        detail: 'エラー・警告なし（W3C準拠）',
        subItems: [{ message: `🔗 W3C検証結果: ${w3cUrl}` }],
      });
    }

    // OK errors (known false positives) — always show if any
    if (okErrors.length > 0) {
      items.push({
        name: 'W3C OKエラー（既知の誤検知）',
        status: 'pass',
        detail: `${okErrors.length}件 — W3C Validatorが未対応だが正しいCSS/HTML`,
        subItems: okErrors.map(e => ({
          message: `✅ 行${e.lastLine || '?'}: ${e.message} → 理由: ${e.okReason}`,
        })),
      });
    }
  } catch (err) {
    const w3cUrl = `https://validator.w3.org/nu/?doc=${encodeURIComponent(url)}`;
    items.push({
      name: 'W3C HTMLバリデーション',
      status: 'warn',
      detail: `W3C API接続エラー: ${err.message}`,
      subItems: [{ message: `🔗 手動確認: ${w3cUrl}` }],
    });
  }

  // 4. DOCTYPE check
  if (!html.trimStart().toLowerCase().startsWith('<!doctype html')) {
    items.push({
      name: 'DOCTYPE宣言',
      status: 'fail',
      detail: '<!DOCTYPE html> 宣言がありません',
    });
  } else {
    items.push({
      name: 'DOCTYPE宣言',
      status: 'pass',
      detail: '<!DOCTYPE html> 宣言済み',
    });
  }

  // 5. charset check
  if (!/\<meta[^>]*charset=['\"]?utf-8['\"]?/i.test(html)) {
    items.push({
      name: 'charset宣言',
      status: 'warn',
      detail: 'charset=utf-8 の宣言が見つかりません',
    });
  } else {
    items.push({
      name: 'charset宣言',
      status: 'pass',
      detail: 'charset=UTF-8 設定済み',
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'HTML品質チェック', status: overallStatus, items };
}

/**
 * Validate HTML against W3C API
 * @param {string} html
 * @returns {Promise<Array>}
 */
async function validateW3C(html) {
  const response = await fetch('https://validator.w3.org/nu/?out=json', {
    method: 'POST',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.messages || [];
}

/**
 * Known false positives from W3C Validator
 * These are valid CSS/HTML but the validator doesn't support them yet
 */
const KNOWN_FALSE_POSITIVES = [
  {
    pattern: /contain-intrinsic-size/i,
    reason: 'CSS Containment Level 2 の正式プロパティ。全主要ブラウザ対応済みだがW3C Validatorが未対応',
  },
  {
    pattern: /content-visibility/i,
    reason: 'CSS Containment Level 2 の正式プロパティ。パフォーマンス最適化用。W3C Validatorが未対応',
  },
  {
    pattern: /overflow-clip-margin/i,
    reason: 'CSS Overflow Module Level 3 の正式プロパティ。W3C Validatorが未対応',
  },
  {
    pattern: /text-wrap.*balance/i,
    reason: 'CSS Text Level 4 の正式プロパティ。W3C Validatorが未対応',
  },
  {
    pattern: /color-scheme/i,
    reason: 'CSS Color Adjustment Module の正式プロパティ。ダークモード対応用。W3C Validatorが未対応',
  },
  {
    pattern: /scrollbar-gutter/i,
    reason: 'CSS Overflow Module Level 3 の正式プロパティ。W3C Validatorが未対応',
  },
];

/**
 * Classify W3C errors into real errors and known false positives (OK errors)
 * @param {Array} errors
 * @returns {{ realErrors: Array, okErrors: Array }}
 */
function classifyErrors(errors) {
  const realErrors = [];
  const okErrors = [];

  for (const err of errors) {
    const msg = err.message || '';
    const match = KNOWN_FALSE_POSITIVES.find(fp => fp.pattern.test(msg));
    if (match) {
      okErrors.push({ ...err, okReason: match.reason });
    } else {
      realErrors.push(err);
    }
  }

  return { realErrors, okErrors };
}
