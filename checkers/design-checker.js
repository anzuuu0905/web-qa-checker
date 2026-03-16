// ===========================================
// design-checker.js - デザイン比較チェッカー
// フォント・カラー・スタイルをデザイン仕様と比較
// ===========================================

/**
 * Normalize a color value to lowercase hex (#rrggbb) for comparison.
 * Handles: rgb(), rgba(), #hex (3/6/8 digit)
 */
function normalizeColor(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return '#' + [r, g, b].map(n => Number(n).toString(16).padStart(2, '0')).join('');
  }

  // #rgb → #rrggbb
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }

  // #rrggbb or #rrggbbaa
  if (/^#[0-9a-f]{6,8}$/.test(s)) {
    return s.slice(0, 7); // ignore alpha
  }

  return s;
}

/**
 * Normalize font-family for comparison.
 * Removes quotes and extra whitespace, lowercases.
 */
function normalizeFontFamily(raw) {
  if (!raw) return '';
  return raw
    .split(',')
    .map(f => f.trim().replace(/['"]/g, '').toLowerCase())
    .filter(Boolean);
}

/**
 * Check if actual font-family list contains the expected font
 */
function fontFamilyMatch(expected, actual) {
  const expectedFonts = normalizeFontFamily(expected);
  const actualFonts = normalizeFontFamily(actual);

  // Check if the first (primary) expected font is in the actual list
  if (expectedFonts.length === 0) return true;
  return actualFonts.some(f => f.includes(expectedFonts[0]));
}

/**
 * Run design comparison checks on a page
 * @param {import('playwright').Page} page
 * @param {object} designSpec - design_spec from config
 * @param {string} pageName - for reporting
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkDesign(page, designSpec, pageName) {
  const items = [];

  if (!designSpec) {
    return { name: 'デザイン比較チェック', status: 'pass', items: [] };
  }

  // ── 1. Selector-based style checks ──
  if (designSpec.selectors && designSpec.selectors.length > 0) {
    for (const spec of designSpec.selectors) {
      const { selector, expected, label } = spec;
      const displayName = label || selector;

      try {
        // Get computed styles from the page
        const computed = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;

          const cs = window.getComputedStyle(el);
          return {
            'font-family': cs.fontFamily,
            'font-size': cs.fontSize,
            'font-weight': cs.fontWeight,
            'line-height': cs.lineHeight,
            'letter-spacing': cs.letterSpacing,
            'color': cs.color,
            'background-color': cs.backgroundColor,
            'border-radius': cs.borderRadius,
            'padding': cs.padding,
            'margin': cs.margin,
          };
        }, selector);

        if (!computed) {
          items.push({
            name: `${displayName}`,
            status: 'warn',
            detail: `セレクタ "${selector}" に一致する要素が見つかりません`,
          });
          continue;
        }

        // Compare each expected property
        for (const [prop, expectedVal] of Object.entries(expected)) {
          const actualVal = computed[prop];

          if (!actualVal) {
            items.push({
              name: `${displayName} / ${prop}`,
              status: 'warn',
              detail: `プロパティ ${prop} を取得できません`,
            });
            continue;
          }

          // Color comparison
          if (prop === 'color' || prop === 'background-color') {
            const expNorm = normalizeColor(expectedVal);
            const actNorm = normalizeColor(actualVal);
            if (expNorm === actNorm) {
              items.push({
                name: `${displayName} / ${prop}`,
                status: 'pass',
                detail: `${actNorm} ✓ 一致`,
              });
            } else {
              items.push({
                name: `${displayName} / ${prop}`,
                status: 'fail',
                detail: `期待値: ${expectedVal} → 実測値: ${actualVal}`,
              });
            }
            continue;
          }

          // Font-family comparison
          if (prop === 'font-family') {
            if (fontFamilyMatch(expectedVal, actualVal)) {
              items.push({
                name: `${displayName} / ${prop}`,
                status: 'pass',
                detail: `${expectedVal} ✓ 一致`,
              });
            } else {
              items.push({
                name: `${displayName} / ${prop}`,
                status: 'fail',
                detail: `期待値: ${expectedVal} → 実測値: ${actualVal}`,
              });
            }
            continue;
          }

          // Generic comparison (font-size, font-weight, etc.)
          const expStr = String(expectedVal).trim().toLowerCase();
          const actStr = String(actualVal).trim().toLowerCase();
          if (expStr === actStr) {
            items.push({
              name: `${displayName} / ${prop}`,
              status: 'pass',
              detail: `${actualVal} ✓ 一致`,
            });
          } else {
            items.push({
              name: `${displayName} / ${prop}`,
              status: 'fail',
              detail: `期待値: ${expectedVal} → 実測値: ${actualVal}`,
            });
          }
        }
      } catch (err) {
        items.push({
          name: `${displayName}`,
          status: 'warn',
          detail: `チェック中にエラー: ${err.message}`,
        });
      }
    }
  }

  // ── 2. Global font check ──
  if (designSpec.fonts) {
    try {
      const loadedFonts = await page.evaluate(() => {
        const fonts = [];
        if (document.fonts) {
          for (const f of document.fonts) {
            if (f.status === 'loaded') {
              fonts.push({ family: f.family.replace(/['"]/g, ''), weight: f.weight, style: f.style });
            }
          }
        }
        return fonts;
      });

      for (const [role, spec] of Object.entries(designSpec.fonts)) {
        const expectedFamily = spec.family;
        const found = loadedFonts.some(f =>
          f.family.toLowerCase().includes(expectedFamily.toLowerCase())
        );

        if (found) {
          items.push({
            name: `フォント読込 (${role})`,
            status: 'pass',
            detail: `${expectedFamily} がページに正常にロードされています`,
          });
        } else {
          items.push({
            name: `フォント読込 (${role})`,
            status: 'fail',
            detail: `${expectedFamily} がページでロードされていません — フォールバックフォントが使用されている可能性があります`,
          });
        }
      }
    } catch (err) {
      items.push({
        name: 'フォント読込',
        status: 'warn',
        detail: `フォント検証中にエラー: ${err.message}`,
      });
    }
  }

  // ── 3. Color palette check ──
  if (designSpec.colors) {
    // Check that the page's CSS uses the defined color palette
    try {
      const pageColors = await page.evaluate(() => {
        const colors = new Set();
        const elements = document.querySelectorAll('*');
        for (let i = 0; i < Math.min(elements.length, 500); i++) {
          const cs = window.getComputedStyle(elements[i]);
          if (cs.color) colors.add(cs.color);
          if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            colors.add(cs.backgroundColor);
          }
        }
        return [...colors];
      });

      const normalizedPageColors = pageColors.map(normalizeColor).filter(Boolean);

      for (const [name, value] of Object.entries(designSpec.colors)) {
        const normalizedExpected = normalizeColor(value);
        const found = normalizedPageColors.includes(normalizedExpected);

        items.push({
          name: `カラーパレット / ${name}`,
          status: found ? 'pass' : 'warn',
          detail: found
            ? `${value} はページ内で使用されています`
            : `${value} はページ内で使用されていません — デザイン仕様のカラーが適用されているか確認してください`,
        });
      }
    } catch (err) {
      items.push({
        name: 'カラーパレット',
        status: 'warn',
        detail: `カラー検証中にエラー: ${err.message}`,
      });
    }
  }

  // Calculate overall status
  const overallStatus = items.some(i => i.status === 'fail')
    ? 'fail'
    : items.some(i => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'デザイン比較チェック', status: overallStatus, items };
}
