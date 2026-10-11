import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWishlistHtml } from './wishlist-html.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'rumiai-amazon-060-'));
const mockPath = path.join(dir, 'mock-web-control');
const probePath = fileURLToPath(new URL('probe.mjs', import.meta.url));
const html = String.raw`<!doctype html><html><head><title>Wishlist</title></head><body>
<li id="item_1"><a href="/dp/B012345678" id="itemName_1">Synthetic product</a>
<span class="a-price" id="itemPrice_1"><span class="a-offscreen">10,99 €</span></span>
<button>%%ACTION%%</button></li></body></html>`;
const mock = String.raw`#!/usr/bin/env node
const args=process.argv.slice(2);
const emit=o=>process.stdout.write(JSON.stringify(o)+'\n');
const url=process.env.MOCK_URL || 'https://www.amazon.it/hz/wishlist/ls/TEST';
const status=Number(process.env.MOCK_STATUS || '200');
const action=process.env.MOCK_ACTION || 'Aggiungi al carrello';
const spinner=process.env.MOCK_SPINNER==='1'
  ? '<div class="a-spinner-wrapper"><span class="a-spinner-medium"></span></div>'
  : process.env.MOCK_SPINNER==='hidden'
    ? '<div class="a-hidden"><span class="a-spinner-wrapper"><span class="a-spinner-medium"></span></span></div>'
    : '';
const more=process.env.MOCK_LOAD_MORE==='1'
  ? '<button id="wl-load-more">Load more</button>' : '';
const html='<!doctype html><html><head><title>Wishlist</title></head><body><li id="item_1">'+
'<a href="/dp/B012345678" id="itemName_1">Synthetic product</a>'+
'<span class="a-price" id="itemPrice_1"><span class="a-offscreen">10,99 €</span></span>'+
'<button>'+action+'</button></li>'+spinner+more+'</body></html>';
if (args[0]==='page'&&args[1]==='new') emit({id:'page-1'});
else if (args[0]==='page'&&args[1]==='navigate')
  emit({page:'page-1',url,status,statusText:status>=400?'Error':'OK',title:'Wishlist'});
else if (args[0]==='page'&&args[1]==='inspect'&&args[3]==='summary') {
  if (process.env.MOCK_PAGE_MISSING==='1') {
    process.stderr.write('web-control: unknown page: page-1\\n');
    process.exitCode=1;
  } else emit({id:'page-1',url,title:'Wishlist'});
}
else if (args[0]==='page'&&args[1]==='inspect'&&args[3]==='html')
  emit({page:'page-1',html:url.includes('/hz/wishlist/ls/')?html:'<html><body>Sign in</body></html>'});
else if (args[0]==='page'&&args[1]==='scroll')
  emit({page:'page-1',scrollY:0,documentHeight:100,viewportHeight:100,
    atBottom:process.env.MOCK_NOT_AT_BOTTOM!=='1'});
else if (args[0]==='page'&&args[1]==='list') emit([{id:'page-2'}]);
else if (args[0]==='page'&&args[1]==='close') emit({page:'page-1',closed:true});
else { process.stderr.write('unexpected common web-control command\n');process.exitCode=8; }
`;
try {
  await writeFile(mockPath,mock,'utf8');await chmod(mockPath,0o700);
  function run(overrides,expectedStatus) {
    const result=spawnSync(process.execPath,[probePath],{
      encoding:'utf8',timeout:15000,env:{...process.env,WEB_CONTROL_CMD:mockPath,
        AMAZON_SCROLL_WAIT_MS:'1',AMAZON_STABLE_ROUNDS:'2',AMAZON_MAX_ROUNDS:'5',...overrides}
    });
    assert.equal(result.status,expectedStatus,result.stderr||String(result.error));
    return JSON.parse(result.stdout);
  }
  const good=run({},0);
  assert.equal(good.itemCount,1);
  assert.equal(good.items[0].price.cents,1099);
  assert.equal(good.items[0].purchaseAction,'add-to-cart');
  assert.equal(good.networkTrace,null);
  assert.equal(run({MOCK_ACTION:'Visualizza tutte le opzioni'},0).items[0].purchaseAction,'view-all-options');
  assert.equal(run({MOCK_ACTION:'Other'},0).items[0].purchaseAction,'unknown');
  const hiddenSpinner=run({MOCK_SPINNER:'hidden'},0);
  assert.equal(hiddenSpinner.completionReason,'stable-bottom');
  assert.deepEqual(hiddenSpinner.spinnerMarkersAtCompletion,[]);
  const persistentSpinner=run({MOCK_SPINNER:'1',AMAZON_MAX_ROUNDS:'12'},0);
  assert.equal(persistentSpinner.itemCount,1);
  assert.equal(persistentSpinner.completionReason,'stable-bottom-spinner-markers');
  assert.equal(persistentSpinner.stableRounds,6); // 3 * STABLE_ROUNDS=2
  assert.ok(persistentSpinner.spinnerMarkersAtCompletion.length>=1);
  assert.equal(persistentSpinner.rounds.at(-1).atBottom,true);
  const notSettledSpinner=run({MOCK_SPINNER:'1',AMAZON_MAX_ROUNDS:'5'},1);
  assert.equal(notSettledSpinner.completionReason,'max-rounds-reached');
  const actionableMore=run({MOCK_SPINNER:'1',MOCK_LOAD_MORE:'1',AMAZON_MAX_ROUNDS:'12'},1);
  assert.equal(actionableMore.stableRounds,0);
  assert.equal(actionableMore.completionReason,'max-rounds-reached');
  const lost=run({MOCK_PAGE_MISSING:'1'},2);
  assert.equal(lost.complete,false);
  assert.equal(lost.blocked,false);
  assert.equal(lost.completionReason,'page-unavailable');
  assert.equal(lost.failure.operation,'page inspect');
  assert.equal(lost.failure.page,'page-1');
  assert.deepEqual(lost.failure.livePageIds,['page-2']);
  const incomplete=run({MOCK_NOT_AT_BOTTOM:'1'},1);
  assert.equal(incomplete.complete,false);
  assert.equal(incomplete.itemCount,1);
  assert.equal(incomplete.rounds.length,5);
  assert.equal(incomplete.completionReason,'max-rounds-reached');
  const apiScript = [
    "import { extract } from " + JSON.stringify(new URL('./amazon-wishlist-extract.mjs', import.meta.url).href) + ";",
    "try { await extract('https://www.amazon.it/hz/wishlist/ls/TEST',",
    "{webControlCommand: process.env.WEB_CONTROL_CMD, maxRounds: 3}); process.exitCode = 93; }",
    "catch (error) { console.log(JSON.stringify(error.observation || null)); }"
  ].join('\n');
  const apiResult = spawnSync(process.execPath,['--input-type=module','-e',apiScript],{
    encoding:'utf8',timeout:15000,env:{...process.env,WEB_CONTROL_CMD:mockPath,
      MOCK_PAGE_MISSING:'1',AMAZON_SCROLL_WAIT_MS:'1'}
  });
  assert.equal(apiResult.status,0,apiResult.stderr);
  assert.equal(JSON.parse(apiResult.stdout).failure.reason,'page-unavailable');
  const unavailable=run({MOCK_STATUS:'503'},1);
  assert.equal(unavailable.blockSignals.httpError,true);
  const redirect=run({MOCK_URL:'https://www.amazon.it/ap/signin'},1);
  assert.equal(redirect.blockSignals.unexpectedPage,true);
  assert.equal(redirect.itemCount,0);
  assert.equal(parseWishlistHtml(html.replace('%%ACTION%%','Aggiungi al carrello'),
    'https://www.amazon.it/hz/wishlist/ls/TEST').items[0].asin,'B012345678');
  console.log('PoC 060 provider-neutral HTML and scroll mock tests: PASS');
} finally { await rm(dir,{recursive:true,force:true}); }
