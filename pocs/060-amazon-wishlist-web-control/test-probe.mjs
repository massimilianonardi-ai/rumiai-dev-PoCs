import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'rumiai-amazon-060-'));
const mockPath = path.join(dir, 'mock-web-control');
const probePath = fileURLToPath(new URL('probe.mjs', import.meta.url));

const mock = String.raw`#!/usr/bin/env node
const args = process.argv.slice(2);
const url = process.env.MOCK_URL || 'https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO';
const status = Number(process.env.MOCK_STATUS || '200');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (args[0] === 'page' && args[1] === 'new') {
  emit({ id: 'page-1', url: 'about:blank', title: '' });
} else if (args[0] === 'page' && args[1] === 'navigate') {
  emit({ page: 'page-1', url, status, statusText: status >= 400 ? 'Error' : 'OK', title: 'Wishlist' });
} else if (args[0] === 'page' && args[1] === 'close') {
  emit({ page: 'page-1', closed: true });
} else if (args[0] === 'debug' && args[1] === 'cdp' && args[3] === 'Runtime.evaluate') {
  const expression = JSON.parse(args[4]).expression;
  if (expression.includes('window.__rumiaiWishlistTraceInstalled')) {
    emit({ result: { value: { installed: true, reused: false } } });
  } else if (expression.includes('const bodyText =')) {
    const isWishlist = url.includes('/hz/wishlist/ls/');
    emit({ result: { value: {
      finalUrl: url, documentTitle: 'Wishlist',
      blockSignals: { unexpectedPage: !isWishlist },
      items: isWishlist ? [{
        asin: 'B012345678',
        title: 'Synthetic product',
        url: 'https://www.amazon.it/dp/B012345678',
        priceCandidates: [{ text: '10,99 €', priority: 10, selector: '[id^="itemPrice_"].a-price > .a-offscreen' }]
      }] : [],
      documentHeight: 100, scrollY: 100, viewportHeight: 100,
      atBottom: true, visibleLoading: [], trace: []
    } } });
  } else if (expression.includes('window.scrollTo')) {
    emit({ result: { value: { target: 100, height: 100 } } });
  } else {
    process.stderr.write('unexpected CDP expression\n');
    process.exitCode = 9;
  }
} else {
  process.stderr.write('unexpected web-control command\n');
  process.exitCode = 8;
}
`;

try {
  await writeFile(mockPath, mock, 'utf8');
  await chmod(mockPath, 0o700);

  function run(overrides, expectedStatus) {
    const result = spawnSync(process.execPath, [probePath], {
      encoding: 'utf8', timeout: 15000,
      env: {
        ...process.env,
        WEB_CONTROL_CMD: mockPath,
        AMAZON_SCROLL_WAIT_MS: '1',
        AMAZON_STABLE_ROUNDS: '2',
        AMAZON_MAX_ROUNDS: '5',
        ...overrides
      }
    });
    assert.equal(result.status, expectedStatus, result.stderr || String(result.error));
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.blocked, expectedStatus !== 0);
    assert.equal(payload.complete, expectedStatus === 0);
    return payload;
  }

  const valid = run({}, 0);
  assert.equal(valid.itemCount, 1);
  assert.equal(valid.items[0].asin, 'B012345678');
  assert.equal(valid.items[0].price.cents, 1099);

  const failedHttp = run({ MOCK_STATUS: '503' }, 1);
  assert.equal(failedHttp.blockSignals.httpError, true);

  const redirected = run({ MOCK_URL: 'https://www.amazon.it/ap/signin' }, 1);
  assert.equal(redirected.blockSignals.unexpectedPage, true);
  assert.equal(redirected.itemCount, 0);

  process.stdout.write('PoC 060 synthetic command-boundary scenarios: PASS\n');
} finally {
  await rm(dir, { recursive: true, force: true });
}
