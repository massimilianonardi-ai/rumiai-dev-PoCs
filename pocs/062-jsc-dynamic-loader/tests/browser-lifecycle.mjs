import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import http from 'node:http';

const root = resolve(import.meta.dirname, '..');
const loader = await readFile(join(root, 'src/loader.js'), 'utf8');
const dir = await mkdtemp(join(tmpdir(), 'jsc-lifecycle-'));
const page = `<!doctype html><meta charset="utf-8"><script src="/loader.js"></script><pre id="result">WAIT</pre>
<script>
(async () => {
  const result = document.getElementById('result');
  try {
    const runtime = JscRuntime;
    const target = document.createElement('button');
    target.id = 'target';
    document.body.appendChild(target);
    const metrics = {mounted: 0, disposed: 0, clicks: 0, ticks: 0};
    let leakedClicks = 0;
    const retained = [];
    const samples = [];
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    function next(version) {
      return {id:'widget', deps:[], factory(_r, module) {
        metrics.mounted++;
        const large = new Array(8192).fill(version);
        const onClick = () => { metrics.clicks++; };
        const timer = setInterval(() => { metrics.ticks++; }, 3);
        target.addEventListener('click', onClick);
        module.exports = { version, read: () => large[0] };
        module.onDispose(() => {
          metrics.disposed++;
          clearInterval(timer);
          target.removeEventListener('click', onClick);
          large.fill(null);
        });
      }};
    }
    runtime.installBatch([next(0)]);
    let last = runtime.require('widget');
    await wait(20);
    if(metrics.ticks < 1) throw Error('browser timer never ran');
    for(let batch=0; batch<4; batch++) {
      for(let k=1; k<=300; k++) {
        const v=batch*300+k;
        const clicks=metrics.clicks;
        const lastActive=last;
        if (v % 200===0) retained.push(lastActive); // intentional external references
        const rev=runtime.revision('widget');
        if(v%175===0) {
          let rejected=false;
          try {runtime.installBatch([{id:'widget', deps:['missing'], factory(){}}]);}
          catch(err) {rejected=/unavailable dependency/.test(String(err));}
          if(!rejected || runtime.revision('widget')!==rev ||
             runtime.require('widget')!==lastActive) throw Error('bad batch disrupted active widget');
        }
        runtime.installBatch([next(v)], {expectedRevisions:{widget:rev}});
        last = runtime.require('widget');
        target.click();
        if(last.read()!==v || metrics.clicks!==clicks+1 ||
           metrics.mounted-metrics.disposed!==1) throw Error('leaked listener or inconsistent lifecycle: '+v);
      }
      // The prior timer must have been stopped; with one live widget ticks advance at a bounded rate.
      const prev=metrics.ticks;
      await wait(15);
      if(metrics.ticks<=prev || metrics.ticks-prev>12) throw Error('timer duplication: '+(metrics.ticks-prev));
      runtime.invalidate('widget');
      const stopped=metrics.ticks;
      await wait(15);
      if(metrics.ticks!==stopped) throw Error('timer survived invalidate');
      const clicks=metrics.clicks;
      target.click();
      if(metrics.clicks!==clicks) throw Error('listener survived invalidate');
      if(metrics.mounted!==metrics.disposed || runtime.state().active!==0) throw Error('active instances after dispose');
      last = runtime.require('widget'); // re-create once for next batch
      if (typeof gc !== 'function' || !performance.memory?.usedJSHeapSize) throw Error('browser heap GC unavailable');
      gc();gc();
      samples.push(performance.memory.usedJSHeapSize);
    }
    runtime.invalidate('widget');
    for(const item of retained) {
      if(item.read()!==null) throw Error('externally retained export was not disposed safely');
    }
    retained.length=0;
    if(metrics.mounted!==metrics.disposed) throw Error('final disposal mismatch');
    // Negative control: without onDispose, arbitrary external listeners remain.
    const stray=()=>{leakedClicks++;};
    runtime.install('unsafe',[],(_r,module)=>{
      target.addEventListener('click',stray);
      module.exports = {};
    });
    runtime.require('unsafe');
    runtime.invalidate('unsafe');
    target.click();
    if(leakedClicks!==1) throw Error('negative-control listener behavior changed');
    target.removeEventListener('click',stray);
    const growth=samples[3]-samples[1];
    if(growth>8*1048576) throw Error('heap growth after GC: '+growth);
    if(runtime.state().registered!==2 || runtime.state().active!==0) throw Error('registry did not remain bounded');
    result.textContent='PASS LIFECYCLE mounted='+metrics.mounted+' disposed='+metrics.disposed+
      ' heapMiB='+samples.map(n=>(n/1048576).toFixed(2)).join(',')+
      ' growthMiB='+(growth/1048576).toFixed(2)+' negativeControl='+leakedClicks;
  } catch(e) { result.textContent='FAIL LIFECYCLE '+e.stack; }
})();
</script>`;
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
  if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end(page);}
  else if(req.url==='/loader.js') {res.setHeader('Content-Type','text/javascript');res.end(loader);}
  else {res.writeHead(404);res.end('missing');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  const executable=process.env.CHROMIUM || '/usr/bin/chromium';
  const url=`http://127.0.0.1:${server.address().port}/`;
  const out=await new Promise((resolve,reject)=>{
    const child=spawn(executable,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-dev-shm-usage',`--user-data-dir=${join(dir,'profile')}`,'--js-flags=--expose-gc','--enable-precise-memory-info','--virtual-time-budget=18000','--dump-dom',url],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Chrome lifecycle timeout: '+stderr.slice(-900)));},40000);
    child.stdout.on('data',chunk=>stdout+=chunk.toString());
    child.stderr.on('data',chunk=>stderr+=chunk.toString());
    child.on('error',error=>{clearTimeout(timeout);reject(error);});
    child.on('close',status=>{clearTimeout(timeout);resolve({status,stdout,stderr});});
  });
  assert.equal(out.status,0,out.stderr.slice(-900));
  const report=out.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
  assert.ok(report?.startsWith('PASS LIFECYCLE mounted='),report || out.stdout.slice(-2200));
  console.log(report);
} finally {await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
