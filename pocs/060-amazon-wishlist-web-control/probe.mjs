import { parseWishlistHtml } from './wishlist-html.mjs';
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
const TEST_ORIGIN = process.env.AMAZON_TEST_ORIGIN || '';
if (TEST_ORIGIN && !/^http:\/\/127\.0\.0\.1:\d+$/.test(TEST_ORIGIN)) throw new Error('AMAZON_TEST_ORIGIN must be local loopback');

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
  try {
    const { stdout } = await execFileAsync(WEB_CONTROL, args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    });
    return JSON.parse(stdout);
  } catch (error) {
    error.operation = args.slice(0, 2).join(' ');
    throw error;
  }
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

function mergeItem(store, raw, round) {
  const price = selectPrice(raw.priceCandidates || []);
  const previous = store.get(raw.asin);
  const next = {
    asin: raw.asin,
    title: raw.title || previous?.title || '',
    url: raw.url || previous?.url || '',
    price,
    purchaseAction: raw.purchaseAction && raw.purchaseAction !== 'unknown'
      ? raw.purchaseAction : (previous?.purchaseAction || 'unknown'),
    firstSeenRound: previous?.firstSeenRound ?? round,
    lastSeenRound: round
  };
  store.set(raw.asin, next);
}

let page = null;
let navigation = null;
let finalSnapshot = null;
let complete = false;
let failure = null;
let stableRounds = 0;
let spinnerMarkersAtCompletion = [];
let previousCount = -1;
let previousHeight = -1;
const items = new Map();
const rounds = [];

try {
  page = await webControl('page', 'new');
  navigation = await webControl('page', 'navigate', page.id, WISHLIST_URL);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    await sleep(Math.max(50, WAIT_MS));
    // These two operations are in the portable web-control contract.
    const geometry = await webControl('page', 'scroll', page.id, '0');
    const metadata = await webControl('page', 'inspect', page.id, 'summary');
    const rendered = await webControl('page', 'inspect', page.id, 'html');
    const snapshot = parseWishlistHtml(rendered.html, metadata.url, {
      expectedOrigin: TEST_ORIGIN || 'https://www.amazon.it'
    });
    finalSnapshot = { ...snapshot, ...geometry };
    for (const item of snapshot.items) mergeItem(items, item, round);
    const blocked = Object.values(snapshot.blockSignals).some(Boolean) ||
      (typeof navigation?.status === 'number' && navigation.status >= 400);
    const count = items.size;
    const noNewItems = count === previousCount;
    const sameHeight = geometry.documentHeight === previousHeight;
    // Spinner markup is not proof of active loading. Amazon can retain a
    // hidden/inactive spinner in the DOM after all items are rendered.
    // Explicit load-more controls remain blocking. A spinner-only stable
    // bottom requires a longer quiet interval, never just a round-count timeout.
    const spinnerMarkers = snapshot.visibleLoading.filter(marker =>
      marker.selector.startsWith('.a-spinner-'));
    const actionableLoadMore = snapshot.visibleLoading.some(marker =>
      !marker.selector.startsWith('.a-spinner-'));
    const requiredStableRounds = spinnerMarkers.length > 0
      ? STABLE_ROUNDS * 3 : STABLE_ROUNDS;
    // Empty-list success needs a separate site-specific empty-state contract.
    if (!blocked && count > 0 && geometry.atBottom && noNewItems &&
        sameHeight && !actionableLoadMore) {
      stableRounds++;
    } else stableRounds = 0;
    rounds.push({
      round, observedInDom: snapshot.items.length, uniqueItems: count,
      documentHeight: geometry.documentHeight, scrollY: geometry.scrollY,
      viewportHeight: geometry.viewportHeight, atBottom: geometry.atBottom,
      loading: snapshot.visibleLoading, stableRounds,
      requiredStableRounds
    });
    if (blocked || stableRounds >= requiredStableRounds) {
      complete = !blocked;
      spinnerMarkersAtCompletion = complete ? spinnerMarkers : [];
      break;
    }
    previousCount = count;
    previousHeight = geometry.documentHeight;
    // Scroll a page-sized step; no CDP or provider-specific JavaScript.
    await webControl('page', 'scroll', page.id, String(Math.max(400, Math.floor(geometry.viewportHeight * 0.85))));
  }

  if (OUT_DIR && page?.id) {
    const target = path.resolve(OUT_DIR);
    await fs.mkdir(target, { recursive: true });
    await webControl('page', 'capture', page.id, target, 'html', 'text', 'screenshot');
  }
} catch (error) {
  complete = false;
  spinnerMarkersAtCompletion = [];
  const detail = String(error.stderr || '');
  const pageUnavailable = /unknown page:\s*page-/i.test(detail);
  failure = {
    reason: pageUnavailable ? 'page-unavailable' : 'web-control-failed',
    operation: error.operation || 'unknown',
    page: page?.id || null
  };
  if (pageUnavailable) {
    // Observation only: the controller may still be running after page closure/crash.
    try {
      const live = await webControl('page', 'list');
      if (Array.isArray(live)) failure.livePageIds = live.map(item => item.id);
    } catch { /* Preserve the original failure as the sole primary cause. */ }
  }
  console.error('Amazon wishlist extraction: ' + failure.reason +
    ' during ' + failure.operation + ' (page=' + (failure.page || 'none') + ')');
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
  completionReason: complete
    ? (spinnerMarkersAtCompletion.length ? 'stable-bottom-spinner-markers' : 'stable-bottom')
    : failure?.reason || (blocked ? 'blocked' :
      rounds.length >= MAX_ROUNDS ? 'max-rounds-reached' : 'not-confirmed'),
  failure,
  stableRounds,
  spinnerMarkersAtCompletion: complete ? spinnerMarkersAtCompletion : [],
  rounds,
  itemCount: items.size,
  items: [...items.values()],
  networkTrace: null // Not observable through portable web-control; never pretend otherwise.
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (failure) process.exitCode = 2;
else if (!complete || blocked) process.exitCode = 1;
