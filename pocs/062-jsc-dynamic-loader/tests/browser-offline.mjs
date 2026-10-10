import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..');
const dir=await mkdtemp(join(tmpdir(),'jsc-offline-'));
const assets=new Map();
const releases=new Map();
for (const version of ['v1','v2']) {
  const source=join(dir,version+'.js');
  const manifest=join(dir,version+'.json');
  const output=join(dir,version+'.bundle.js');
  await writeFile(source,`module.exports = {version: ${JSON.stringify(version)}};`);
  await writeFile(manifest, JSON.stringify({version:1,modules:[{id:'app',deps:[],file:version+'.js'}]}));
  const built=spawnSync(process.execPath,[join(root,'src/assemble.mjs'),manifest,output],{encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const bytes=await readFile(output);
  const digest=createHash('sha256').update(bytes).digest('hex').slice(0,16);
  const url=`/assets/${version}-${digest}.js`;
  assets.set(url,bytes);
  releases.set(version,{version,url,digest});
}
let active='v1',staged=false;
let stageCalls=0,publishCalls=0,oldAssetGets=0,workerUpdates=0,outageHits=0,unavailable=false;
function workerSource(version) { return [
 'const RELEASE='+JSON.stringify(releases.get(version))+';',
 "const CACHE='jsc-pinned-'+RELEASE.version;",
 "self.addEventListener('install',e=>e.waitUntil((async()=>{",
 " const cache=await caches.open(CACHE);await cache.addAll(['/', '/client', '/release.json',RELEASE.url]);",
 "})()));",
 "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));",
 "self.addEventListener('message',e=>{if(e.data?.type==='activate')self.skipWaiting();});",
 "self.addEventListener('fetch',e=>{",
 " const url=new URL(e.request.url);",
 " if(e.request.method!=='GET'||url.origin!==self.location.origin)return;",
 " if(!(['/', '/client','/release.json',RELEASE.url].includes(url.pathname))||url.search)return;",
 " e.respondWith((async()=>{",
 "  try{const result=await fetch(e.request,{cache:'no-store'});if(result.ok)return result;}catch{}",
 "  const cache=await caches.open(CACHE);const saved=await cache.match(e.request);",
 "  if(!saved)return Response.error();",
 "  const headers=new Headers(saved.headers);headers.set('X-PoC-Cached-Release',RELEASE.version);",
 "  return new Response(saved.body,{status:saved.status,headers});",
 " })());",
 "});"
].join('\n'); }
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
    return {response,body:await response.json(),cached:response.headers.get('x-poc-cached-release')};
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
    if(!('serviceWorker' in navigator))throw Error('Service Worker unsupported');
    const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
    await navigator.serviceWorker.ready;
    await until(()=>navigator.serviceWorker.controller,'v1 controls page');
    if(await workerVersion(registration.active)!=='v1')throw Error('wrong first worker');
    if(!(await caches.keys()).includes('jsc-pinned-v1'))throw Error('v1 precache missing');
    for(const path of ['/', '/client','/release.json']){
      if(!(await (await caches.open('jsc-pinned-v1')).match(path)))throw Error('uncached '+path);
    }
    const initial=await frame();
    if(initial.contentWindow.AppInfo.version!=='v1')throw Error('initial v1 client');
    const down=await serverRequest('/outage?mode=on');
    if(!down.response.ok||!down.body.unavailable)throw Error('outage not injected');
    const cachedPointer=await serverRequest('/release.json');
    if(cachedPointer.cached!=='v1'||cachedPointer.body.version!=='v1')throw Error('offline pointer not pinned to v1');
    const cachedAsset=await fetch(cachedPointer.body.url,{cache:'no-store'});
    if(cachedAsset.headers.get('x-poc-cached-release')!=='v1'||!cachedAsset.ok)throw Error('offline JS not served by Cache Storage');
    const offlineV1=await frame();
    if(offlineV1.contentWindow.AppInfo.version!=='v1')throw Error('offline iframe navigation failed');
    const back=await serverRequest('/outage?mode=off');
    if(!back.response.ok||back.body.unavailable)throw Error('backend failed to recover');
    if((await serverRequest('/publish?v=v2')).response.status!==409)throw Error('premature publication was not blocked');
    await serverRequest('/stage?v=v2');
    if((await serverRequest('/publish?v=v2')).body.version!=='v2')throw Error('failed to publish v2');
    if(initial.contentWindow.AppInfo.version!=='v1')throw Error('old client auto upgraded');
    await registration.update();
    const waiting=await until(()=>registration.waiting,'v2 worker waiting');
    if(await workerVersion(waiting)!=='v2'||await workerVersion(registration.active)!=='v1')throw Error('version continuity failed');
    const both=await caches.keys();
    if(!both.includes('jsc-pinned-v1')||!both.includes('jsc-pinned-v2'))throw Error('pinned release cache missing');
    await serverRequest('/outage?mode=on');
    const stillOld=await frame();
    if(stillOld.contentWindow.AppInfo.version!=='v1')throw Error('waiting v2 broke offline v1');
    if((await serverRequest('/release.json')).cached!=='v1')throw Error('v1 pointer lost while v2 waits');
    await serverRequest('/outage?mode=off');
    initial.remove();offlineV1.remove();stillOld.remove();
    waiting.postMessage({type:'activate'});
    await until(()=>registration.active===waiting && !registration.waiting && registration.active.state==='activated','explicit v2 SW activation');
    await until(()=>navigator.serviceWorker.controller===registration.active,'v2 control');
    const onlineV2=await frame();
    if(onlineV2.contentWindow.AppInfo.version!=='v2')throw Error('new release did not load');
    await serverRequest('/outage?mode=on');
    const offlinePointer2=await serverRequest('/release.json');
    if(offlinePointer2.cached!=='v2'||offlinePointer2.body.version!=='v2')throw Error('v2 offline release pointer incorrect');
    const offlineV2=await frame();
    if(offlineV2.contentWindow.AppInfo.version!=='v2')throw Error('offline v2 navigation failed');
    if(!(await (await caches.open('jsc-pinned-v1')).match('/client')))throw Error('old pinned release prematurely evicted');
    result.textContent='PASS OFFLINE real service worker cache, offline v1/v2 navigation, pinned assets, explicit activation';
  } catch(error) { result.textContent='FAIL OFFLINE '+error.stack; }
})();
</script>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://example.test');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'");
  if(url.pathname==='/outage'){
    unavailable=url.searchParams.get('mode')==='on';
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({unavailable}));return;
  }
  if(unavailable){outageHits++;res.statusCode=503;res.setHeader('Cache-Control','no-store');res.end('backend unavailable');return;}
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
      if(observed.startsWith('PASS OFFLINE')||observed.startsWith('FAIL OFFLINE'))break;
      await delay(100);
    }
    assert.ok(observed.startsWith('PASS OFFLINE'),observed+'\n'+stderr.slice(-1400));
    assert.equal(stageCalls,1,'staging must occur once');
    assert.equal(publishCalls,2,'one rejected and one committed publish required');
    assert.ok(oldAssetGets>=1,'old immutable asset must be fetched for offline pre-cache');
    assert.ok(outageHits>=3,'backend must actually refuse navigation/asset requests');
    assert.ok(workerUpdates>=2,'service worker must actually update');
    console.log(observed+'; backend refused '+outageHits+' requests');
  } finally {
    socket?.close();
    child.kill('SIGKILL');
    await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('close',resolve);});
  }
} finally {await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
