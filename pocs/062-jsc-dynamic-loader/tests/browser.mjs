import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';

const root = resolve(import.meta.dirname, '..');
const dir = await mkdtemp(join(tmpdir(), 'jsc-chromium-'));
const out = join(dir, 'bundle.js');
const compiler = spawnSync(process.execPath, [join(root,'src/jsc.mjs'), join(root,'example/modules.json'), out], {encoding:'utf8'});
assert.equal(compiler.status, 0, compiler.stderr);
const compiled = await readFile(out, 'utf8');
let revision = 0;
let patchGets = 0;
const source = `<!doctype html><meta charset="utf-8"><script src="/bundle.js"></script><pre id="result">WAIT</pre>
<script>
(async () => {
 try {
  const runtime = globalThis.JscRuntime;
  if(runtime.state().active !== 0) throw Error('not lazy');
  if(runtime.require('application').run() !== 1) throw Error('initial');
  await runtime.loadScript('/patch.js', {expect:'counter'});
  if(runtime.require('application').run() !== 101) throw Error('patch1');
  await runtime.loadScript('/patch.js', {expect:'counter'});
  if(runtime.require('application').run() !== 102) throw Error('patch2');
  if(runtime.state().registered !== 2 || runtime.state().active !== 2) throw Error('unexpected registry');
  document.getElementById('result').textContent = 'PASS: CHROMIUM RELOAD ' + globalThis.__pocCounterDisposals;
 } catch(e) { document.getElementById('result').textContent = 'FAIL: ' + e.stack; }
})();
</script>`;
const server = http.createServer((req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
  if(req.url==='/') { res.setHeader('Content-Type','text/html');res.end(source); }
  else if(req.url==='/bundle.js') { res.setHeader('Content-Type','text/javascript');res.end(compiled); }
  else if(req.url==='/patch.js') {
    patchGets++;
    revision++;
    res.setHeader('Content-Type','text/javascript');
    res.end(`JscRuntime.install('counter',[],function(require,module){module.exports.next=()=>${100+revision};});`);
  } else {res.writeHead(404);res.end('no route');}
});
await new Promise(res=>server.listen(0,'127.0.0.1',res));
try {
  const port=server.address().port;
  const chromium=process.env.CHROMIUM || '/usr/bin/chromium';
  const cmd=await new Promise((resolve, reject) => {
    const child=spawn(chromium,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(dir,'chrome-profile')}`,'--no-first-run','--disable-dev-shm-usage','--virtual-time-budget=5000','--dump-dom',`http://127.0.0.1:${port}/`],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Chromium timeout: '+stderr.slice(-1200)));},25000);
    child.stdout.on('data', chunk => {stdout+=chunk.toString();});
    child.stderr.on('data', chunk => {stderr+=chunk.toString();});
    child.on('error', e => {clearTimeout(timeout);reject(e);});
    child.on('close', status => {clearTimeout(timeout);resolve({status,stdout,stderr});});
  });
  assert.equal(cmd.status,0,(cmd.stderr||'').slice(-1200));
  assert.match(cmd.stdout,/PASS: CHROMIUM RELOAD/);
  assert.equal(patchGets,2,`expected 2 real GET requests but received ${patchGets}`);
  console.log('PASS: real Chromium, CSP without unsafe-eval, two same-URL GET reloads with Cache-Control no-store');
} finally {await new Promise(res=>server.close(res));await rm(dir,{recursive:true,force:true});}
