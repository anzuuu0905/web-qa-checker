// ===========================================
// form-checker.js - フォームチェッカー
// ===========================================

/**
 * Check form elements and basic validation
 * @param {import('playwright').Page} page
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkForm(page) {
  const items = [];

  // Detect forms on the page
  const formInfo = await page.evaluate(() => {
    const forms = document.querySelectorAll('form');
    return Array.from(forms).map((form, index) => {
      const inputs = form.querySelectorAll('input, textarea, select');
      const submitBtn =
        form.querySelector('[type="submit"]') ||
        form.querySelector('button:not([type="button"])');

      return {
        index,
        action: form.action,
        method: form.method,
        inputCount: inputs.length,
        hasSubmitButton: !!submitBtn,
        submitText: submitBtn?.textContent?.trim() || '',
        fields: Array.from(inputs).map((input) => ({
          type: input.type || input.tagName.toLowerCase(),
          name: input.name,
          required: input.required || input.hasAttribute('required'),
          hasLabel:
            !!input.labels?.length ||
            !!input.getAttribute('aria-label') ||
            !!input.getAttribute('placeholder'),
          placeholder: input.getAttribute('placeholder'),
        })),
      };
    });
  });

  if (formInfo.length === 0) {
    items.push({
      name: 'フォーム検出',
      status: 'pass',
      detail: 'フォームが見つかりませんでした',
    });
    return { name: 'フォームチェック', status: 'pass', items };
  }

  for (const form of formInfo) {
    // 1. Submit button
    if (!form.hasSubmitButton) {
      items.push({
        name: `フォーム#${form.index + 1} 送信ボタン`,
        status: 'fail',
        detail: '送信ボタンが見つかりません',
      });
    } else {
      items.push({
        name: `フォーム#${form.index + 1} 送信ボタン`,
        status: 'pass',
        detail: `"${form.submitText}"`,
      });
    }

    // 2. Labels for fields
    const fieldsWithoutLabel = form.fields.filter(
      (f) => !f.hasLabel && f.type !== 'hidden' && f.type !== 'submit'
    );
    if (fieldsWithoutLabel.length > 0) {
      items.push({
        name: `フォーム#${form.index + 1} ラベル`,
        status: 'warn',
        detail: `${fieldsWithoutLabel.length}個のフィールドにラベル/placeholder/aria-labelがありません`,
        subItems: fieldsWithoutLabel.map((f) => ({
          message: `<input name="${f.name}" type="${f.type}">`,
        })),
      });
    } else {
      items.push({
        name: `フォーム#${form.index + 1} ラベル`,
        status: 'pass',
        detail: '全フィールドにラベル設定済み',
      });
    }

    // 3. Required fields
    const requiredFields = form.fields.filter((f) => f.required);
    if (requiredFields.length > 0) {
      items.push({
        name: `フォーム#${form.index + 1} バリデーション`,
        status: 'pass',
        detail: `${requiredFields.length}個の必須フィールドが設定されています`,
      });
    } else {
      items.push({
        name: `フォーム#${form.index + 1} バリデーション`,
        status: 'warn',
        detail: '必須フィールド（required属性）が設定されていません',
      });
    }

    // 4. Action URL
    if (form.action && !form.action.includes('javascript:')) {
      items.push({
        name: `フォーム#${form.index + 1} action`,
        status: 'pass',
        detail: `action="${form.action}" method="${form.method}"`,
      });
    }
  }

  // 5. Manual check reminders
  items.push({
    name: 'フォーム送信テスト',
    status: 'manual',
    detail: 'フォームの送信→確認→完了の遷移を手動で確認してください',
  });

  items.push({
    name: '自動返信メール',
    status: 'manual',
    detail: '自動返信メールが届くか、文字化けがないか確認してください',
  });

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'フォームチェック', status: overallStatus, items };
}
