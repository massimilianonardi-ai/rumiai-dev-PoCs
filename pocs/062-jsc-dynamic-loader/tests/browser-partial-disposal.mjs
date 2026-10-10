// Experimental Chrome proof of partial cleanup failure and externally recorded effects.
// A failed onDispose cannot undo already acknowledged HTTP effects; app must reconcile
// with external server before accepting a fresh reload. This is NOT a disk durability test.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'jsc-disposal-failure-'));
const loader=await readFile(join(root,'src/loader.js'));
const page="<!doctype html><meta charset=\"utf-8\"><script src=\"/loader.js\"></script>\n<pre id=\"status\">BOOTING</pre><script>\n(async()=>{\n const element=document.getElementById('status');\n const phase=__PHASE__;\n let pending;\n try{\n  const raw=sessionStorage.getItem('pending-recovery');\n  pending=raw===null?null:JSON.parse(raw);\n  if(pending && (pending.schema!==1||!Number.isSafeInteger(pending.count)||typeof pending.operationId!=='string'))\n   throw Error('RECOVERY_REQUIRED: incompatible pending snapshot');\n }catch(e){element.textContent='RECOVERY_REQUIRED: invalid snapshot';return;}\n const snapshotRaw=sessionStorage.getItem('safe-count');\n let count=snapshotRaw===null?0:JSON.parse(snapshotRaw).count;\n const sessionId=crypto.randomUUID();\n if(pending){\n  // A full reload is deliberately NOT allowed to claim success without external reconciliation.\n  window.demo={\n   sessionId,ready:false,get count(){return pending.count;},get pending(){return sessionStorage.getItem('pending-recovery');},\n   async reconcile(){\n    try{\n     const response=await fetch('/ledger?id='+encodeURIComponent(pending.operationId),{cache:'no-store'});\n     if(!response.ok)return 'ledger-unavailable';\n     const body=await response.json();\n     if(body.applied!==1)return 'ledger-inconsistent';\n     sessionStorage.setItem('safe-count',JSON.stringify({schema:1,count:pending.count}));\n     sessionStorage.removeItem('pending-recovery');\n     location.reload();\n     return 'reload-initiated';\n    }catch{return 'ledger-unavailable';}\n   }\n  };\n  element.textContent='RECOVERY_REQUIRED';\n  return;\n }\n const metrics={deviceDisposals:0,displayDisposals:0,staleEvents:0};\n function initial(id){\n  if(id==='device')return {id,deps:[],factory(_r,module){\n   const listener=()=>metrics.staleEvents++;\n   window.addEventListener('stale-device-event',listener);\n   module.exports={version:phase,emit(){window.dispatchEvent(new Event('stale-device-event'));}};\n   module.onDispose(()=>{\n    metrics.deviceDisposals++;\n    // Real leak of the registered browser listener: an externally owned device refuses\n    // closure. Simulate it by throwing BEFORE removeEventListener.\n    throw Error('external-device-disconnect-failed');\n   });\n  }};\n  return {id,deps:[],factory(_r,module){\n   const node=document.createElement('span');node.id='legacy-display';node.textContent='running';\n   document.body.append(node);\n   module.exports={version:phase};\n   module.onDispose(()=>{metrics.displayDisposals++;node.remove();});\n  }};\n }\n JscRuntime.installBatch([initial('device'),initial('display')]);\n JscRuntime.require('device');JscRuntime.require('display');\n let effectId=null;\n window.demo={\n  sessionId,ready:true,phase,get count(){return count;},get metrics(){return {...metrics};},\n  get revisions(){return {device:JscRuntime.revision('device'),display:JscRuntime.revision('display')};},\n  get state(){return JscRuntime.state();},get pending(){return sessionStorage.getItem('pending-recovery');},\n  async issueEffect(id){\n   const response=await fetch('/effect',{method:'POST',headers:{'Content-Type':'application/json'},\n    body:JSON.stringify({operationId:id})});\n   if(!response.ok)throw Error('external effect not acknowledged');\n   const body=await response.json();\n   if(body.applied!==1)throw Error('effect receipt mismatched');\n   effectId=id;\n   count+=7;\n   sessionStorage.setItem('safe-count',JSON.stringify({schema:1,count}));\n   return body.applied;\n  },\n  preflightBad(){\n   let failed=false;\n   try{JscRuntime.installBatch([{id:'device',deps:['missing'],factory(){}}]);}\n   catch(e){failed=String(e).includes('unavailable dependency');}\n   return {failed,metrics:{...metrics},state:JscRuntime.state(),revisions:this.revisions};\n  },\n  unsafeReplace(){\n   if(!effectId)throw Error('missing external receipt');\n   // Stage the recovery intent BEFORE touching any old resources or definitions.\n   sessionStorage.setItem('pending-recovery',\n    JSON.stringify({schema:1,count,operationId:effectId,reason:'disposal-not-guaranteed'}));\n   const expectedRevisions=this.revisions;\n   let error=null,failures=0;\n   try{JscRuntime.installBatch([\n    {id:'device',deps:[],factory(_r,module){module.exports.version='v2';}},\n    {id:'display',deps:[],factory(_r,module){module.exports.version='v2';}}\n   ],{expectedRevisions});}\n   catch(e){error=e.message;failures=e.errors?.length??0;}\n   this.ready=false;\n   element.textContent='RECOVERY_REQUIRED';\n   window.dispatchEvent(new Event('stale-device-event'));\n   return {error,failures,metrics:{...metrics},state:JscRuntime.state(),\n    revisions:this.revisions,displayPresent:!!document.getElementById('legacy-display')};\n  }\n };\n element.textContent='READY '+phase;\n})();\n</script>";
const ledger=new Map();
let phase='v1',ledgerAvailable=true,effectPosts=0;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local.invalid'),p=url.pathname;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline';connect-src 'self'");
 if(p==='/'){res.setHeader('Content-Type','text/html');res.end(page.replace('__PHASE__',JSON.stringify(phase)));return;}
 if(p==='/loader.js'){res.setHeader('Content-Type','text/javascript');res.end(loader);return;}
 if(p==='/effect'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk.toString();
  const {operationId}=JSON.parse(body);if(typeof operationId!=='string'||!operationId){res.statusCode=400;res.end();return;}
  effectPosts++;
  ledger.set(operationId,(ledger.get(operationId)||0)+1);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({applied:ledger.get(operationId)}));return;
 }
 if(p==='/ledger'){
  if(!ledgerAvailable){res.statusCode=503;res.end('external ledger offline');return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({applied:ledger.get(url.searchParams.get('id'))||0}));return;
 }
 res.statusCode=404;res.end('not found');
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const url='http://127.0.0.1:'+server.address().port+'/',delay=ms=>new Promise(ok=>setTimeout(ok,ms));
let chrome,socket;
try{
 const profile=join(dir,'profile');
 chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',[
  '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
  '--user-data-dir='+profile,'--remote-debugging-port=0','--remote-allow-origins=*',url
 ],{stdio:['ignore','pipe','pipe']});
 let stderr='';chrome.stderr.on('data',d=>stderr+=d.toString());
 let port=0;
 for(let i=0;i<150;i++){
  try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
  await delay(100);
 }
 assert.ok(port>0,'Chrome DevTools port missing '+stderr.slice(-700));
 let target;
 for(let i=0;i<140;i++){
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=pages.find(x=>x.type==='page'&&x.url.startsWith(url));
  if(target)break;await delay(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome app tab missing');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
 let seq=0;const pending=new Map();
 socket.addEventListener('message',event=>{
  const r=JSON.parse(String(event.data)),p=pending.get(r.id);
  if(!p)return;pending.delete(r.id);
  if(r.error)p.fail(Error(JSON.stringify(r.error)));else p.ok(r.result);
 });
 const call=(method,params={})=>new Promise((ok,fail)=>{
  const id=++seq;pending.set(id,{ok,fail});socket.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error('Chrome expression failed '+expression+': '+JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 const until=async(expression,label)=>{
  for(let i=0;i<160;i++){
   try{if(await evaluate(expression))return;}catch{}
   await delay(100);
  }
  throw Error('Timeout '+label+': '+await evaluate('document.getElementById("status")?.textContent'));
 };
 await call('Runtime.enable');await call('Page.enable');
 await until('window.demo?.ready===true&&window.demo.phase==="v1"','initial v1');
 const firstId=await evaluate('demo.sessionId');
 const op='external-commit-001';
 assert.equal(await evaluate('demo.issueEffect('+JSON.stringify(op)+')'),1);
 assert.equal(ledger.get(op),1);
 assert.equal(effectPosts,1);
 assert.equal(await evaluate('demo.count'),7,'confirmed effect must update the real app count');
 const preflight=await evaluate('demo.preflightBad()');
 assert.equal(preflight.failed,true);
 assert.deepEqual(preflight.metrics,{deviceDisposals:0,displayDisposals:0,staleEvents:0});
 assert.deepEqual(preflight.revisions,{device:1,display:1});
 assert.deepEqual(preflight.state,{registered:2,active:2,names:['device','display']});
 assert.equal(await evaluate('demo.pending'),null,'failed preflight should not create recovery state');
 // This is an intentionally unsafe update: external resource denial and failed disposal.
 const partial=await evaluate('demo.unsafeReplace()');
 assert.match(partial.error,/batch definitions committed/);
 assert.equal(partial.failures,1,'single onDispose callback expected to fail');
 assert.deepEqual(partial.metrics,{deviceDisposals:1,displayDisposals:1,staleEvents:1});
 assert.deepEqual(partial.revisions,{device:2,display:2},'new module definitions were committed even on cleanup error');
 assert.deepEqual(partial.state,{registered:2,active:0,names:[]});
 assert.equal(partial.displayPresent,false,'other callback did dispose its resource');
 assert.equal(await evaluate('demo.ready'),false,'unsafe update must not be reported as successful');
 const pendingRaw=await evaluate('demo.pending');
 assert.deepEqual(JSON.parse(pendingRaw),{schema:1,count:7,operationId:op,reason:'disposal-not-guaranteed'});
 assert.equal(ledger.get(op),1,'external effect did not roll back');
 // A browser reload loses the uncleaned listener, but the independent HTTP ledger survives.
 phase='v2';ledgerAvailable=false;
 await call('Page.reload',{ignoreCache:true});
 await until('document.getElementById("status")?.textContent==="RECOVERY_REQUIRED"','pending recovery after reload');
 assert.equal(await evaluate('demo.ready'),false);
 assert.equal(await evaluate('demo.count'),7);
 assert.equal(await evaluate('demo.reconcile()'),'ledger-unavailable');
 assert.equal(await evaluate('demo.pending'),pendingRaw,'failed recovery MUST retain snapshot');
 assert.equal(ledger.get(op),1,'recovery cannot erase/replay external action');
 ledgerAvailable=true;
 assert.equal(await evaluate('demo.reconcile()'),'reload-initiated');
 await until('window.demo?.sessionId!=='+JSON.stringify(firstId)+'&&demo.ready===true&&demo.phase==="v2"','explicit reconciliation boot');
 assert.equal(await evaluate('demo.pending'),null,'only verified recovery may clear pending intent');
 assert.equal(await evaluate('demo.count'),7);
 assert.equal(await evaluate('demo.metrics.staleEvents'),0,'leaked listener cannot survive document reload');
 assert.equal(effectPosts,1,'reloaded app must not replay the externally recorded effect');
 assert.equal(ledger.get(op),1);
 console.log('PASS PARTIAL DISPOSAL: preflight atomic rejection, cleanup AggregateError after partial effects and committed revisions, leaked listener in old realm, independent HTTP effect persisted through reload, offline ledger blocked and preserved pending state, explicit verified reconcile recovered once');
}finally{
 socket?.close();
 if(chrome){chrome.kill('SIGKILL');await new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)ok();else chrome.once('close',ok);});}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));
 await rm(dir,{recursive:true,force:true});
}
