import assert from 'node:assert/strict';
import { evaluate } from './price-monitor.mjs';

const row = (overrides = {}) => ({ asin: 'B012345678', description: 'Synthetic', url: 'https://www.amazon.it/dp/B012345678',
  currentCents: 2000, minimumCents: 1900, targetCents: 1500, targetNotifiedCents: null, ...overrides });
const run = (r, cents, extra = {}) => evaluate({ lists: [{ name: 'Watch', rows: [r] }],
  observations: cents == null ? [] : [{ asin: r.asin, priceCents: cents, verified: true }],
  checkedAt: '2026-10-10T12:00:00Z', ...extra });

let x = run(row(), 1400);
assert.equal(x.failed, false);
assert.equal(x.changes[0].differenceCents, -600);
assert.equal(x.changes[0].minimumCents, 1400);
assert.deepEqual(x.alerts[0].reasons, ['target','drop-7-percent-and-2-eur','new-minimum']);
assert.equal(x.changes[0].targetNotifiedCents, undefined);
assert.equal(x.alerts[0].notificationAcknowledgement.targetNotifiedCents, 1500);

x = run(row({ targetNotifiedCents: 1500 }), 1400);
assert.equal(x.alerts[0].reasons.includes('target'), false);
x = run(row({ targetNotifiedCents: 1500 }), 2100);
assert.equal(x.changes[0].targetNotifiedCents, null);
x = run(row({ targetCents: null, targetNotifiedCents: 1500 }), 2000);
assert.equal(x.changes[0].targetNotifiedCents, null);
x = run(row({ currentCents: 3000, minimumCents: 1500 }), 1900);
assert.equal(x.alerts[0].reasons.includes('drop-10-eur'), true);
x = run(row(), null);
assert.equal(x.failed, true);
assert.equal(x.changes.length, 0);
x = run(row(), 1400, { accessFailure: true });
assert.equal(x.failed, true);
assert.equal(x.alertNotificationRequired, true);
x = evaluate({ lists: [{name:'Watch',rows:[row()]},{name:'Star Wars',rows:[row({asin:'B999999999'})]}],
  observations:[{asin:'B012345678',priceCents:1400,verified:true}], checkedAt:'2026-10-10T12:00:00Z' });
assert.equal(x.failed,true);
assert.equal(x.coverage[1].verified,0);
console.log('PoC 060 price monitor decision tests: PASS');
