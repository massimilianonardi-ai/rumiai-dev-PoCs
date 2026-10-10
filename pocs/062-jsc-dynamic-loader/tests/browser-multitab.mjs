// PoC 062: real top-level Chrome tabs, app-level upgrade votes and explicit state transfer.
// No new jsc runtime contract is implied by the test-only coordination protocol.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..');
const dir=await mkdtemp(join(tmpdir(),'jsc-tabs-'));
const releases=new Map(), assets=new Map();
for(const version of ['v1','v2']){
  const source=join(dir,version+'.js'),manifest=join(dir,version+'.json'),out=join(dir,version+'.bundle.js');
  await writeFile(source,`module.exports = {version:${JSON.stringify(version)}};`);
  await writeFile(manifest,JSON.stringify({version:1,modules:[{id:'app',deps:[],file:version+'.js'}]}));
  const result=spawnSync(process.execPath,[join(root,'src/assemble.mjs'),manifest,out],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const bytes=await readFile(out),sha=createHash('sha256').update(bytes).digest('hex').slice(0,16);
  const url=`/assets/${version}-${sha}.js`;
  assets.set(url,bytes);releases.set(version,{version,url,sha});
}
let active='v1',staged=false,halfUploads=0,rejectedPublishes=0,earlyEvictions=0,workerRequests=0;
let failNextPointer=0, interruptedReloads=0;
const page=`<!doctype html><meta charset="utf-8"><pre id="result">LOADING</pre><script>
(async()=>{
  const view=document.getElementById('result');
  try {
    const resp=await fetch('/release.json',{cache:'no-store'});
    if(!resp.ok)throw Error('release pointer unavailable');
    const pointer=await resp.json();
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=pointer.url;
      script.onload=resolve;script.onerror=()=>reject(Error('immutable release asset unavailable'));
      document.head.appendChild(script);
    });
    const app=JscRuntime.require('app');
    if(app.version!==pointer.version)throw Error('mixed release bundle');
    let state={schema:app.version==='v1'?1:2,count:0,dirty:false};
    const saved=sessionStorage.getItem('jsc-migration');
    if(saved){
      const parsed=JSON.parse(saved);
      if(app.version!=='v2' || parsed.schema!==1 || !Number.isSafeInteger(parsed.count) || parsed.count<0)
        throw Error('unsupported persisted state: user recovery required');
      state={schema:2,count:parsed.count,dirty:false};sessionStorage.removeItem('jsc-migration');
    }
    const tabId=sessionStorage.getItem('jsc-tab-id')||Math.random().toString(36).slice(2);
    sessionStorage.setItem('jsc-tab-id',tabId);
    const channel=new BroadcastChannel('jsc-migration-poc');
    const votes=new Map();
    let responding=true;
    channel.onmessage=e=>{
      const data=e.data;
      if(responding && data.type==='prepare' && data.from!==tabId){
        channel.postMessage({type:'vote',token:data.token,from:tabId,ready:!state.dirty,version:app.version});
      }
      if(data.type==='vote' && votes.has(data.token))votes.get(data.token).push(data);
    };
    window.demo={
      get version(){return app.version;},get state(){return {...state};},get tabId(){return tabId;},
      add(n){state.count+=n;return state.count;},
      dirty(flag){state.dirty=!!flag;},
      responding(flag){responding=!!flag;},
      async plan(peers){
        // Test-only fail-closed vote policy: known peers must all acknowledge readiness.
        const replies=await this.prepare();
        const missing=peers.filter(id=>!replies.some(v=>v.from===id));
        const vetoed=replies.filter(v=>peers.includes(v.from)&&!v.ready).map(v=>v.from);
        return {ready:!state.dirty&&missing.length===0&&vetoed.length===0,missing,vetoed};
      },
      async poll(){try{const r=await fetch('/release.json?interrupt=1',{cache:'no-store'});if(!r.ok)throw Error('http '+r.status);return 'unexpected-success';}catch(e){return 'recoverable-network-failure';}},
      async brokenPatch(){const before=JscRuntime.revision('app');try{await JscRuntime.loadScript('/broken-patch.js',{expect:'app'});return false;}catch(e){return JscRuntime.revision('app')===before;}},
      async prepare(){const token=tabId+'-'+Math.random();votes.set(token,[]);
        channel.postMessage({type:'prepare',from:tabId,token});
        await new Promise(r=>setTimeout(r,300));const list=votes.get(token);votes.delete(token);return list;
      },
      migrate(){
        if(state.dirty)throw Error('unsaved state blocks update');
        if(app.version!=='v1'||state.schema!==1||!Number.isSafeInteger(state.count)||state.count<0)
          throw Error('incompatible migration requires user decision');
        sessionStorage.setItem('jsc-migration',JSON.stringify({schema:1,count:state.count}));
        setTimeout(()=>location.reload(),0);return 'reload-scheduled';
      }
    };
    view.textContent='READY '+app.version;
  }catch(error){view.textContent='ERROR '+error.stack;}
})();
</script>`;
const sw=version=>`const VERSION=${JSON.stringify(version)};self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{if(e.data?.type==='version')e.ports[0]?.postMessage(VERSION);if(e.data?.type==='activate')self.skipWaiting();});`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://example.invalid');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline';connect-src 'self'");
  if(url.pathname==='/'){
    res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type','text/html');res.end(page);
  }else if(url.pathname==='/release.json'){
    res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type','application/json');
    if(url.searchParams.has('interrupt')){res.statusCode=503;res.end(JSON.stringify({error:'pointer temporarily unavailable'}));}
    else if(failNextPointer>0){failNextPointer--;interruptedReloads++;res.statusCode=503;res.end(JSON.stringify({error:'simulated outage during migration reload'}));}
    else res.end(JSON.stringify(releases.get(active)));
  }else if(assets.has(url.pathname)){
    res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    res.setHeader('Content-Type','text/javascript');res.end(assets.get(url.pathname));
  }else if(url.pathname==='/broken-patch.js'){
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/javascript');
    res.setHeader('Content-Length','10000');res.write('/* truncated');res.destroy();
  }else if(url.pathname==='/sw.js'){
    workerRequests++;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/javascript');res.end(sw(active));
  }else if(url.pathname==='/stage'){
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    if(url.searchParams.get('partial')==='1'){
      halfUploads++;res.statusCode=503;res.end(JSON.stringify({error:'interrupted publication'}));
    }else{staged=true;res.end(JSON.stringify({staged:true}));}
  }else if(url.pathname==='/publish'){
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    if(!staged){rejectedPublishes++;res.statusCode=409;res.end(JSON.stringify({error:'incomplete-release'}));}
    else{active='v2';res.end(JSON.stringify(releases.get(active)));}
  }else if(url.pathname==='/evict-v1'){
    earlyEvictions++;res.statusCode=409;res.setHeader('Cache-Control','no-store');res.end('old asset still pinned by clients');
  }else{res.statusCode=404;res.end('missing');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let chrome,connections=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  const port=server.address().port,origin=`http://127.0.0.1:${port}/`;
  const profile=join(dir,'profile');
  chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',[
    '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
    `--user-data-dir=${profile}`,'--remote-debugging-port=0','--remote-allow-origins=*','about:blank'
  ],{stdio:['ignore','pipe','pipe']});
  let chromeError='';chrome.stderr.on('data',data=>{chromeError+=data.toString();});
  let debugPort=0;
  for(let n=0;n<150;n++){
    try{debugPort=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(debugPort>0)break;}
    catch{} await delay(100);
  }
  assert.ok(debugPort>0,'Chrome CDP unavailable: '+chromeError.slice(-1000));
  async function tab(){
    const response=await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(origin)}`,{method:'PUT'});
    assert.equal(response.status,200, 'CDP Target.new failed');
    const target=await response.json();
    const socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    const pending=new Map();let id=0;
    socket.addEventListener('message',ev=>{const msg=JSON.parse(String(ev.data));const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);if(msg.error)p.reject(Error(JSON.stringify(msg.error)));else p.resolve(msg.result);});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
    await call('Runtime.enable');
    const evalJs=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('JS '+expression.slice(0,90)+' '+JSON.stringify(r.exceptionDetails));return r.result.value;};
    const until=async(expression,truthy=true)=>{
      for(let n=0;n<160;n++){try{const value=await evalJs(expression);if(truthy?value:!value)return value;}catch{}await delay(100);}throw Error('Timeout waiting for '+expression);
    };
    const ret={targetId:target.id,socket,call,evalJs,until};connections.push(ret);
    await until('Boolean(window.demo)');
    return ret;
  }
  const a=await tab(),b=await tab();
  assert.equal(await a.evalJs('demo.version'),'v1');assert.equal(await b.evalJs('demo.version'),'v1');
  assert.notEqual(await a.evalJs('demo.tabId'),await b.evalJs('demo.tabId'),'distinct tabs must have distinct session IDs');
  // Close a real third top-level tab; its former identity must not turn into implicit consent.
  const vanished=await tab(), vanishedId=await vanished.evalJs('demo.tabId');
  const closed=await fetch(`http://127.0.0.1:${debugPort}/json/close/${encodeURIComponent(vanished.targetId)}`);
  assert.equal(closed.status,200,'Chrome target close request must succeed');
  await new Promise((resolve,reject)=>{
    if(vanished.socket.readyState===WebSocket.CLOSED)return resolve();
    const timeout=setTimeout(()=>reject(Error('closed Chrome tab socket remained open')),5000);
    vanished.socket.addEventListener('close',()=>{clearTimeout(timeout);resolve();},{once:true});
  });
  const vanishedVote=await a.evalJs('demo.plan(['+JSON.stringify(vanishedId)+'])');
  assert.equal(vanishedVote.ready,false,'closed peer cannot authorize migration');
  assert.deepEqual(vanishedVote.missing,[vanishedId]);
  assert.equal(await a.evalJs('demo.version'),'v1');
  // Activate v1 SW while both v1 tabs are open, then test v2 waiting after release publication.
  assert.equal(await a.evalJs('navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(()=>true)'),true);
  await a.evalJs('navigator.serviceWorker.ready.then(()=>true)');
  await a.until('Boolean(navigator.serviceWorker.controller)');
  await b.until('Boolean(navigator.serviceWorker.controller)');
  assert.equal(await a.evalJs('demo.add(3)'),3);assert.equal(await b.evalJs('demo.add(5)'),5);
  await b.evalJs('demo.dirty(true)');
  // A temporarily unresponsive peer is NOT an implicit affirmative vote.
  const peerB=await b.evalJs('demo.tabId');
  await b.evalJs('demo.responding(false)');
  const missing=await a.evalJs('demo.plan(['+JSON.stringify(peerB)+'])');
  assert.equal(missing.ready,false,'missing peer acknowledgement must block');
  assert.deepEqual(missing.missing,[peerB]);
  await b.evalJs('demo.responding(true)');
  // Two actual top-level tabs, no frame simulation: one dirty tab vetoes a proposed migration.
  const blocked=await a.evalJs('demo.plan(['+JSON.stringify(peerB)+'])');
  assert.equal(blocked.ready,false);assert.deepEqual(blocked.vetoed,[peerB]);
  assert.equal(await a.evalJs('demo.poll()'),'recoverable-network-failure');
  assert.equal(await a.evalJs('demo.brokenPatch()'),true);
  assert.equal(await a.evalJs('demo.state.count'),3);
  const base=await(await fetch(origin+'release.json')).json();
  assert.equal(base.version,'v1');
  assert.equal((await fetch(origin+'stage?partial=1')).status,503);
  assert.equal((await fetch(origin+'publish')).status,409);
  assert.equal((await(await fetch(origin+'release.json')).json()).version,'v1');
  assert.equal((await fetch(origin+'stage')).status,200);
  assert.equal((await fetch(origin+'publish')).status,200);
  assert.equal((await(await fetch(origin+'release.json')).json()).version,'v2');
  assert.equal((await fetch(origin+'evict-v1')).status,409);
  assert.equal((await fetch(new URL(base.url,origin))).status,200,'old immutable artifact still available');
  assert.equal(await a.evalJs('demo.version'),'v1');assert.equal(await b.evalJs('demo.version'),'v1');
  // With two real controlled tabs, v2 worker must wait until BOTH clients are migrated.
  await a.evalJs('navigator.serviceWorker.getRegistration().then(r=>r.update()).then(()=>true)');
  await a.until('navigator.serviceWorker.getRegistration().then(r=>Boolean(r?.waiting))');
  assert.equal(await a.evalJs('navigator.serviceWorker.getRegistration().then(r=>r.active!==r.waiting)'),true);
  await b.evalJs('demo.dirty(false)');
  const ready=await a.evalJs('demo.plan(['+JSON.stringify(peerB)+'])');assert.equal(ready.ready,true);assert.deepEqual(ready.missing,[]);
  // Fail the release-pointer fetch after migration snapshot but before the new app initializes.
  // The old document is gone after reload; an explicit retry must recover the saved snapshot.
  failNextPointer=1;
  await a.evalJs('demo.migrate()');
  await a.until('document.getElementById("result")?.textContent?.includes("release pointer unavailable")');
  assert.equal(await a.evalJs('window.demo===undefined'),true,'broken reload must not expose a ready application');
  assert.equal(await a.evalJs('sessionStorage.getItem("jsc-migration")'),JSON.stringify({schema:1,count:3}),
    'migration state must survive a failed release-pointer fetch');
  assert.equal(await b.evalJs('demo.version'),'v1','other tab must retain working old release during failure');
  assert.equal(await b.evalJs('navigator.serviceWorker.getRegistration().then(r=>Boolean(r.waiting))'),true,
    'new service worker cannot activate just because a peer reload failed');
  await a.call('Page.enable');
  await a.call('Page.reload',{ignoreCache:true});
  await a.until('window.demo?.version==="v2"');
  assert.equal(await a.evalJs('demo.state.count'),3);
  assert.equal(await a.evalJs('sessionStorage.getItem("jsc-migration")'),null,
    'snapshot cleared only after successful restoration');
  assert.equal(await b.evalJs('demo.version'),'v1','second tab remains pinned until its own migration');
  // Incompatible snapshot is rejected *before* destroying the old page.
  await b.evalJs('demo.dirty(true)');
  await assert.rejects(b.evalJs('demo.migrate()'),/unsaved state/);
  assert.equal(await b.evalJs('demo.version'),'v1');
  await b.evalJs('demo.dirty(false)');
  await b.evalJs('demo.migrate()');await b.until('window.demo?.version==="v2"');
  assert.equal(await b.evalJs('demo.state.count'),5);
  assert.equal(await a.evalJs('demo.version'),'v2');
  assert.equal(await a.evalJs('navigator.serviceWorker.getRegistration().then(r=>Boolean(r.waiting))'),true, 'v2 worker must remain waiting until coordinated activation');
  assert.equal(await a.evalJs('navigator.serviceWorker.getRegistration().then(r=>{r.waiting.postMessage({type:"activate"});return true;})'),true);
  await a.until('navigator.serviceWorker.getRegistration().then(r=>!r.waiting && r.active?.state==="activated")');
  await a.until('navigator.serviceWorker.controller?.state==="activated"');

  assert.equal(halfUploads,1);assert.equal(rejectedPublishes,1);assert.equal(earlyEvictions,1);
  assert.equal(interruptedReloads,1,'exactly one migration reload must receive the injected failure');
  assert.ok(workerRequests>=1);
  console.log('PASS: real Chrome target closure cannot authorize upgrade, missing/dirty peer vetoes, failed reload retains recoverable state, retry restores snapshots (3 and 5), staged deploy and old assets remain coherent, coordinated SW v2 activation');
}finally{
  for(const connection of connections)try{connection.socket.close();}catch{}
  if(chrome){chrome.kill('SIGKILL');await new Promise(done=>{if(chrome.exitCode!==null||chrome.signalCode!==null)done();else chrome.once('close',done);});}
  await new Promise(done=>server.close(done));await rm(dir,{recursive:true,force:true});
}
