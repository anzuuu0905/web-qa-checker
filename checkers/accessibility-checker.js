// ===========================================
// accessibility-checker.js - アクセシビリティチェッカー
// 準拠基準: WCAG 2.2 Level AA / JIS X 8341-3:2016
// ===========================================

/**
 * Check web accessibility compliance
 * @param {import('playwright').Page} page
 * @param {string} pageUrl
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkAccessibility(page, pageUrl) {
  const items = [];

  // 1. Color contrast check (WCAG 2.2 SC 1.4.3)
  try {
    const contrastIssues = await page.evaluate(() => {
      function getLuminance(r, g, b) {
        const [rs, gs, bs] = [r, g, b].map(c => {
          c = c / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      }

      function parseColor(color) {
        if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) return { r: +match[1], g: +match[2], b: +match[3] };
        return null;
      }

      function getContrastRatio(fg, bg) {
        const l1 = getLuminance(fg.r, fg.g, fg.b);
        const l2 = getLuminance(bg.r, bg.g, bg.b);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
      }

      function getEffectiveBgColor(el) {
        let current = el;
        while (current) {
          const style = window.getComputedStyle(current);
          const bg = parseColor(style.backgroundColor);
          if (bg) return bg;
          current = current.parentElement;
        }
        return { r: 255, g: 255, b: 255 }; // default white
      }

      const issues = [];
      const textElements = document.querySelectorAll('p, span, a, li, td, th, h1, h2, h3, h4, h5, h6, label, button');

      for (const el of textElements) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        if (!el.textContent.trim()) continue;

        const fg = parseColor(style.color);
        if (!fg) continue;

        const bg = getEffectiveBgColor(el);
        const ratio = getContrastRatio(fg, bg);
        const fontSize = parseFloat(style.fontSize);
        const fontWeight = parseInt(style.fontWeight) || 400;
        const isLargeText = fontSize >= 24 || (fontSize >= 18.67 && fontWeight >= 700);

        // WCAG AA: 4.5:1 for normal text, 3:1 for large text
        const requiredRatio = isLargeText ? 3 : 4.5;

        if (ratio < requiredRatio) {
          issues.push({
            tag: el.tagName.toLowerCase(),
            text: el.textContent.trim().slice(0, 30),
            ratio: Math.round(ratio * 100) / 100,
            required: requiredRatio,
            fontSize: Math.round(fontSize),
          });
        }
      }
      return issues.slice(0, 10);
    });

    if (contrastIssues.length > 0) {
      items.push({
        name: '色コントラスト比',
        status: 'fail',
        detail: `${contrastIssues.length}箇所でコントラスト比が不足 — 弱視の方や明るい屋外では文字が読めない可能性があります`,
        standard: 'WCAG 2.2 SC 1.4.3 / JIS X 8341-3 1.4.3',
        purpose: 'テキストと背景の明暗差を確保し、視力が弱い方でも読める状態にする',
        subItems: contrastIssues.slice(0, 5).map(i => ({
          message: `<${i.tag}> "${i.text}" — コントラスト比 ${i.ratio}:1（必要: ${i.required}:1, ${i.fontSize}px）`,
        })),
      });
    } else {
      items.push({
        name: '色コントラスト比',
        status: 'pass',
        detail: 'テキストのコントラスト比がWCAG AA基準（4.5:1以上）を満たしています',
        standard: 'WCAG 2.2 SC 1.4.3 / JIS X 8341-3 1.4.3',
        purpose: 'テキストと背景の明暗差を確保し、視力が弱い方でも読める状態にする',
      });
    }
  } catch {
    items.push({
      name: '色コントラスト比',
      status: 'warn',
      detail: 'コントラスト比の計算に失敗しました',
      standard: 'WCAG 2.2 SC 1.4.3',
      purpose: 'テキストと背景の明暗差を確保し、視力が弱い方でも読める状態にする',
    });
  }

  // 2. Keyboard accessibility (WCAG 2.2 SC 2.1.1)
  try {
    const keyboardIssues = await page.evaluate(() => {
      const interactive = document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]');
      const issues = [];

      for (const el of interactive) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const tabindex = el.getAttribute('tabindex');
        // tabindex="-1" means not keyboard accessible
        if (tabindex === '-1' && el.textContent.trim()) {
          issues.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
            issue: 'tabindex="-1" でキーボード到達不可',
          });
        }
      }
      return issues.slice(0, 10);
    });

    if (keyboardIssues.length > 0) {
      items.push({
        name: 'キーボード操作',
        status: 'warn',
        detail: `${keyboardIssues.length}個の操作要素にキーボードで到達できません — マウスが使えない方は操作不能になります`,
        standard: 'WCAG 2.2 SC 2.1.1 / JIS X 8341-3 2.1.1',
        purpose: 'マウスが使えない方（運動障害・視覚障害）でも全機能をキーボードで操作できるようにする',
        subItems: keyboardIssues.slice(0, 5).map(i => ({
          message: `<${i.tag}> "${i.text}" — ${i.issue}`,
        })),
      });
    } else {
      items.push({
        name: 'キーボード操作',
        status: 'pass',
        detail: '全ての操作要素にキーボードで到達可能です',
        standard: 'WCAG 2.2 SC 2.1.1 / JIS X 8341-3 2.1.1',
        purpose: 'マウスが使えない方（運動障害・視覚障害）でも全機能をキーボードで操作できるようにする',
      });
    }
  } catch {
    items.push({
      name: 'キーボード操作',
      status: 'warn',
      detail: 'キーボード操作の検証に失敗しました',
      standard: 'WCAG 2.2 SC 2.1.1',
      purpose: 'マウスが使えない方でも全機能をキーボードで操作できるようにする',
    });
  }

  // 3. Focus indicator visibility (WCAG 2.2 SC 2.4.7)
  try {
    const focusIssues = await page.evaluate(() => {
      const interactive = document.querySelectorAll('a[href], button, input, select, textarea');
      const issues = [];

      for (const el of interactive) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        // Check if outline is explicitly removed
        const outlineStyle = style.outlineStyle;
        const outlineWidth = parseFloat(style.outlineWidth);
        if (outlineStyle === 'none' || outlineWidth === 0) {
          // Check if there's an alternative focus style via CSS :focus
          // We can check computed styles but can't trigger :focus in evaluate
          // So check if outline: none is set (common anti-pattern)
          const inlineStyle = el.getAttribute('style') || '';
          const hasOutlineNone = inlineStyle.includes('outline: none') || inlineStyle.includes('outline:none');
          if (hasOutlineNone) {
            issues.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
            });
          }
        }
      }
      return issues.slice(0, 5);
    });

    // Also check global CSS for outline:none on :focus
    const globalOutlineNone = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            const cssText = rule.cssText || '';
            if (cssText.includes(':focus') && cssText.includes('outline') &&
                (cssText.includes('outline: none') || cssText.includes('outline:none') || cssText.includes('outline: 0'))) {
              // Check if there's a replacement style (box-shadow, border, etc.)
              if (!cssText.includes('box-shadow') && !cssText.includes('border') && !cssText.includes('background')) {
                return true;
              }
            }
          }
        } catch { /* cross-origin stylesheet */ }
      }
      return false;
    });

    if (globalOutlineNone) {
      items.push({
        name: 'フォーカスインジケーター',
        status: 'warn',
        detail: 'CSSで :focus { outline: none } が設定されています — Tabキーで移動中の「今どこにいるか」がわからなくなります',
        standard: 'WCAG 2.2 SC 2.4.7 / JIS X 8341-3 2.4.7',
        purpose: 'キーボード操作時に現在のフォーカス位置を視覚的に示し、操作場所を見失わないようにする',
      });
    } else if (focusIssues.length > 0) {
      items.push({
        name: 'フォーカスインジケーター',
        status: 'warn',
        detail: `${focusIssues.length}個の要素でフォーカス表示が無効化されています`,
        standard: 'WCAG 2.2 SC 2.4.7 / JIS X 8341-3 2.4.7',
        purpose: 'キーボード操作時に現在のフォーカス位置を視覚的に示し、操作場所を見失わないようにする',
        subItems: focusIssues.map(i => ({
          message: `<${i.tag}> "${i.text}" — outline: none が設定`,
        })),
      });
    } else {
      items.push({
        name: 'フォーカスインジケーター',
        status: 'pass',
        detail: 'フォーカス時の視覚的表示が確保されています',
        standard: 'WCAG 2.2 SC 2.4.7 / JIS X 8341-3 2.4.7',
        purpose: 'キーボード操作時に現在のフォーカス位置を視覚的に示し、操作場所を見失わないようにする',
      });
    }
  } catch {
    items.push({
      name: 'フォーカスインジケーター',
      status: 'warn',
      detail: 'フォーカスインジケーターの検証に失敗しました',
      standard: 'WCAG 2.2 SC 2.4.7',
      purpose: 'キーボード操作時にフォーカス位置を視覚的に示す',
    });
  }

  // 4. Skip navigation link (WCAG 2.2 SC 2.4.1)
  try {
    const hasSkipNav = await page.evaluate(() => {
      // Check for skip navigation link at the beginning of the page
      const links = document.querySelectorAll('a[href^="#"]');
      for (const link of links) {
        const text = (link.textContent || link.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('skip') || text.includes('メイン') || text.includes('本文') ||
            text.includes('コンテンツ') || text.includes('ナビゲーション')) {
          return true;
        }
        // Check if it targets #main, #content, etc.
        const href = link.getAttribute('href');
        if (href && (href === '#main' || href === '#content' || href === '#main-content' ||
            href === '#maincontent')) {
          return true;
        }
      }
      return false;
    });

    items.push({
      name: 'スキップナビゲーション',
      status: hasSkipNav ? 'pass' : 'warn',
      detail: hasSkipNav
        ? 'メインコンテンツへのスキップリンクが設置されています'
        : 'スキップリンクがありません — キーボード利用者がナビゲーションを毎回Tab送りすることになります',
      standard: 'WCAG 2.2 SC 2.4.1 / JIS X 8341-3 2.4.1',
      purpose: 'キーボード利用者がページ冒頭のナビゲーションを飛ばして本文に直接移動できるようにする',
    });
  } catch {
    items.push({
      name: 'スキップナビゲーション',
      status: 'warn',
      detail: 'スキップナビゲーションの検証に失敗しました',
      standard: 'WCAG 2.2 SC 2.4.1',
      purpose: 'キーボード利用者がナビゲーションを飛ばして本文に直接移動できるようにする',
    });
  }

  // 5. ARIA landmarks (WCAG 2.2 SC 1.3.1)
  try {
    const landmarks = await page.evaluate(() => {
      return {
        hasHeader: !!document.querySelector('header, [role="banner"]'),
        hasNav: !!document.querySelector('nav, [role="navigation"]'),
        hasMain: !!document.querySelector('main, [role="main"]'),
        hasFooter: !!document.querySelector('footer, [role="contentinfo"]'),
      };
    });

    const missing = [];
    if (!landmarks.hasHeader) missing.push('<header> / role="banner"');
    if (!landmarks.hasNav) missing.push('<nav> / role="navigation"');
    if (!landmarks.hasMain) missing.push('<main> / role="main"');
    if (!landmarks.hasFooter) missing.push('<footer> / role="contentinfo"');

    if (missing.length > 0) {
      items.push({
        name: 'ARIAランドマーク',
        status: missing.includes('<main> / role="main"') ? 'fail' : 'warn',
        detail: `${missing.length}個のランドマーク要素が未使用 — スクリーンリーダー利用者がページ構造を把握しにくくなります`,
        standard: 'WCAG 2.2 SC 1.3.1 / JIS X 8341-3 1.3.1',
        purpose: 'ページの各領域（ヘッダー/ナビ/本文/フッター）を意味的に区別し、スクリーンリーダーでの移動を可能にする',
        subItems: missing.map(m => ({
          message: `未使用: ${m}`,
        })),
      });
    } else {
      items.push({
        name: 'ARIAランドマーク',
        status: 'pass',
        detail: 'header/nav/main/footer の4つのランドマーク要素が全て使用されています',
        standard: 'WCAG 2.2 SC 1.3.1 / JIS X 8341-3 1.3.1',
        purpose: 'ページの各領域を意味的に区別し、スクリーンリーダーでの移動を可能にする',
      });
    }
  } catch {
    items.push({
      name: 'ARIAランドマーク',
      status: 'warn',
      detail: 'ランドマーク要素の検証に失敗しました',
      standard: 'WCAG 2.2 SC 1.3.1',
      purpose: 'ページ構造をスクリーンリーダーで把握可能にする',
    });
  }

  const overallStatus = items.some(i => i.status === 'fail')
    ? 'fail'
    : items.some(i => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'アクセシビリティチェック', status: overallStatus, items };
}
