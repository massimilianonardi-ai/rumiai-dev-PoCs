import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const target = process.env.TARGET_URL || 'https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?';
const outDir = process.env.OUT_DIR || 'artifacts/amazon-wishlist-probe';

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'it-IT',
  viewport: { width: 1440, height: 1200 }
});
const page = await context.newPage();

let response = null;
let navigationError = null;

try {
  response = await page.goto(target, {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  await page.waitForTimeout(5000);
} catch (error) {
  navigationError = String(error?.stack || error);
}

let summary;

try {
  const html = await page.content();
  const title = await page.title();
  const finalUrl = page.url();
  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 20000);

  const itemCount = await page.locator(
    'li[id^="item_"], [data-itemid], .g-item-sortable, .a-fixed-left-grid'
  ).count().catch(() => 0);

  const dpLinks = await page.locator('a[href*="/dp/"]').evaluateAll((anchors) => {
    const seen = new Map();
    for (const a of anchors) {
      const href = a.href || '';
      const match = href.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i);
      if (!match) continue;
      const asin = match[1].toUpperCase();
      if (!seen.has(asin)) {
        seen.set(asin, {
          asin,
          href,
          text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300)
        });
      }
    }
    return [...seen.values()];
  }).catch(() => []);

  const lower = bodyText.toLowerCase();
  const blockSignals = {
    captcha:
      lower.includes('type the characters you see in this image') ||
      lower.includes('inserisci i caratteri che vedi') ||
      lower.includes('enter the characters you see below') ||
      finalUrl.toLowerCase().includes('validatecaptcha'),
    robotCheck:
      lower.includes('robot check') ||
      lower.includes('api-services-support@amazon.com'),
    serviceUnavailable:
      lower.includes('service unavailable') ||
      lower.includes('503 service unavailable'),
    genericAmazonError:
      lower.includes('sorry! something went wrong') ||
      lower.includes('ci dispiace') && lower.includes('qualcosa è andato storto')
  };

  summary = {
    target,
    httpStatus: response ? response.status() : null,
    httpStatusText: response ? response.statusText() : null,
    finalUrl,
    title,
    navigationError,
    bodyLength: bodyText.length,
    itemCount,
    asinCount: dpLinks.length,
    asins: dpLinks,
    blockSignals,
    bodyPreview: bodyText.slice(0, 3000)
  };

  await fs.writeFile(path.join(outDir, 'page.html'), html, 'utf8');
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await page.screenshot({
    path: path.join(outDir, 'screenshot.png'),
    fullPage: true
  });
} finally {
  await browser.close();
}

console.log(JSON.stringify(summary, null, 2));
