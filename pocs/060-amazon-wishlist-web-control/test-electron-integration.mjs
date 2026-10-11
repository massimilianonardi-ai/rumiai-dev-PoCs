import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const providerRoot = process.env.ELECTRON_WEB_CONTROL_SOURCE;
if (!providerRoot) throw new Error('ELECTRON_WEB_CONTROL_SOURCE is required');
const temp = await mkdtemp(path.join(os.tmpdir(), 'rumiai-electron-wishlist-'));
const env = { ...process.env,
  WEB_CONTROL_HOME: path.join(temp, 'profile'),
  WEB_CONTROL_HEADLESS: '0',
  WEB_CONTROL_CONNECT_TIMEOUT_MS: '15000',
  ELECTRON_WEB_CONTROL_SOFTWARE_RENDERING: '1',
  AMAZON_SCROLL_WAIT_MS: '250',
  AMAZON_STABLE_ROUNDS: '3',
  AMAZON_MAX_ROUNDS: '40',
  WEB_CONTROL_CMD: path.join(providerRoot, 'bin', 'web-control')
};
const card = (asin, title, amount, action) =>
  '<li id="item_'+asin+'" data-itemid="'+asin+'">'+
  '<a id="itemName_'+asin+'" href="/dp/'+asin+'">'+title+'</a>'+
  (amount ? '<span class="a-price" id="itemPrice_'+asin+'">'+
    '<span class="a-offscreen">'+amount+' €</span></span>' : '')+
  '<button>'+action+'</button></li>';
const cards = [
  card('B012345678', 'First item', '10,99', 'Aggiungi al carrello'),
  card('B098765432', 'Second item', '20,99', 'Aggiungi al carrello'),
  card('B001122334', 'Third item', '', 'Visualizza tutte le opzioni')
];
const browserScript = 'let added=1;'+
  'window.addEventListener("scroll",()=>{'+
  'const root=document.documentElement;'+
  'const nearBottom=window.scrollY+window.innerHeight>=root.scrollHeight-180;'+
  'if(!nearBottom||added>=3)return;'+
  'const next=added++;'+
  'setTimeout(()=>document.querySelector("#wishlist").insertAdjacentHTML('+
  '"beforeend",'+JSON.stringify(cards)+'[next]),80);'+
  '});';
const fixtureHtml = '<!doctype html><html><head><meta charset="utf-8">'+
  '<title>Local wishlist fixture</title></head><body>'+
  '<h1>Local synthetic wishlist</h1><ul id="wishlist">'+cards[0]+'</ul>'+
  '<div style="height:1100px"></div><script>'+browserScript+'</script></body></html>';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (!/^\/hz\/wishlist\/ls\/[^/]+$/.test(url.pathname)) {
    response.writeHead(404, { 'content-type':'text/plain' });
    response.end('Missing'); return;
  }
  response.writeHead(200, { 'content-type':'text/html; charset=utf-8' });
  response.end(fixtureHtml);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const service = spawn(path.join(providerRoot, 'bin', 'web-control-service'), [], {
  cwd: providerRoot, env, stdio: ['ignore','pipe','pipe']
});
let stderr = '';
service.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 3500); });
try {
  const { stdout } = await exec(process.execPath,
    [path.join(root, 'probe.mjs'), origin + '/hz/wishlist/ls/TEST'], {
      cwd: root, env: { ...env, AMAZON_TEST_ORIGIN: origin },
      timeout: 120000, maxBuffer: 32 * 1024 * 1024
    });
  const observed = JSON.parse(stdout);
  assert.equal(observed.complete, true, 'stable bottom must be observed');
  assert.equal(observed.blocked, false);
  assert.equal(observed.itemCount, 3, 'all lazy-loaded items must be enumerated');
  assert.equal(observed.items.filter(x => x.price.verified).length, 2);
  assert.equal(observed.items.find(x => x.asin === 'B001122334').purchaseAction, 'view-all-options');
  assert.ok(observed.rounds.some(x => x.scrollY > 0), 'Electron must really scroll');
  assert.equal(observed.networkTrace, null);
  console.log('PoC 060 real Electron and lazy-loaded wishlist fixture: PASS');
} catch (error) {
  process.stderr.write(stderr.slice(-3000) + '\n');
  throw error;
} finally {
  service.kill('SIGTERM');
  if (service.exitCode === null) await Promise.race([
    new Promise(resolve => service.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3500))
  ]);
  server.close();
  await rm(temp, { recursive: true, force: true });
}
