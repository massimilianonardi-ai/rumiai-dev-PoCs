import * as cheerio from 'cheerio';

/** Interpret rendered HTML outside the browser; no browser-provider APIs. */
export function parseWishlistHtml(html, pageUrl, { expectedOrigin = 'https://www.amazon.it' } = {}) {
  if (typeof html !== 'string' || typeof pageUrl !== 'string') throw new TypeError('HTML and page URL required');
  const $ = cheerio.load(html);
  let expectedWishlist = false;
  try {
    const url = new URL(pageUrl), origin = new URL(expectedOrigin);
    expectedWishlist = url.origin === origin.origin && /^\/hz\/wishlist\/ls(?:\/|$)/i.test(url.pathname);
  } catch { /* Non-wishlist URL */ }
  const bodyText = $('body').text().toLowerCase();
  const compact = node => $(node).text().trim().replace(/\s+/g, ' ');
  const visibleByAttributes = element => {
    for (let node = $(element); node.length; node = node.parent()) {
      if (node.attr('hidden') !== undefined || node.attr('aria-hidden') === 'true') return false;
      // Amazon's reusable stylesheet hides template/spinner nodes by class,
      // which is not represented by an inline style in the serialized DOM.
      if (node.hasClass('a-hidden') || node.hasClass('aok-hidden')) return false;
      const style = (node.attr('style') || '').toLowerCase().replace(/\s+/g, '');
      if (/display:none(?:;|$)|visibility:hidden(?:;|$)|opacity:0(?:;|$)/.test(style)) return false;
    }
    return true;
  };
  const blockSignals = {
    unexpectedPage: !expectedWishlist,
    captcha: /type the characters you see in this image|inserisci i caratteri che vedi|enter the characters you see below/.test(bodyText) ||
      pageUrl.toLowerCase().includes('validatecaptcha') ||
      $('#captchacharacters, form[action*="validateCaptcha"]').length > 0,
    robotCheck: /robot check|api-services-support@amazon\.com/.test(bodyText),
    serviceUnavailable: /service unavailable|503 service unavailable/.test(bodyText),
    genericAmazonError: /sorry! something went wrong/.test(bodyText) ||
      (bodyText.includes('ci dispiace') && bodyText.includes('qualcosa è andato storto'))
  };
  const itemNodes = new Set();
  for (const selector of ['li[id^="item_"]','li[data-itemid]','.g-item-sortable','[data-itemid].a-spacing-none']) {
    $(selector).each((_, element) => itemNodes.add(element));
  }
  const items = [];
  for (const node of itemNodes) {
    const $node = $(node);
    let asin, productUrl, productLink;
    $node.find('a[href*="/dp/"], a[href*="/gp/product/"]').each((_, link) => {
      const href = $(link).attr('href') || '';
      const match = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
      if (!match) return;
      asin = match[1].toUpperCase();
      try { productUrl = new URL(href, pageUrl).href; } catch { productUrl = ''; }
      productLink = link;
      return false;
    });
    if (!asin || !productUrl) continue;
    let title = '';
    for (const selector of ['[id^="itemName_"]','.a-link-normal .a-size-base-plus',
      '.a-link-normal .a-size-medium','h2','h3']) {
      const candidate = $node.find(selector).first();
      if (candidate.length && compact(candidate)) { title = compact(candidate); break; }
    }
    if (!title) title = compact(productLink);
    const priceCandidates = [], seen = new Set();
    for (const [selector, priority] of [
      ['[id^="itemPrice_"].a-price > .a-offscreen',10],
      ['[id^="itemPrice_"].a-price .a-offscreen',20]
    ]) {
      $node.find(selector).each((_, el) => {
        const widget = $(el).closest('[id^="itemPrice_"].a-price');
        if (!widget.length || !visibleByAttributes(widget)) return;
        const text = compact(el);
        if (!/[€]|EUR/i.test(text) || seen.has(priority+'|'+text)) return;
        seen.add(priority+'|'+text);
        priceCandidates.push({priority,selector,text});
      });
    }
    const labels=[];
    $node.find('button, input[type="submit"], a[role="button"], span.a-button').each((_, el) => {
      if (!visibleByAttributes(el)) return;
      const label = (($(el).attr('aria-label') || $(el).attr('value') || compact(el))+'')
        .trim().replace(/\s+/g,' ').toLocaleLowerCase('it');
      if (label) labels.push(label);
    });
    const addToCart = labels.some(x=>/aggiungi al carrello|add to cart/.test(x));
    const viewOptions = labels.some(x=>/visualizza tutte le opzioni|see all buying options|see all options/.test(x));
    const purchaseAction = addToCart && viewOptions ? 'ambiguous' :
      addToCart ? 'add-to-cart' : viewOptions ? 'view-all-options' : 'unknown';
    items.push({ asin, title, url:productUrl, priceCandidates, purchaseAction });
  }
  const visibleLoading=[];
  for (const selector of ['.a-spinner-wrapper','.a-spinner-medium','#wl-load-more',
    '[data-action*="load-more"]','.load-more']) {
    const count=$(selector).filter((_,el)=>visibleByAttributes(el)).length;
    if (count) visibleLoading.push({selector,count});
  }
  return { finalUrl:pageUrl, documentTitle:$('title').first().text(),
    blockSignals,items,visibleLoading };
}
