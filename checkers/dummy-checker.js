// ===========================================
// dummy-checker.js - ダミーコンテンツ検出チェッカー
// ===========================================

/**
 * Detect dummy/test content that should be removed before launch
 * @param {import('playwright').Page} page
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkDummy(page) {
  const items = [];

  const findings = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const bodyHtml = document.body.innerHTML;

    // Patterns to search for
    const patterns = [
      // Lorem ipsum
      { regex: /lorem\s+ipsum/gi, name: 'Lorem ipsum', type: 'ダミーテキスト' },
      { regex: /dolor\s+sit\s+amet/gi, name: 'dolor sit amet', type: 'ダミーテキスト' },

      // Japanese dummy text
      { regex: /テキストが入ります/gi, name: 'テキストが入ります', type: 'ダミーテキスト' },
      { regex: /ダミーテキスト/gi, name: 'ダミーテキスト', type: 'ダミーテキスト' },
      { regex: /ここにテキスト/gi, name: 'ここにテキスト', type: 'ダミーテキスト' },
      { regex: /サンプルテキスト/gi, name: 'サンプルテキスト', type: 'ダミーテキスト' },
      { regex: /テストテキスト/gi, name: 'テストテキスト', type: 'ダミーテキスト' },
      { regex: /仮テキスト/gi, name: '仮テキスト', type: 'ダミーテキスト' },
      { regex: /テキストテキスト/gi, name: 'テキストテキスト', type: 'ダミーテキスト' },
      { regex: /あいうえお/gi, name: 'あいうえお', type: 'ダミーテキスト' },
      { regex: /吾輩は猫である/gi, name: '吾輩は猫である（夏目漱石ダミー）', type: 'ダミーテキスト' },

      // Test post indicators
      { regex: /テスト投稿/gi, name: 'テスト投稿', type: 'テスト投稿' },
      { regex: /テスト記事/gi, name: 'テスト記事', type: 'テスト投稿' },
      { regex: /Hello\s+World/gi, name: 'Hello World', type: 'テスト投稿' },
      { regex: /Hello\s+world!/gi, name: 'Hello world!', type: 'テスト投稿' },
      { regex: /サンプルページ/gi, name: 'サンプルページ', type: 'テスト投稿' },
      { regex: /Sample\s+Page/gi, name: 'Sample Page', type: 'テスト投稿' },

      // WordPress defaults
      { regex: /これはWordPressへの最初の投稿/gi, name: 'WP初期投稿', type: 'テスト投稿' },
      { regex: /Just another WordPress site/gi, name: 'Just another WordPress site', type: 'WP初期設定' },
      { regex: /もう一つのWordPressサイト/gi, name: 'もう一つのWordPressサイト', type: 'WP初期設定' },

      // Placeholder images
      { regex: /placehold\.it/gi, name: 'placehold.it', type: 'ダミー画像' },
      { regex: /placeholder\.com/gi, name: 'placeholder.com', type: 'ダミー画像' },
      { regex: /via\.placeholder/gi, name: 'via.placeholder', type: 'ダミー画像' },
      { regex: /picsum\.photos/gi, name: 'picsum.photos', type: 'ダミー画像' },
      { regex: /dummyimage\.com/gi, name: 'dummyimage.com', type: 'ダミー画像' },

      // Common test email/phone
      { regex: /test@test\.com/gi, name: 'test@test.com', type: 'テストデータ' },
      { regex: /test@example\.com/gi, name: 'test@example.com', type: 'テストデータ' },
      { regex: /example@example\.com/gi, name: 'example@example.com', type: 'テストデータ' },
      { regex: /000-0000-0000/gi, name: '000-0000-0000', type: 'テストデータ' },

      // TODO / FIXME in visible text
      { regex: /\bTODO\b/g, name: 'TODO', type: '開発メモ' },
      { regex: /\bFIXME\b/g, name: 'FIXME', type: '開発メモ' },
      { regex: /\bHACK\b/g, name: 'HACK', type: '開発メモ' },
    ];

    const results = [];

    for (const { regex, name, type } of patterns) {
      // Search in visible text
      const textMatches = bodyText.match(regex);
      if (textMatches) {
        // Get context around the match
        const idx = bodyText.search(regex);
        const context = bodyText.slice(Math.max(0, idx - 20), idx + 60).trim();
        results.push({
          name,
          type,
          count: textMatches.length,
          location: 'ページ表示テキスト',
          context: context.slice(0, 80),
        });
      }

      // Search in HTML (for hidden elements, placeholders, etc.)
      if (type === 'ダミー画像') {
        const htmlMatches = bodyHtml.match(regex);
        if (htmlMatches && !textMatches) {
          results.push({
            name,
            type,
            count: htmlMatches.length,
            location: 'HTML（非表示要素含む）',
            context: '',
          });
        }
      }
    }

    // Check for WordPress default tagline in title
    const title = document.title;
    if (title.includes('Just another') || title.includes('もう一つの')) {
      results.push({
        name: 'WPデフォルトキャッチフレーズ（title内）',
        type: 'WP初期設定',
        count: 1,
        location: 'titleタグ',
        context: title,
      });
    }

    return results;
  });

  // Build results
  if (findings.length > 0) {
    // Group by type
    const grouped = {};
    for (const f of findings) {
      if (!grouped[f.type]) grouped[f.type] = [];
      grouped[f.type].push(f);
    }

    for (const [type, finds] of Object.entries(grouped)) {
      items.push({
        name: `${type}`,
        status: type === '開発メモ' ? 'warn' : 'fail',
        detail: `${finds.length}種類のパターンを検出`,
        subItems: finds.map((f) => ({
          message: `"${f.name}" × ${f.count}箇所（${f.location}）${f.context ? ` : "...${f.context}..."` : ''}`,
        })),
      });
    }
  } else {
    items.push({
      name: 'ダミーコンテンツ',
      status: 'pass',
      detail: 'テスト投稿・ダミーテキスト・プレースホルダー画像は検出されませんでした',
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'ダミーコンテンツチェック', status: overallStatus, items };
}
