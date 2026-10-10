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
let batchGets = 0;
let badBatchGets = 0;
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
  await runtime.loadScript('/batch.js', {expect:['counter','application']});
  if(runtime.require('application').run()!==777) throw Error('batch patch');
  const priorCounter=runtime.revision('counter');
  const priorApp=runtime.revision('application');
  let rejected=false;
  try { await runtime.loadScript('/bad-batch.js',{expect:['counter','application']}); }
  catch(error){rejected=/without updating expected modules/.test(String(error));}
  if(!rejected) throw Error('invalid batch reported success');
  if(runtime.revision('counter')!==priorCounter || runtime.revision('application')!==priorApp ||
     runtime.require('application').run()!==777) throw Error('invalid batch changed running modules');
  // Real browser heap experiment after repeated module factory replacements.
  // This requires the browser flags below; GC readings are an experimental plateau check.
  if (typeof gc !== 'function' || !performance.memory || !performance.memory.usedJSHeapSize) {
    throw Error('Chromium GC / heap measurement unavailable');
  }
  const samples = [];
  for (let batch=0; batch<4; batch++) {
    for (let n=0; n<750; n++) {
      const seq = batch*750+n;
      runtime.install('counter', [], function(_r, module) {
        const payload = new Array(4096).fill(seq);
        module.exports.next = () => payload[0];
        module.onDispose(() => payload.fill(null));
      });
      if(runtime.require('application').run() !== seq) throw Error('churn mismatch');
    }
    runtime.invalidate('counter');
    gc(); gc();
    samples.push(performance.memory.usedJSHeapSize);
  }
  const growth = samples[3]-samples[1];
  if(growth > 8*1024*1024) throw Error('browser heap grew by '+growth+' bytes after GC');
  if(runtime.state().registered!==2 || runtime.state().active!==0) throw Error('registry growth');
  document.getElementById('result').textContent = 'PASS: CHROMIUM RELOAD ' + globalThis.__pocCounterDisposals + ' BROWSER_HEAP_MIB ' + samples.map(v=>(v/1048576).toFixed(2)).join(',') + ' GROWTH_MIB ' + (growth/1048576).toFixed(2);
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
  } else if(req.url==='/batch.js') {
    batchGets++;
    res.setHeader('Content-Type','text/javascript');
    res.end("JscRuntime.installBatch([{id:'counter',deps:[],factory:function(_r,m){m.exports.next=()=>777;}},{id:'application',deps:['counter'],factory:function(r,m){m.exports.run=()=>r('counter').next();}}]);");
  } else if(req.url==='/bad-batch.js') {
    badBatchGets++;
    res.setHeader('Content-Type','text/javascript');
    res.end("JscRuntime.installBatch([{id:'counter',deps:[],factory:function(_r,m){m.exports.next=()=>999;}},{id:'application',deps:['missing'],factory:function(){}}]);");
  } else {res.writeHead(404);res.end('no route');}
});
await new Promise(res=>server.listen(0,'127.0.0.1',res));
try {
  const port=server.address().port;
  const chromium=process.env.CHROMIUM || '/usr/bin/chromium';
  const cmd=await new Promise((resolve, reject) => {
    const child=spawn(chromium,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(dir,'chrome-profile')}`,'--no-first-run','--disable-dev-shm-usage','--enable-precise-memory-info','--js-flags=--expose-gc','--virtual-time-budget=12000','--dump-dom',`http://127.0.0.1:${port}/`],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Chromium timeout: '+stderr.slice(-1200)));},25000);
    child.stdout.on('data', chunk => {stdout+=chunk.toString();});
    child.stderr.on('data', chunk => {stderr+=chunk.toString();});
    child.on('error', e => {clearTimeout(timeout);reject(e);});
    child.on('close', status => {clearTimeout(timeout);resolve({status,stdout,stderr});});
  });
  assert.equal(cmd.status,0,(cmd.stderr||'').slice(-1200));
  assert.match(cmd.stdout,/PASS: CHROMIUM RELOAD/);
  assert.match(cmd.stdout,/BROWSER_HEAP_MIB/);
  const reported = cmd.stdout.match(/BROWSER_HEAP_MIB ([0-9.,]+) GROWTH_MIB (-?[0-9.]+)/);
  assert.ok(reported, 'browser heap measurements missing');
  console.log('Browser post-GC heap MiB:',reported[1],'growth MiB:',reported[2]);
  assert.equal(patchGets,2,`expected 2 real GET requests but received ${patchGets}`);
  assert.equal(batchGets,1,'expected one complete batch request');
  assert.equal(badBatchGets,1,'expected one invalid batch request');
  console.log('PASS: real Chromium, CSP without unsafe-eval, two same-URL GET reloads, batch success/rejection, no-store and 3000 GC-checked updates');
} finally {await new Promise(res=>server.close(res));await rm(dir,{recursive:true,force:true});}
