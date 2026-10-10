import assert from 'node:assert/strict';
import { extract } from './amazon-wishlist-extract.mjs';

await assert.rejects(() => extract(''), TypeError);
await assert.rejects(() => extract('https://example.com/hz/wishlist/ls/abc'), TypeError);
await assert.rejects(() => extract('https://www.amazon.it/dp/B012345678'), TypeError);
await assert.rejects(() => extract('https://www.amazon.it/hz/wishlist/ls/abc', { maxRounds: 0 }), TypeError);
await assert.rejects(() => extract('https://www.amazon.it/hz/wishlist/ls/abc', { timeoutMs: 0 }), TypeError);
console.log('PoC 060 extraction API argument tests: PASS');
