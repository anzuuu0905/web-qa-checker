// ===========================================
// link-checker.js - リンクチェッカー (V2)
// ===========================================

/**
 * Check all links on the page
 * @param {import('playwright').Page} page
 * @param {string} baseUrl - Site base URL
 * @param {object} options
 * @returns {Promise<import('../types').CheckResult>}
 */
export async function checkLinks(page, baseUrl, options = {}) {
  const { check_external = true, timeout_ms = 10000 } = options;
  const items = [];

  // Extract all links with text/label info
  const links = await page.evaluate(() => {
    const anchors = document.querySelectorAll('a[href]');
    return Array.from(anchors).map((a) => {
      // Get the most descriptive label
      const text = a.textContent.trim().slice(0, 80);
      const ariaLabel = a.getAttribute('aria-label') || '';
      const title = a.getAttribute('title') || '';
      const imgAlt = a.querySelector('img')?.getAttribute('alt') || '';
      // Closest parent with identifiable context
      const parentId = a.closest('[id]')?.id || '';
      const parentClass = a.closest('nav,header,footer,main,aside')?.tagName?.toLowerCase() || '';

      return {
        href: a.href,
        text: text || ariaLabel || imgAlt || title || '(テキストなし)',
        ariaLabel,
        location: parentClass || (parentId ? `#${parentId}` : ''),
        isExternal: false,
      };
    });
  });

  if (links.length === 0) {
    items.push({ name: 'リンク', status: 'pass', detail: 'ページにリンクがありません' });
    return { name: 'リンクチェック', status: 'pass', items };
  }

  // Categorize links
  const baseUrlObj = new URL(baseUrl);
  const internalLinks = [];
  const externalLinks = [];
  const invalidLinks = [];

  for (const link of links) {
    try {
      const url = new URL(link.href);
      if (url.protocol === 'javascript:' || url.protocol === 'mailto:' || url.protocol === 'tel:') {
        continue;
      }
      link.isExternal = url.hostname !== baseUrlObj.hostname;
      if (link.isExternal) {
        externalLinks.push(link);
      } else {
        internalLinks.push(link);
      }
    } catch {
      invalidLinks.push(link);
    }
  }

  // Check internal links - group by href to keep link text info
  const internalByHref = {};
  for (const link of internalLinks) {
    if (!internalByHref[link.href]) {
      internalByHref[link.href] = [];
    }
    internalByHref[link.href].push(link);
  }

  const brokenInternal = [];
  const noTrailingSlash = [];
  const uniqueInternalHrefs = Object.keys(internalByHref);

  for (const href of uniqueInternalHrefs) {
    const urlPath = new URL(href).pathname;
    if (!urlPath.endsWith('/') && !urlPath.match(/\.[a-z0-9]+$/i) && !href.includes('#')) {
      noTrailingSlash.push(href);
    }

    try {
      const response = await page.context().request.head(href, {
        timeout: timeout_ms,
        failOnStatusCode: false,
      });
      if (response.status() >= 400) {
        const linkInfo = internalByHref[href][0];
        brokenInternal.push({
          href,
          status: response.status(),
          text: linkInfo.text,
          location: linkInfo.location,
        });
      }
    } catch {
      const linkInfo = internalByHref[href][0];
      brokenInternal.push({
        href,
        status: 'timeout',
        text: linkInfo.text,
        location: linkInfo.location,
      });
    }
  }

  // Internal link results
  if (brokenInternal.length > 0) {
    items.push({
      name: '内部リンク切れ',
      status: 'fail',
      detail: `${brokenInternal.length}件のリンク切れ`,
      subItems: brokenInternal.slice(0, 10).map((l) => ({
        message: `[${l.status}] "${l.text}"${l.location ? ` (${l.location}内)` : ''} → ${l.href}`,
      })),
    });
  } else {
    items.push({
      name: '内部リンク切れ',
      status: 'pass',
      detail: `全${uniqueInternalHrefs.length}件の内部リンクが正常`,
    });
  }

  // Trailing slash
  if (noTrailingSlash.length > 0) {
    items.push({
      name: 'URL末尾スラッシュ',
      status: 'warn',
      detail: `${noTrailingSlash.length}件のURLが「/」で終わっていません`,
      subItems: noTrailingSlash.slice(0, 5).map((url) => ({
        message: url,
      })),
    });
  } else {
    items.push({
      name: 'URL末尾スラッシュ',
      status: 'pass',
      detail: `全${uniqueInternalHrefs.length}件が「/」で終了`,
    });
  }

  // Check external links
  if (check_external && externalLinks.length > 0) {
    const brokenExternal = [];
    const externalByHref = {};
    for (const link of externalLinks) {
      if (!externalByHref[link.href]) externalByHref[link.href] = [];
      externalByHref[link.href].push(link);
    }
    const uniqueExternalHrefs = Object.keys(externalByHref);
    const checkLimit = Math.min(uniqueExternalHrefs.length, 30);

    for (let i = 0; i < checkLimit; i++) {
      const href = uniqueExternalHrefs[i];
      try {
        const response = await page.context().request.head(href, {
          timeout: timeout_ms,
          failOnStatusCode: false,
        });
        if (response.status() >= 400) {
          const linkInfo = externalByHref[href][0];
          brokenExternal.push({
            href,
            status: response.status(),
            text: linkInfo.text,
            location: linkInfo.location,
          });
        }
      } catch {
        // External links may block HEAD requests
      }
    }

    if (brokenExternal.length > 0) {
      items.push({
        name: '外部リンク切れ',
        status: 'warn',
        detail: `${brokenExternal.length}件の外部リンクがエラー`,
        subItems: brokenExternal.slice(0, 5).map((l) => ({
          message: `[${l.status}] "${l.text}"${l.location ? ` (${l.location}内)` : ''} → ${l.href}`,
        })),
      });
    } else {
      items.push({
        name: '外部リンク切れ',
        status: 'pass',
        detail: `全${checkLimit}件の外部リンクが正常`,
      });
    }
  }

  // Invalid links
  if (invalidLinks.length > 0) {
    items.push({
      name: '不正なURL',
      status: 'fail',
      detail: `${invalidLinks.length}件の不正なURL`,
      subItems: invalidLinks.slice(0, 5).map((l) => ({
        message: `"${l.text}" → ${l.href}`,
      })),
    });
  }

  const overallStatus = items.some((i) => i.status === 'fail')
    ? 'fail'
    : items.some((i) => i.status === 'warn')
      ? 'warn'
      : 'pass';

  return { name: 'リンクチェック', status: overallStatus, items };
}
