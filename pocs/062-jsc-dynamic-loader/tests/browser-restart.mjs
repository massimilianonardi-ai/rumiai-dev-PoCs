// PoC 062: whole Chrome process SIGKILL, same-profile restart, offline SW boot and explicit state recovery.
// This is an application-owned fixture, not a compiler or dynamic-loader interface.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..');
const dir=await mkdtemp(join(tmpdir(),'jsc-browser-restart-'));
const source=join(dir,'v1.js'),manifest=join(dir,'modules.json'),output=join(dir,'bundle.js');
await writeFile(source,'module.exports={version:"v1"};');
await writeFile(manifest,JSON.stringify({version:1,modules:[{id:'app',file:'v1.js',deps:[]}]}));
const built=spawnSync(process.execPath,[join(root,'src/assemble.mjs'),manifest,output],{encoding:'utf8'});
assert.equal(built.status,0,built.stderr);
const bytes=await readFile(output);
const hash=createHash('sha256').update(bytes).digest('hex').slice(0,16);
const release={version:'v1',url:'/assets/v1-'+hash+'.js'};
const page="<!doctype html><meta charset=\"utf-8\"><pre id=\"result\">STARTING</pre>\n<script>\n(async()=>{\n const view=document.getElementById('result');\n try{\n  const releaseResponse=await fetch('/release.json',{cache:'no-store'});\n  if(!releaseResponse.ok)throw Error('release unavailable');\n  const release=await releaseResponse.json();\n  await new Promise((resolve,reject)=>{\n    const script=document.createElement('script');\n    script.src=release.url;\n    script.onload=resolve;script.onerror=()=>reject(Error('bundle unavailable'));\n    document.head.appendChild(script);\n  });\n  const app=JscRuntime.require('app');\n  if(app.version!==release.version)throw Error('mixed release');\n  // IndexedDB transaction completion is a stronger explicit durable-save boundary than a\n  // just-returned localStorage.setItem() for this forced whole-process crash experiment.\n  const db=await new Promise((resolve,reject)=>{\n    const req=indexedDB.open('jsc-restart-durable',1);\n    req.onupgradeneeded=()=>req.result.createObjectStore('snapshots');\n    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);\n  });\n  const read=()=>new Promise((resolve,reject)=>{\n    const request=db.transaction('snapshots','readonly').objectStore('snapshots').get('current');\n    request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);\n  });\n  const write=value=>new Promise((resolve,reject)=>{\n    const tx=db.transaction('snapshots','readwrite',{durability:'strict'});\n    tx.objectStore('snapshots').put(value,'current');\n    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);\n  });\n  const clear=()=>new Promise((resolve,reject)=>{\n    const tx=db.transaction('snapshots','readwrite',{durability:'strict'});\n    tx.objectStore('snapshots').delete('current');\n    tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);\n  });\n  window.recovery={read,write,clear};\n  const snapshot=await read();\n  let count=0;\n  if(snapshot!==null){\n   if(!snapshot||snapshot.schema!==1||!Number.isSafeInteger(snapshot.count)||snapshot.count<0){\n     throw Error('RECOVERY_REQUIRED: incompatible snapshot');\n   }\n   count=snapshot.count;\n  }\n  let transient=0;\n  const boot=crypto.randomUUID();\n  window.demo={\n   version:app.version,boot,source:releaseResponse.headers.get('x-poc-cached-release'),\n   get count(){return count;},get transient(){return transient;},\n   add(n){count+=n;transient+=n;return count;},\n   async save(){const value=count;await write({schema:1,count:value});return value;},\n   stored(){return read();}\n  };\n  view.textContent='READY '+app.version;\n }catch(error){view.textContent='ERROR '+error.message;}\n})();\n</script>";
const worker=[
 "const RELEASE="+JSON.stringify(release)+";",
 "const CACHE='jsc-restart-'+RELEASE.version;",
 "self.addEventListener('install',e=>e.waitUntil((async()=>{",
 " const cache=await caches.open(CACHE);",
 " await cache.addAll(['/', '/release.json',RELEASE.url]);",
 "})()));",
 "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));",
 "self.addEventListener('fetch',e=>{",
 " const url=new URL(e.request.url);",
 " if(e.request.method!=='GET'||url.origin!==self.location.origin)return;",
 " if(!(['/', '/release.json',RELEASE.url].includes(url.pathname))||url.search)return;",
 " e.respondWith((async()=>{",
 "  try{const live=await fetch(e.request,{cache:'no-store'});if(live.ok)return live;}catch{}",
 "  const cache=await caches.open(CACHE);const saved=await cache.match(e.request);",
 "  if(!saved)return Response.error();",
 "  const headers=new Headers(saved.headers);headers.set('X-PoC-Cached-Release',RELEASE.version);",
 "  return new Response(saved.body,{status:saved.status,headers});",
 " })());",
 "});"
].join('\n');
let down=false,failedRequests=0;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://example.invalid');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline';connect-src 'self'");
 if(down){failedRequests++;res.statusCode=503;res.setHeader('Cache-Control','no-store');res.end('backend unavailable');return;}
 if(u.pathname==='/'){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html');res.end(page);
 }else if(u.pathname==='/release.json'){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(release));
 }else if(u.pathname===release.url){
  res.setHeader('Cache-Control','public, max-age=31536000, immutable');
  res.setHeader('Content-Type','application/javascript');res.end(bytes);
 }else if(u.pathname==='/sw.js'){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/javascript');res.end(worker);
 }else{res.statusCode=404;res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const profile=join(dir,'profile');
const origin='http://127.0.0.1:'+server.address().port+'/';
const executable=process.env.CHROMIUM||'/usr/bin/chromium';
let current=null;
async function launch(){
 // The previous process may leave the DevToolsActivePort marker behind after SIGKILL.
 await rm(join(profile,'DevToolsActivePort'),{force:true});
 const child=spawn(executable,[
  '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
  '--user-data-dir='+profile,'--remote-debugging-port=0','--remote-allow-origins=*',origin
 ],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
 let chromeStderr='';child.stderr.on('data',d=>chromeStderr+=d.toString());
 const stop=async()=>{
  try{
   if(process.platform==='win32')child.kill('SIGKILL');
   else process.kill(-child.pid,'SIGKILL');
  }catch(e){if(e.code!=='ESRCH')throw e;}
  await new Promise(done=>{
   if(child.exitCode!==null||child.signalCode!==null)done();
   else child.once('close',done);
  });
 };
 let port=0;
 for(let n=0;n<160;n++){
  try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port>0)break;}catch{}
  if(child.exitCode!==null||child.signalCode!==null)break;
  await delay(100);
 }
 assert.ok(port>0,'Chrome did not expose DevTools port '+chromeStderr.slice(-800));
 let target;
 for(let n=0;n<150;n++){
  const items=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=items.find(x=>x.type==='page'&&x.url.startsWith(origin));
  if(target)break;
  await delay(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome did not open requested application page '+chromeStderr.slice(-800));
 const socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{
  socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});
 });
 const pending=new Map();let id=0;
 socket.addEventListener('message',e=>{
  const msg=JSON.parse(String(e.data)),p=pending.get(msg.id);
  if(!p)return;pending.delete(msg.id);
  if(msg.error)p.reject(Error(JSON.stringify(msg.error)));else p.resolve(msg.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const key=++id;pending.set(key,{resolve,reject});
  socket.send(JSON.stringify({id:key,method,params}));
 });
 await call('Runtime.enable');await call('Page.enable');
 const evaluate=async expr=>{
  const msg=await call('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(msg.exceptionDetails)throw Error('Page script error '+expr+' '+JSON.stringify(msg.exceptionDetails));
  return msg.result.value;
 };
 const until=async(expr,label)=>{
  for(let n=0;n<200;n++){
   try{const result=await evaluate(expr);if(result)return result;}catch{}
   await delay(100);
  }
  const diagnostics=await evaluate('JSON.stringify({url:location.href,html:document.documentElement.outerHTML.slice(0,700),controlled:!!navigator.serviceWorker?.controller})');
  throw Error('Timed out: '+label+'; '+diagnostics);
 };
 return {child,socket,stop,call,evaluate,until};
}
try{
 current=await launch();
 await current.until('window.demo?.version==="v1"','initial online application');
 const firstBoot=await current.evaluate('window.demo.boot');
 assert.equal(await current.evaluate('navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(()=>true)'),true);
 await current.evaluate('navigator.serviceWorker.ready.then(()=>true)');
 await current.until('Boolean(navigator.serviceWorker.controller)','service worker controls initial application');
 assert.equal(await current.evaluate('caches.open("jsc-restart-v1").then(c=>c.match("/release.json")).then(Boolean)'),true);
 assert.equal(await current.evaluate('window.demo.add(7)'),7);
 assert.equal(await current.evaluate('window.demo.save()'),7);
 assert.equal(await current.evaluate('window.demo.add(4)'),11);
 assert.equal(await current.evaluate('window.demo.stored().then(x=>x.count)'),7);
 assert.equal(await current.evaluate('window.demo.transient'),11);
 // The storage transaction has completed; the forced crash must not be a graceful browser shutdown.
 await delay(250);
 await current.stop();current.socket.close();current=null;
 down=true;
 // A fresh whole-browser process, not a tab reload, uses exactly the same on-disk Chrome profile.
 await delay(400);
 current=await launch();
 await current.until('window.demo?.version==="v1"','same-profile offline restart');
 assert.equal(await current.evaluate('window.demo.count'),7,'durable snapshot must restore committed count');
 assert.equal(await current.evaluate('window.demo.transient'),0,'volatile in-memory edits must NOT be invented after crash');
 assert.notEqual(await current.evaluate('window.demo.boot'),firstBoot,'restarted process must run a fresh app instance');
 assert.equal(await current.evaluate('window.demo.source'),'v1','release pointer should use actual Service Worker cached response');
 assert.equal(await current.evaluate('window.demo.stored().then(x=>x.count)'),7);
 assert.ok(failedRequests>=2,'server must refuse actual restart navigation/asset requests');
 // Corrupt/incompatible saved state must never be deleted or silently initialized as a valid empty document.
 await current.evaluate('window.recovery.write({schema:99,count:100}).then(()=>true)');
 await current.evaluate('location.reload()');
 await current.until('document.getElementById("result")?.textContent?.includes("RECOVERY_REQUIRED")','explicit incompatible snapshot error');
 assert.equal(await current.evaluate('typeof window.demo'),'undefined');
 assert.equal(await current.evaluate('window.recovery.read().then(x=>x.schema)'),99);
 // User-authorized destructive recovery is explicit, not an automatic rollback by the loader.
 await current.evaluate('window.recovery.clear()');
 await current.evaluate('location.reload()');
 await current.until('window.demo?.version==="v1"','manual reset reload');
 assert.equal(await current.evaluate('window.demo.count'),0);
 console.log('PASS RESTART: complete Chrome SIGKILL and fresh process same profile, IndexedDB committed=7 vs volatile=11, SW cached offline boot, incompatible snapshot blocked, manual reset required; backend refused '+failedRequests+' requests');
}finally{
 if(current){await current.stop();current.socket.close();}
 await new Promise(done=>server.close(done));
 await rm(dir,{recursive:true,force:true});
}
