import { execFile } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WEB_CONTROL = process.env.WEB_CONTROL_CMD || 'web-control';
const AMAZON_ORIGIN = process.env.AMAZON_ORIGIN || 'https://www.amazon.it';
const POLL_INTERVAL_MS = Number(process.env.AMAZON_POLL_INTERVAL_MS || 500);
const POLL_TIMEOUT_MS = Number(process.env.AMAZON_POLL_TIMEOUT_MS || 15000);
const OUT_DIR = process.env.OUT_DIR || '';

function usage() {
  return 'usage: node probe.mjs <ASIN> [ASIN ...]';
}

function validAsin(value) {
  return /^[A-Z0-9]{10}$/.test(value);
}

async function webControl(...args) {
  const { stdout } = await execFileAsync(WEB_CONTROL, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

function parseEuro(text) {
  if (typeof text !== 'string') return null;
  let value = text.replace(/\u00a0/g, ' ').trim();
  if (!/[€]|EUR/i.test(value)) return null;
  value = value.replace(/[^0-9.,]/g, '');
  if (!value) return null;

  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  let normalized;

  if (comma >= 0 && dot >= 0) {
    if (comma > dot) normalized = value.replace(/\./g, '').replace(',', '.');
    else normalized = value.replace(/,/g, '');
  } else if (comma >= 0) {
    normalized = value.replace(/\./g, '').replace(',', '.');
  } else if (dot >= 0) {
    const decimals = value.length - dot - 1;
    normalized = decimals === 2 ? value.replace(/,/g, '') : value.replace(/\./g, '');
  } else {
    normalized = value;
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function selectPrice(candidates) {
  const parsed = candidates
    .map((candidate) => ({ ...candidate, cents: parseEuro(candidate.text) }))
    .filter((candidate) => candidate.cents !== null);

  if (!parsed.length) return { ok: false, reason: 'price-not-found', candidates };

  const bestPriority = Math.min(...parsed.map((candidate) => candidate.priority));
  const best = parsed.filter((candidate) => candidate.priority === bestPriority);
  const unique = [...new Set(best.map((candidate) => candidate.cents))];

  if (unique.length !== 1) {
    return { ok: false, reason: 'price-ambiguous', candidates: parsed, bestPriority, valuesCents: unique };
  }

  return {
    ok: true,
    cents: unique[0],
    euro: unique[0] / 100,
    evidence: best,
    candidates: parsed
  };
}

function evaluationExpression(requestedAsin) {
  const requested = JSON.stringify(requestedAsin);
  return `(() => {
    const requested = ${requested};
    const bodyText = document.body?.innerText || '';
    const lower = bodyText.toLowerCase();
    const finalUrl = location.href;
    const titleText = (document.querySelector('#productTitle')?.textContent || '').trim().replace(/\\s+/g, ' ');
    const availabilityText = (document.querySelector('#availability')?.textContent || '').trim().replace(/\\s+/g, ' ');

    const blockSignals = {
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

    const asins = new Set();
    const urlMatch = finalUrl.match(/\\/(?:dp|gp\\/product)\\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (urlMatch) asins.add(urlMatch[1].toUpperCase());
    for (const selector of ['#ASIN', 'input[name="ASIN"]', 'input[name="asin"]']) {
      for (const node of document.querySelectorAll(selector)) {
        const value = (node.value || node.getAttribute('value') || '').trim().toUpperCase();
        if (/^[A-Z0-9]{10}$/.test(value)) asins.add(value);
      }
    }

    const selectorGroups = [
      ['#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen', 10],
      ['#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen', 20],
      ['#corePrice_feature_div .priceToPay .a-offscreen', 30],
      ['#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen', 40],
      ['#apex_desktop .priceToPay .a-offscreen', 50],
      ['#apex_desktop .a-price:not(.a-text-price) .a-offscreen', 60],
      ['#price_inside_buybox', 70],
      ['#newBuyBoxPrice', 80],
      ['.priceToPay .a-offscreen', 90]
    ];

    const seen = new Set();
    const priceCandidates = [];
    for (const [selector, priority] of selectorGroups) {
      for (const node of document.querySelectorAll(selector)) {
        const text = (node.textContent || '').trim().replace(/\\s+/g, ' ');
        if (!text) continue;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        if (!visible) continue;
        const key = priority + '|' + text;
        if (seen.has(key)) continue;
        seen.add(key);
        priceCandidates.push({ selector, priority, text });
      }
    }

    return {
      requestedAsin: requested,
      finalUrl,
      documentTitle: document.title,
      productTitle: titleText,
      availabilityText,
      asins: [...asins],
      asinMatches: asins.has(requested),
      blockSignals,
      priceCandidates,
      bodyPreview: bodyText.slice(0, 3000)
    };
  })()`;
}

async function inspectProduct(page, asin) {
  const expression = evaluationExpression(asin);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let snapshot = null;

  while (true) {
    const result = await webControl('debug', 'cdp', page, 'Runtime.evaluate', JSON.stringify({
      expression,
      returnByValue: true
    }));
    snapshot = result?.result?.value ?? null;
    if (!snapshot) throw new Error('CDP evaluation did not return a value');

    const blocked = Object.values(snapshot.blockSignals || {}).some(Boolean);
    if (blocked || snapshot.productTitle || snapshot.priceCandidates?.length) break;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return snapshot;
}

function observationFrom(asin, navigation, snapshot) {
  const reasons = [];
  if (navigation.status !== null && navigation.status >= 400) reasons.push(`http-${navigation.status}`);

  const blocks = Object.entries(snapshot.blockSignals || {}).filter(([, active]) => active).map(([name]) => name);
  if (blocks.length) reasons.push(...blocks.map((name) => `blocked-${name}`));
  if (!snapshot.asinMatches) reasons.push('asin-mismatch');
  if (!snapshot.productTitle) reasons.push('product-title-missing');

  const price = selectPrice(snapshot.priceCandidates || []);
  if (!price.ok) reasons.push(price.reason);

  return {
    asin,
    url: navigation.url,
    httpStatus: navigation.status,
    title: snapshot.productTitle || snapshot.documentTitle || navigation.title || '',
    availability: snapshot.availabilityText || '',
    verified: reasons.length === 0,
    price: price.ok ? { currency: 'EUR', cents: price.cents, value: price.euro } : null,
    reasons,
    evidence: {
      finalUrl: snapshot.finalUrl,
      asins: snapshot.asins,
      blockSignals: snapshot.blockSignals,
      selectedPriceEvidence: price.ok ? price.evidence : [],
      priceCandidates: price.candidates || snapshot.priceCandidates || [],
      bodyPreview: snapshot.bodyPreview
    }
  };
}

async function maybeCapture(page, asin) {
  if (!OUT_DIR) return null;
  const target = path.resolve(OUT_DIR, asin);
  await fs.mkdir(target, { recursive: true });
  return webControl('page', 'capture', page, target, 'html', 'text', 'screenshot');
}

const asins = process.argv.slice(2).map((value) => value.toUpperCase());
if (!asins.length || asins.some((asin) => !validAsin(asin))) {
  process.stderr.write(`${usage()}\n`);
  process.exit(2);
}

let page;
const observations = [];

try {
  page = await webControl('page', 'new');

  for (const asin of asins) {
    try {
      const navigation = await webControl('page', 'navigate', page.id, `${AMAZON_ORIGIN}/dp/${asin}`);
      const snapshot = await inspectProduct(page.id, asin);
      const observation = observationFrom(asin, navigation, snapshot);
      const capture = await maybeCapture(page.id, asin).catch((error) => ({ error: String(error?.message || error) }));
      if (capture) observation.capture = capture;
      observations.push(observation);
    } catch (error) {
      observations.push({
        asin,
        verified: false,
        price: null,
        reasons: ['web-control-error'],
        error: String(error?.message || error)
      });
    }
  }
} finally {
  if (page?.id) await webControl('page', 'close', page.id).catch(() => {});
}

const result = {
  checkedAt: new Date().toISOString(),
  amazonOrigin: AMAZON_ORIGIN,
  count: observations.length,
  verifiedCount: observations.filter((item) => item.verified).length,
  observations
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.verifiedCount !== result.count) process.exitCode = 1;
