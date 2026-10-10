import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WEB_CONTROL = process.env.WEB_CONTROL_CMD || 'web-control';
const DEFAULT_URL = 'https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?';
const WISHLIST_URL = process.argv[2] || DEFAULT_URL;
const WAIT_MS = positiveInt('AMAZON_SCROLL_WAIT_MS', 1500);
const STABLE_ROUNDS = positiveInt('AMAZON_STABLE_ROUNDS', 3);
const MAX_ROUNDS = positiveInt('AMAZON_MAX_ROUNDS', 80);
const OUT_DIR = process.env.OUT_DIR || '';

function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  return Number(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function webControl(...args) {
  const { stdout } = await execFileAsync(WEB_CONTROL, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function evaluate(page, expression) {
  const result = await webControl(
    'debug', 'cdp', page, 'Runtime.evaluate',
    JSON.stringify({ expression, returnByValue: true, awaitPromise: true })
  );
  return result?.result?.value;
}

function parseEuro(text) {
  if (typeof text !== 'string') return null;
  const original = text.replace(/\u00a0/g, ' ').trim();
  if (!/[€]|EUR/i.test(original)) return null;

  let value = original.replace(/[^0-9.,]/g, '');
  if (!value) return null;

  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');

  if (comma >= 0 && dot >= 0) {
    value = comma > dot
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '');
  } else if (comma >= 0) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (dot >= 0) {
    const decimals = value.length - dot - 1;
    value = decimals === 2 ? value.replace(/,/g, '') : value.replace(/\./g, '');
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function selectPrice(candidates) {
  const parsed = candidates
    .map((candidate) => ({ ...candidate, cents: parseEuro(candidate.text) }))
    .filter((candidate) => candidate.cents !== null);

  if (!parsed.length) return { verified: false, reason: 'price-unavailable', candidates };

  const bestPriority = Math.min(...parsed.map((candidate) => candidate.priority));
  const best = parsed.filter((candidate) => candidate.priority === bestPriority);
  const unique = [...new Set(best.map((candidate) => candidate.cents))];

  if (unique.length !== 1) {
    return {
      verified: false,
      reason: 'price-ambiguous',
      bestPriority,
      valuesCents: unique,
      candidates: parsed
    };
  }

  return {
    verified: true,
    currency: 'EUR',
    cents: unique[0],
    value: unique[0] / 100,
    evidence: best,
    candidates: parsed
  };
}

const installRecorderExpression = String.raw`(() => {
  if (window.__rumiaiWishlistTraceInstalled) return { installed: true, reused: true };
  window.__rumiaiWishlistTraceInstalled = true;
  window.__rumiaiWishlistTrace = [];

  const simplifyBody = (body) => {
    if (body == null) return null;
    try {
      if (typeof body === 'string') return body.slice(0, 3000);
      if (body instanceof URLSearchParams) return body.toString().slice(0, 3000);
      if (body instanceof FormData) {
        return [...body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '[binary]']);
      }
      return String(body).slice(0, 3000);
    } catch {
      return '[unavailable]';
    }
  };

  const record = (entry) => {
    const item = {
      at: new Date().toISOString(),
      kind: entry.kind,
      method: String(entry.method || 'GET').toUpperCase(),
      url: String(entry.url || ''),
      body: simplifyBody(entry.body),
      status: null
    };
    window.__rumiaiWishlistTrace.push(item);
    return item;
  };

  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const entry = record({
      kind: 'fetch',
      method: init.method || request?.method || 'GET',
      url: request?.url || input,
      body: init.body
    });
    const promise = originalFetch.apply(this, arguments);
    Promise.resolve(promise).then(
      (response) => { entry.status = response.status; },
      () => { entry.status = -1; }
    );
    return promise;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__rumiaiTraceMeta = { method, url };
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const meta = this.__rumiaiTraceMeta || { method: 'GET', url: '' };
    const entry = record({ kind: 'xhr', method: meta.method, url: meta.url, body });
    this.addEventListener('loadend', () => { entry.status = this.status; }, { once: true });
    return originalSend.apply(this, arguments);
  };

  return { installed: true, reused: false };
})()`;

const snapshotExpression = String.raw`(() => {
  const bodyText = document.body?.innerText || '';
  const lower = bodyText.toLowerCase();
  const finalUrl = location.href;
  let expectedWishlist = false;
  try {
    const observed = new URL(finalUrl);
    expectedWishlist = /(^|\.)amazon\.it$/i.test(observed.hostname) &&
      /^\/hz\/wishlist\/ls(?:\/|$)/i.test(observed.pathname);
  } catch {
    expectedWishlist = false;
  }

  const visible = (node) => {
    if (!node) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || '1') !== 0 &&
      rect.width > 0 &&
      rect.height > 0;
  };

  const blockSignals = {
    unexpectedPage: !expectedWishlist,
    captcha:
      lower.includes('type the characters you see in this image') ||
      lower.includes('inserisci i caratteri che vedi') ||
      lower.includes('enter the characters you see below') ||
      finalUrl.toLowerCase().includes('validatecaptcha') ||
      Boolean(document.querySelector('#captchacharacters, form[action*="validateCaptcha"]')),
    robotCheck:
      lower.includes('robot check') ||
      lower.includes('api-services-support@amazon.com'),
    serviceUnavailable:
      lower.includes('service unavailable') ||
      lower.includes('503 service unavailable'),
    genericAmazonError:
      lower.includes('sorry! something went wrong') ||
      (lower.includes('ci dispiace') && lower.includes('qualcosa è andato storto'))
  };

  const itemNodes = new Set();
  for (const selector of [
    'li[id^="item_"]',
    'li[data-itemid]',
    '.g-item-sortable',
    '[data-itemid].a-spacing-none'
  ]) {
    for (const node of document.querySelectorAll(selector)) itemNodes.add(node);
  }

  const items = [];
  for (const node of itemNodes) {
    let productLink = null;
    let asin = null;

    for (const link of node.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]')) {
      const href = link.href || '';
      const match = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      if (!match) continue;
      productLink = link;
      asin = match[1].toUpperCase();
      break;
    }

    if (!asin || !productLink) continue;

    let title = '';
    for (const selector of [
      '[id^="itemName_"]',
      '.a-link-normal .a-size-base-plus',
      '.a-link-normal .a-size-medium',
      'h2',
      'h3'
    ]) {
      const candidate = node.querySelector(selector);
      const text = (candidate?.textContent || '').trim().replace(/\s+/g, ' ');
      if (text) {
        title = text;
        break;
      }
    }
    if (!title) title = (productLink.textContent || '').trim().replace(/\s+/g, ' ');

    const priceSelectors = [
      ['.a-price:not(.a-text-price) .a-offscreen', 10],
      ['[id^="itemPrice_"] .a-offscreen', 20],
      ['[id^="itemPrice_"]', 30],
      ['.a-price .a-offscreen', 40],
      ['.price', 50]
    ];
    const priceCandidates = [];
    const seenPrices = new Set();

    for (const [selector, priority] of priceSelectors) {
      for (const priceNode of node.querySelectorAll(selector)) {
        if (!visible(priceNode)) continue;
        const text = (priceNode.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text || !(/[€]|EUR/i.test(text))) continue;
        const key = priority + '|' + text;
        if (seenPrices.has(key)) continue;
        seenPrices.add(key);
        priceCandidates.push({ priority, selector, text });
      }
    }

    items.push({
      asin,
      title,
      url: productLink.href,
      priceCandidates
    });
  }

  const loadingSelectors = [
    '.a-spinner-wrapper',
    '.a-spinner-medium',
    '#wl-load-more',
    '[data-action*="load-more"]',
    '.load-more'
  ];
  const visibleLoading = [];
  for (const selector of loadingSelectors) {
    const count = [...document.querySelectorAll(selector)].filter(visible).length;
    if (count) visibleLoading.push({ selector, count });
  }

  const root = document.documentElement;
  const body = document.body;
  const documentHeight = Math.max(
    root?.scrollHeight || 0,
    root?.offsetHeight || 0,
    body?.scrollHeight || 0,
    body?.offsetHeight || 0
  );

  const scrollY = window.scrollY;
  const viewportHeight = window.innerHeight;
  const atBottom = scrollY + viewportHeight >= documentHeight - 20;

  return {
    finalUrl,
    documentTitle: document.title,
    blockSignals,
    items,
    documentHeight,
    scrollY,
    viewportHeight,
    atBottom,
    visibleLoading,
    trace: Array.isArray(window.__rumiaiWishlistTrace)
      ? window.__rumiaiWishlistTrace.slice()
      : []
  };
})()`;

const scrollExpression = String.raw`(() => {
  const root = document.documentElement;
  const body = document.body;
  const height = Math.max(
    root?.scrollHeight || 0,
    root?.offsetHeight || 0,
    body?.scrollHeight || 0,
    body?.offsetHeight || 0
  );
  const step = Math.max(Math.floor(window.innerHeight * 0.85), 600);
  const target = Math.min(window.scrollY + step, height);
  window.scrollTo(0, target);
  return { target, height };
})()`;

function mergeItem(store, raw, round) {
  const price = selectPrice(raw.priceCandidates || []);
  const previous = store.get(raw.asin);
  const next = {
    asin: raw.asin,
    title: raw.title || previous?.title || '',
    url: raw.url || previous?.url || '',
    price,
    firstSeenRound: previous?.firstSeenRound ?? round,
    lastSeenRound: round
  };
  store.set(raw.asin, next);
}

let page = null;
let navigation = null;
let finalSnapshot = null;
let complete = false;
let stableRounds = 0;
let previousCount = -1;
let previousHeight = -1;
const items = new Map();
const rounds = [];

try {
  page = await webControl('page', 'new');
  navigation = await webControl('page', 'navigate', page.id, WISHLIST_URL);
  await evaluate(page.id, installRecorderExpression);

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    await sleep(round === 0 ? WAIT_MS : Math.max(250, WAIT_MS));
    const snapshot = await evaluate(page.id, snapshotExpression);
    if (!snapshot) throw new Error('wishlist snapshot returned no value');

    finalSnapshot = snapshot;
    for (const item of snapshot.items || []) mergeItem(items, item, round);

    const blocked = Object.values(snapshot.blockSignals || {}).some(Boolean) ||
      (typeof navigation?.status === 'number' && navigation.status >= 400);
    const count = items.size;
    const noNewItems = count === previousCount;
    const sameHeight = snapshot.documentHeight === previousHeight;
    const loading = (snapshot.visibleLoading || []).length > 0;

    if (!blocked && snapshot.atBottom && noNewItems && sameHeight && !loading) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    rounds.push({
      round,
      observedInDom: snapshot.items?.length || 0,
      uniqueItems: count,
      documentHeight: snapshot.documentHeight,
      scrollY: snapshot.scrollY,
      viewportHeight: snapshot.viewportHeight,
      atBottom: snapshot.atBottom,
      loading: snapshot.visibleLoading,
      stableRounds
    });

    if (blocked) break;
    if (stableRounds >= STABLE_ROUNDS) {
      complete = true;
      break;
    }

    previousCount = count;
    previousHeight = snapshot.documentHeight;
    await evaluate(page.id, scrollExpression);
  }

  if (OUT_DIR && page?.id) {
    const target = path.resolve(OUT_DIR);
    await fs.mkdir(target, { recursive: true });
    await webControl('page', 'capture', page.id, target, 'html', 'text', 'screenshot');
  }
} finally {
  if (page?.id) await webControl('page', 'close', page.id).catch(() => {});
}

const blockSignals = {
  ...(finalSnapshot?.blockSignals || {}),
  httpError: typeof navigation?.status === 'number' && navigation.status >= 400
};
const blocked = Object.values(blockSignals).some(Boolean);

const result = {
  checkedAt: new Date().toISOString(),
  wishlistUrl: WISHLIST_URL,
  navigation: navigation ? {
    status: navigation.status,
    statusText: navigation.statusText,
    finalUrl: navigation.url,
    title: navigation.title
  } : null,
  complete,
  blocked,
  blockSignals,
  stableRounds,
  rounds,
  itemCount: items.size,
  items: [...items.values()],
  networkTrace: finalSnapshot?.trace || []
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (!complete || blocked) process.exitCode = 1;
