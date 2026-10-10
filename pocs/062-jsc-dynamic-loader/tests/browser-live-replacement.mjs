// Real Chrome, same-document classic module replacement with live UI, listeners,
// timers, abortable fetches and repeated post-GC heap sampling.
// Experimental PoC evidence only, not a guarantee for arbitrary application resources.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..'),loader=await readFile(join(root,'src/loader.js'),'utf8');
const dir=await mkdtemp(join(tmpdir(),'jsc-live-replace-'));
let requests=0,aborted=0;
const page="<!doctype html><meta charset=\"utf-8\"><script src=\"/loader.js\"></script><pre id=\"result\">WAIT</pre>\n<script>\n(async()=>{\n const out=document.getElementById('result');\n try{\n  const runtime=JscRuntime,names=['alpha','beta','gamma'],metrics={mounted:0,disposed:0,events:0,ticks:0,abortSignals:0};\n  const samples=[],wait=ms=>new Promise(ok=>setTimeout(ok,ms));\n  function definition(id,version){\n   return {id,deps:[],factory(_require,module){\n    metrics.mounted++;\n    const payload=new Array(12000).fill(version);\n    const button=document.createElement('button');\n    button.dataset.feature=id;button.textContent=id+' '+version;document.body.append(button);\n    const listener=()=>{metrics.events++;};\n    button.addEventListener('click',listener);\n    const timer=setInterval(()=>{metrics.ticks++;},5);\n    const controller=new AbortController();\n    if(version%50===0)fetch('/pending?v='+version+'&feature='+id,{signal:controller.signal}).catch(()=>{});\n    module.exports={version,read:()=>payload[0],click:()=>button.click()};\n    module.onDispose(()=>{\n     metrics.disposed++;clearInterval(timer);\n     button.removeEventListener('click',listener);button.remove();controller.abort();\n     if(controller.signal.aborted)metrics.abortSignals++;\n     payload.fill(null);\n    });\n   }};\n  }\n  for(let wave=0;wave<8;wave++){\n   for(let step=1;step<=100;step++){\n    const version=wave*100+step;\n    const expectedRevisions=Object.fromEntries(names.map(id=>[id,runtime.revision(id)]));\n    if(version%101===0){\n     let failed=false;\n     try{runtime.installBatch([{id:'alpha',deps:['does-not-exist'],factory(){}}]);}\n     catch(error){failed=/unavailable dependency/.test(String(error));}\n     if(!failed)throw Error('bad update should fail before disposal');\n    }\n    runtime.installBatch(names.map(id=>definition(id,version)),{expectedRevisions});\n    for(const id of names){\n     const instance=runtime.require(id);\n     if(instance.read()!==version)throw Error('wrong active version');\n     instance.click();\n    }\n    if(metrics.events!==3*version || metrics.mounted-metrics.disposed!==3 ||\n       document.querySelectorAll('[data-feature]').length!==3 ||\n       runtime.state().active!==3 || runtime.state().registered!==3)\n       throw Error('live DOM/listener/registry mismatch at '+version);\n   }\n   for(const id of names)runtime.invalidate(id);\n   if(metrics.mounted!==metrics.disposed||runtime.state().active!==0||\n      document.querySelectorAll('[data-feature]').length!==0 ||\n      metrics.abortSignals!==metrics.disposed)\n     throw Error('resources remained after invalidation at wave '+wave);\n   const previousTicks=metrics.ticks;\n   await wait(14);\n   if(metrics.ticks!==previousTicks)throw Error('disposed timers still running');\n   if(typeof gc!=='function'||!performance.memory?.usedJSHeapSize)throw Error('Chrome heap instrumentation unavailable');\n   gc();gc();await wait(10);\n   samples.push(performance.memory.usedJSHeapSize);\n  }\n  if(metrics.mounted!==2400||metrics.disposed!==2400||runtime.state().registered!==3)\n   throw Error('replacement count/registry mismatch');\n  const growth=samples[7]-samples[1];\n  if(growth>8*1048576)throw Error('post-GC heap growth above synthetic tolerance: '+growth);\n  out.textContent='PASS LIVE REPLACE mounts='+metrics.mounted+' disposed='+metrics.disposed+\n   ' registry='+runtime.state().registered+' heapMiB='+samples.map(n=>(n/1048576).toFixed(2)).join(',')+\n   ' laterGrowthMiB='+(growth/1048576).toFixed(2)+' aborts='+metrics.abortSignals;\n }catch(error){out.textContent='FAIL LIVE REPLACE '+error.stack;}\n})();\n</script>";
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(page);}
 else if(req.url==='/loader.js'){res.setHeader('Content-Type','text/javascript');res.end(loader);}
 else if(req.url?.startsWith('/pending?')){
  requests++;
  const timeout=setTimeout(()=>{if(!res.writableEnded)res.end('late');},250);
  req.on('aborted',()=>{aborted++;clearTimeout(timeout);});
  res.on('close',()=>clearTimeout(timeout));
 }else{res.statusCode=404;res.end('not found');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
try{
 const executable=process.env.CHROMIUM||'/usr/bin/chromium';
 const url='http://127.0.0.1:'+server.address().port+'/';
 const output=await new Promise((resolveResult,reject)=>{
  const chrome=spawn(executable,[
   '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
   '--user-data-dir='+join(dir,'profile'),'--js-flags=--expose-gc',
   '--enable-precise-memory-info','--virtual-time-budget=25000','--dump-dom',url
  ],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  const timeout=setTimeout(()=>{chrome.kill('SIGKILL');reject(Error('Chrome live-replace timeout: '+stderr.slice(-750)));},48000);
  chrome.stdout.on('data',s=>stdout+=s.toString());
  chrome.stderr.on('data',s=>stderr+=s.toString());
  chrome.on('error',e=>{clearTimeout(timeout);reject(e);});
  chrome.on('close',code=>{clearTimeout(timeout);resolveResult({code,stdout,stderr});});
 });
 assert.equal(output.code,0,output.stderr.slice(-1200));
 const match=output.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1]||'';
 assert.ok(match.startsWith('PASS LIVE REPLACE'),match||output.stdout.slice(-1600));
 assert.ok(requests>=6,'browser must initiate real abortable HTTP requests');
 console.log(match+'; pendingFetches='+requests+' abortedByTransport='+aborted);
}finally{
 server.closeAllConnections();
 await new Promise(ok=>server.close(ok));
 await rm(dir,{recursive:true,force:true});
}
