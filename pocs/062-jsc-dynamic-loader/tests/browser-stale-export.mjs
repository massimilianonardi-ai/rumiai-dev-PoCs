// PoC 062: same-browser classic module stale exported closures and application-owned
// migration snapshot fail-closed behavior, with explicit full page reload boundary.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'jsc-stale-export-'));
const loader=await readFile(join(root,'src/loader.js'));
const page="<!doctype html><meta charset=\"utf-8\"><script src=\"/loader.js\"></script><pre id=\"status\">LOADING</pre><script>\n(async()=>{\n const view=document.getElementById('status');\n try{\n  const raw=sessionStorage.getItem('pending-migration');\n  let count=0,fromLegacy=false;\n  if(raw!==null){\n   let snapshot;\n   try{snapshot=JSON.parse(raw);}catch{throw Error('RECOVERY_REQUIRED: invalid JSON');}\n   if(!snapshot||snapshot.schema!==1||!Number.isSafeInteger(snapshot.count)||snapshot.count<0)\n    throw Error('RECOVERY_REQUIRED: unsupported snapshot');\n   count=snapshot.count;fromLegacy=true;\n  }\n  const runtime=JscRuntime,appId=crypto.randomUUID();\n  runtime.install('unguarded',[],(_require,module)=>{\n   module.exports.reader=()=>({tag:'old-unguarded',count});\n  });\n  runtime.install('guarded',[],(_require,module)=>{\n   let valid=true;\n   module.exports.reader=()=>{if(!valid)throw Error('revoked-export');return 'old-guarded';};\n   module.onDispose(()=>{valid=false;});\n  });\n  let staleLegacy=null,staleGuard=null;\n  const demo={\n   appId,get count(){return count;},get fromLegacy(){return fromLegacy;},\n   add(n){count+=n;return count;},\n   holdReferences(){\n    staleLegacy=runtime.require('unguarded').reader;\n    staleGuard=runtime.require('guarded').reader;\n    return staleLegacy().tag==='old-unguarded'&&staleGuard()==='old-guarded';\n   },\n   proposeHotUpgrade(){\n    return staleLegacy||staleGuard?\n      {ready:false,reason:'external-references-require-reload'}:\n      {ready:true};\n   },\n   deliberatelyBypassVeto(){\n    const before={unguarded:runtime.revision('unguarded'),guarded:runtime.revision('guarded')};\n    runtime.installBatch([\n     {id:'unguarded',deps:[],factory:(_r,module)=>{module.exports.reader=()=>({tag:'new',count});}},\n     {id:'guarded',deps:[],factory:(_r,module)=>{module.exports.reader=()=> 'new-guarded';}}\n    ],{expectedRevisions:before});\n    let revoked=false;\n    try{staleGuard();}catch(e){revoked=e.message==='revoked-export';}\n    return {oldStillCallable:staleLegacy().tag==='old-unguarded',\n     staleGuardRevoked:revoked,\n     newTag:runtime.require('unguarded').reader().tag,\n     newGuard:runtime.require('guarded').reader()};\n   },\n   stageLegacy(){const value=JSON.stringify({schema:1,count});sessionStorage.setItem('pending-migration',value);return value;},\n   stageBad(){sessionStorage.setItem('pending-migration',JSON.stringify({schema:99,count:888}));return true;},\n   stored(){return sessionStorage.getItem('pending-migration');}\n  };\n  // Only consume a verified snapshot after the new app is fully initialized.\n  window.demo=demo;\n  if(fromLegacy)sessionStorage.removeItem('pending-migration');\n  view.textContent='READY';\n }catch(error){view.textContent='ERROR '+error.message;}\n})();\n</script>";
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline'");
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(page);return;}
 if(req.url==='/loader.js'){res.setHeader('Content-Type','application/javascript');res.end(loader);return;}
 res.statusCode=404;res.end('not found');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/',delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let chrome,socket;
try{
 const profile=join(dir,'profile');
 chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',[
  '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
  '--user-data-dir='+profile,'--remote-debugging-port=0','--remote-allow-origins=*',url
 ],{stdio:['ignore','pipe','pipe']});
 let stderr='';chrome.stderr.on('data',d=>stderr+=d.toString());
 let port=0;
 for(let i=0;i<160;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await delay(100);}
 assert.ok(port>0,'Chrome CDP unavailable: '+stderr.slice(-800));
 let target;
 for(let i=0;i<140;i++){
  const items=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=items.find(x=>x.type==='page'&&x.url.startsWith(url));if(target)break;await delay(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome app target missing');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
 let serial=0;const pending=new Map();
 socket.addEventListener('message',e=>{
  const msg=JSON.parse(String(e.data)),p=pending.get(msg.id);
  if(!p)return;pending.delete(msg.id);
  if(msg.error)p.fail(Error(JSON.stringify(msg.error)));else p.ok(msg.result);
 });
 const call=(method,params={})=>new Promise((ok,fail)=>{
  const id=++serial;pending.set(id,{ok,fail});socket.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error('Chrome JS error: '+JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 const until=async(expression,label)=>{
  for(let i=0;i<200;i++){
   try{if(await evaluate(expression))return;}catch{}
   await delay(100);
  }
  throw Error('timeout '+label+': '+await evaluate('document.getElementById("status")?.textContent'));
 };
 await call('Runtime.enable');await call('Page.enable');
 await until('window.demo?.count===0','initial app');
 const first=await evaluate('demo.appId');
 assert.equal(await evaluate('demo.add(7)'),7);
 assert.equal(await evaluate('demo.holdReferences()'),true);
 assert.deepEqual(await evaluate('demo.proposeHotUpgrade()'),{ready:false,reason:'external-references-require-reload'});
 // Intentionally bypass the application veto to demonstrate what the loader cannot revoke.
 assert.deepEqual(await evaluate('demo.deliberatelyBypassVeto()'),{
  oldStillCallable:true,staleGuardRevoked:true,newTag:'new',newGuard:'new-guarded'
 });
 assert.equal(await evaluate('demo.count'),7);
 const snapshot=await evaluate('demo.stageLegacy()');
 assert.equal(snapshot,JSON.stringify({schema:1,count:7}));
 await call('Page.reload',{ignoreCache:true});
 await until('window.demo?.appId!=='+JSON.stringify(first)+'&&window.demo?.fromLegacy===true','migration reload');
 assert.equal(await evaluate('demo.count'),7);
 assert.equal(await evaluate('demo.stored()'),null,'consumed snapshot after success only');
 const next=await evaluate('demo.appId');
 await evaluate('demo.stageBad()');
 await call('Page.reload',{ignoreCache:true});
 await until('document.getElementById("status")?.textContent?.includes("RECOVERY_REQUIRED")','incompatible migration refused');
 assert.equal(await evaluate('typeof window.demo'),'undefined');
 const preserved=await evaluate('sessionStorage.getItem("pending-migration")');
 assert.equal(preserved,JSON.stringify({schema:99,count:888}));
 // A separate explicit manual action is required; silent corruption/forgetting is forbidden.
 await evaluate('sessionStorage.removeItem("pending-migration")');
 await call('Page.reload',{ignoreCache:true});
 await until('window.demo?.appId!=='+JSON.stringify(next)+'&&window.demo?.count===0','manual clear');
 assert.equal(await evaluate('demo.fromLegacy'),false);
 console.log('PASS STALE EXPORT: live unguarded closure survives registry replacement, guarded closure revokes, app vetoes HMR, explicit full reload migrates schema1 count7, schema99 blocks without deleting snapshot, manual recovery succeeds');
}finally{
 socket?.close();
 if(chrome){chrome.kill('SIGKILL');await new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)ok();else chrome.once('close',ok);});}
 await new Promise(ok=>server.close(ok));
 await rm(dir,{recursive:true,force:true});
}
