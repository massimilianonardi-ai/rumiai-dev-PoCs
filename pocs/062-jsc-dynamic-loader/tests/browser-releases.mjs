import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..');
const dir=await mkdtemp(join(tmpdir(),'jsc-release-'));
const assets=new Map();
const releases=new Map();
for (const version of ['v1','v2']) {
  const source=join(dir,version+'.js');
  const manifest=join(dir,version+'.json');
  const output=join(dir,version+'.bundle.js');
  await writeFile(source,`module.exports = {version: ${JSON.stringify(version)}};`);
  await writeFile(manifest, JSON.stringify({version:1,modules:[{id:'app',deps:[],file:version+'.js'}]}));
  const built=spawnSync(process.execPath,[join(root,'src/jsc.mjs'),manifest,output],{encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const bytes=await readFile(output);
  const digest=createHash('sha256').update(bytes).digest('hex').slice(0,16);
  const url=`/assets/${version}-${digest}.js`;
  assets.set(url,bytes);
  releases.set(version,{version,url,digest});
}
let active='v1',staged=false;
let stageCalls=0,publishCalls=0,oldAssetGets=0,workerUpdates=0;
function workerSource(version) { return `
const VERSION=${JSON.stringify(version)};
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type==='version') event.ports[0]?.postMessage(VERSION);
 if(event.data?.type==='activate') self.skipWaiting();
});`;
}
const controller=`<!doctype html><meta charset="utf-8"><pre id="result">WAIT</pre>
<script>
(async()=>{
  const result=document.getElementById('result');
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(fn,label) {
    for(let n=0;n<200;n++) {const value=fn();if(value) return value;await delay(20);}
    throw Error('timeout '+label);
  }
  async function serverRequest(url) {
    const response=await fetch(url,{cache:'no-store'});
    return {response,body:await response.json()};
  }
  async function workerVersion(worker) {
    return new Promise((resolve,reject)=>{
      const channel=new MessageChannel();
      const timeout=setTimeout(()=>reject(Error('service-worker version timeout')),1500);
      channel.port1.onmessage=e=>{clearTimeout(timeout);resolve(e.data);channel.port1.close();};
      worker.postMessage({type:'version'},[channel.port2]);
    });
  }
  async function frame() {
    const iframe=document.createElement('iframe');
    iframe.src='/client';
    document.body.appendChild(iframe);
    await new Promise((resolve,reject)=>{iframe.onload=resolve;iframe.onerror=()=>reject(Error('iframe load'));});
    if(!iframe.contentWindow.AppInfo) throw Error('client bundle did not initialize');
    return iframe;
  }
  try {
    if(!('serviceWorker' in navigator)) throw Error('Service Worker unsupported');
    const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
    await navigator.serviceWorker.ready;
    await until(()=>navigator.serviceWorker.controller,'initial control');
    if(await workerVersion(registration.active)!=='v1') throw Error('initial worker');
    const old=await frame();
    if(old.contentWindow.AppInfo.version!=='v1') throw Error('initial client');
    const before=await serverRequest('/release.json');
    if(before.response.headers.get('cache-control')!=='no-cache' || before.body.version!=='v1') throw Error('initial mutable release pointer');
    const premature=await serverRequest('/publish?v=v2');
    if(premature.response.status!==409) throw Error('incomplete release published');
    if((await serverRequest('/release.json')).body.version!=='v1') throw Error('pointer changed despite rejection');
    const stage=await serverRequest('/stage?v=v2');
    if(!stage.response.ok || stage.body.version!=='v2') throw Error('staging failed');
    const published=await serverRequest('/publish?v=v2');
    if(!published.response.ok || published.body.version!=='v2') throw Error('atomic pointer change failed');
    const pointer=await serverRequest('/release.json');
    if(pointer.body.version!=='v2' || pointer.body.url===before.body.url) throw Error('new pointer missing');
    const newClient=await frame();
    if(newClient.contentWindow.AppInfo.version!=='v2') throw Error('new client failed to use new release');
    if(old.contentWindow.AppInfo.version!=='v1') throw Error('open old client was silently replaced');
    const priorAsset=await fetch(before.body.url);
    if(!priorAsset.ok || priorAsset.headers.get('cache-control')!=='public, max-age=31536000, immutable' ||
       !(await priorAsset.text()).includes('jsc experimental')) throw Error('retained immutable old release unavailable');
    if(await workerVersion(registration.active)!=='v1') throw Error('worker changed without coordination');
    await registration.update();
    const waiting=await until(()=>registration.waiting,'v2 worker waiting');
    if(await workerVersion(waiting)!=='v2' || await workerVersion(registration.active)!=='v1') throw Error('unsafe worker auto-activation');
    if(old.contentWindow.AppInfo.version!=='v1') throw Error('old client mutated while worker was waiting');
    // A coordinated migration is explicitly required: close old clients first, then activate worker v2.
    old.remove();
    newClient.remove();
    waiting.postMessage({type:'activate'});
    await until(()=>registration.active===waiting && registration.active.state==='activated' && !registration.waiting,'v2 worker activation');
    await until(()=>navigator.serviceWorker.controller===registration.active,'worker controller change');
    if(await workerVersion(registration.active)!=='v2') throw Error('worker activation mismatch');
    const migrated=await frame();
    if(migrated.contentWindow.AppInfo.version!=='v2') throw Error('client migration did not pick new release');
    result.textContent='PASS RELEASES old=v1 new=v2 retainedImmutable=true blockedIncomplete=true waitingWorker=v2 migrated=v2';
  } catch(error) { result.textContent='FAIL RELEASES '+error.stack; }
})();
</script>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://example.test');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'");
  if(url.pathname==='/') {res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html');res.end(controller);}
  else if(url.pathname==='/client') {
    const item=releases.get(active);
    res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><script src="${item.url}"></script><script>window.AppInfo=JscRuntime.require('app');</script>`);
  }
  else if(assets.has(url.pathname)) {
    if(url.pathname===releases.get('v1').url) oldAssetGets++;
    res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    res.setHeader('Content-Type','text/javascript');res.end(assets.get(url.pathname));
  }
  else if(url.pathname==='/sw.js') {
    workerUpdates++;
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/javascript');res.end(workerSource(active));
  }
  else if(url.pathname==='/release.json') {
    res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(releases.get(active)));
  }
  else if(url.pathname==='/stage' && url.searchParams.get('v')==='v2') {
    stageCalls++;staged=true;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(releases.get('v2')));
  }
  else if(url.pathname==='/publish' && url.searchParams.get('v')==='v2') {
    publishCalls++;
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    if(!staged) {res.statusCode=409;res.end(JSON.stringify({error:'release not staged'}));}
    else {active='v2';res.end(JSON.stringify(releases.get(active)));}
  }
  else {res.writeHead(404);res.end('no route');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  const executable=process.env.CHROMIUM || '/usr/bin/chromium';
  const profile=join(dir,'profile');
  const url=`http://127.0.0.1:${server.address().port}/`;
  const child=spawn(executable,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--remote-allow-origins=*',url],{stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk.toString());
  let socket;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try {
    let port;
    for(let n=0;n<150;n++) {
      try {port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port>0)break;}
      catch { /* Chrome has not created the debugging endpoint yet. */ }
      await delay(100);
    }
    assert.ok(port>0,'Chrome remote-debugging port unavailable: '+stderr.slice(-1200));
    let target;
    for(let n=0;n<100;n++) {
      const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target=pages.find(x=>x.type==='page' && x.url.startsWith(url));
      if(target)break;
      await delay(100);
    }
    assert.ok(target?.webSocketDebuggerUrl,'Cannot find Chrome page debugging target');
    socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let nextId=1;
    const pending=new Map();
    socket.addEventListener('message',e=>{
      const msg=JSON.parse(String(e.data));
      if(!pending.has(msg.id))return;
      const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);
      if(msg.error)reject(Error(JSON.stringify(msg.error)));else resolve(msg.result);
    });
    function call(method,params={}) {
      const id=nextId++;
      return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    }
    await call('Runtime.enable');
    let observed='WAIT';
    for(let n=0;n<300;n++) {
      const data=await call('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true});
      observed=data.result?.value || 'WAIT';
      if(observed.startsWith('PASS RELEASES')||observed.startsWith('FAIL RELEASES'))break;
      await delay(100);
    }
    assert.ok(observed.startsWith('PASS RELEASES old=v1'),observed+'\n'+stderr.slice(-1400));
    assert.equal(stageCalls,1,'staging must occur once');
    assert.equal(publishCalls,2,'one rejected and one committed publish required');
    assert.ok(oldAssetGets>=1,'old immutable asset must remain available');
    assert.ok(workerUpdates>=2,'service worker must actually update');
    console.log(observed);
  } finally {
    socket?.close();
    child.kill('SIGKILL');
    await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('close',resolve);});
  }
} finally {await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
