// ===========================================
// console-checker.js - コンソールエラーチェッカー
// ===========================================

/**
 * Analyze captured console messages and request failures
 * @param {object} captured - Captured console data from runner
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkConsole(captured) {
  const items = [];
  const { errors = [], warnings = [], failedRequests = [] } = captured;

  // 1. JS Errors
  // Filter out noise (common browser extensions, analytics, etc.)
  const significantErrors = errors.filter(
    (e) =>
      !e.includes('favicon.ico') &&
      !e.includes('chrome-extension') &&
      !e.includes('moz-extension') &&
      !e.includes('ResizeObserver')
  );

  if (significantErrors.length > 0) {
    items.push({
      name: 'JavaScriptエラー',
      status: 'fail',
      detail: `${significantErrors.length}件のJSエラー`,
      subItems: significantErrors.slice(0, 10).map((e) => ({
        message: e.slice(0, 120),
      })),
    });
  } else {
    items.push({
      name: 'JavaScriptエラー',
      status: 'pass',
      detail: 'JSエラーなし',
    });
  }

  // 2. JS Warnings
  if (warnings.length > 5) {
    items.push({
      name: 'JavaScript警告',
      status: 'warn',
      detail: `${warnings.length}件の警告`,
    });
  } else {
    items.push({
      name: 'JavaScript警告',
      status: 'pass',
      detail: warnings.length > 0 ? `${warnings.length}件（許容範囲）` : '警告なし',
    });
  }

  // 3. Failed requests (404 resources, etc.)
  if (failedRequests.length > 0) {
    items.push({
      name: 'リソース読み込みエラー',
      status: 'fail',
      detail: `${failedRequests.length}件のリソース読み込みに失敗`,
      subItems: failedRequests.slice(0, 10).map((r) => ({
        message: `${r.failure}: ${r.url.slice(0, 80)}`,
      })),
    });
  } else {
    items.push({
      name: 'リソース読み込みエラー',
      status: 'pass',
      detail: '読み込みエラーなし',
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'コンソールチェック', status: overallStatus, items };
}
