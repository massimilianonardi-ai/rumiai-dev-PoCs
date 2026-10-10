// Browser application fixture: full trusted SHA-256 SRI gates execution of a classic compiled
// patch; an active Worker/MessagePort/fetch session vetoes HMR and requests an explicit full reload.
// No public jsc/loader APIs are changed, and trust in the supplied SRI hash remains an assumption.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'jsc-sri-'));
const outputs=new Map();
for(const version of ['v1','v2']){
 const manifest=join(dir,version+'.json'),out=join(dir,version+'.compiled.js');
 await writeFile(join(dir,version+'.js'),'module.exports={version:'+JSON.stringify(version)+'};');
 await writeFile(manifest,JSON.stringify({version:1,modules:[{id:'app',file:version+'.js',deps:[]}]}));
 const result=spawnSync(process.execPath,[join(root,'src/jsc.mjs'),manifest,out],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 outputs.set(version,await readFile(out));
}
const v1=outputs.get('v1'),v2=outputs.get('v2');
const sri='sha256-'+createHash('sha256').update(v2).digest('base64');
const tampered=Buffer.concat([Buffer.from('globalThis.unverifiedRan=(globalThis.unverifiedRan||0)+1;'),v2]);
assert.notEqual(createHash('sha256').update(tampered).digest('base64'),sri.slice(7));
const loader=await readFile(join(root,'src/loader.js'));
const page="<!doctype html><meta charset=\"utf-8\"><script src=\"/loader.js\"></script><script src=\"/v1.js\"></script><pre id=\"status\">STARTING</pre>\n<script>\n(async()=>{\ntry{\n const app=JscRuntime.require('app');if(app.version!=='v1')throw Error('invalid initial app');\n const raw=sessionStorage.getItem('saved');const snapshot=raw?JSON.parse(raw):{schema:1,count:0};\n if(snapshot.schema!==1||!Number.isSafeInteger(snapshot.count))throw Error('RECOVERY_REQUIRED');\n let count=snapshot.count,session=null;\n const metrics={opened:0,disposed:0,aborted:0},sessionId=crypto.randomUUID();\n window.demo={\n   sessionId,get count(){return count;},get version(){return JscRuntime.require('app').version;},\n   get revision(){return JscRuntime.revision('app');},get connected(){return !!session?.connected;},\n   add(n){count+=n;return count;},\n   async patch(url,integrity){\n    const oldRevision=JscRuntime.revision('app'),old=JscRuntime.require('app');\n    try{\n      await new Promise((ok,fail)=>{\n       const script=document.createElement('script');script.src=url;script.integrity=integrity;\n       script.onload=()=>{script.remove();ok();};\n       script.onerror=()=>{script.remove();fail(Error('integrity-or-load-failure'));};\n       document.head.appendChild(script);\n      });\n    }catch(error){\n     if(JscRuntime.revision('app')!==oldRevision||JscRuntime.require('app')!==old)throw Error('blocked integrity modified state');\n     return {ok:false,reason:error.message};\n    }\n    if(JscRuntime.revision('app')!==oldRevision+1)throw Error('verified script failed to update revision');\n    return {ok:true,version:JscRuntime.require('app').version};\n   },\n   openSession(){\n    JscRuntime.install('connection',[],(_r,module)=>{\n     const channel=new MessageChannel(),worker=new Worker('/worker.js'),controller=new AbortController();\n     const interval=setInterval(()=>{},20);\n     metrics.opened++;\n     fetch('/pending',{signal:controller.signal}).catch(()=>{});\n     module.exports={port:channel.port1,worker,connected:true};\n     module.onDispose(()=>{\n      metrics.disposed++;clearInterval(interval);controller.abort();\n      channel.port1.close();channel.port2.close();worker.terminate();\n      if(controller.signal.aborted)metrics.aborted++;\n      module.exports.connected=false;\n     });\n    });\n    session=JscRuntime.require('connection');\n    return session.connected&&!!session.port&&!!session.worker;\n   },\n   rejectIncompatible(){\n     const rev=JscRuntime.revision('connection'),old=JscRuntime.require('connection');\n     // The MessagePort and live Worker session are not a JSON snapshot.\n     const ready=!(session&&session.connected);\n     if(ready)throw Error('unsafe accept');\n     if(JscRuntime.revision('connection')!==rev||JscRuntime.require('connection')!==old)throw Error('veto altered session');\n     return 'full-reload-required';\n   },\n   prepareReload(){\n     sessionStorage.setItem('saved',JSON.stringify({schema:1,count}));\n     sessionStorage.setItem('priorId',sessionId);\n     JscRuntime.invalidate('connection');session=null;\n     const cleanup={disposed:metrics.disposed,aborted:metrics.aborted};\n     sessionStorage.setItem('cleanup',JSON.stringify(cleanup));\n     return cleanup;\n   },\n   previous(){return {id:sessionStorage.getItem('priorId'),cleanup:JSON.parse(sessionStorage.getItem('cleanup')||'null')};}\n };\n document.getElementById('status').textContent='READY';\n}catch(e){document.getElementById('status').textContent='ERROR '+e.stack;}\n})();\n</script>";
let validGets=0,badGets=0,workerGets=0,pendingStarted=0,pendingAborted=0;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://local.invalid'),path=url.pathname;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline';worker-src 'self';connect-src 'self'");
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(page);}
 else if(path==='/loader.js'){res.setHeader('Content-Type','text/javascript');res.end(loader);}
 else if(path==='/v1.js'){res.setHeader('Content-Type','text/javascript');res.end(v1);}
 else if(path==='/valid-v2.js'){validGets++;res.setHeader('Content-Type','text/javascript');res.end(v2);}
 else if(path==='/altered-v2.js'){badGets++;res.setHeader('Content-Type','text/javascript');res.end(tampered);}
 else if(path==='/worker.js'){workerGets++;res.setHeader('Content-Type','text/javascript');res.end('onmessage=e=>postMessage(e.data);');}
 else if(path==='/pending'){
  pendingStarted++;
  const timer=setTimeout(()=>{if(!res.writableEnded)res.end('late');},1500);
  req.on('aborted',()=>{pendingAborted++;clearTimeout(timer);});
  res.on('close',()=>clearTimeout(timer));
 }else{res.statusCode=404;res.end('missing');}
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
 let stderr='';chrome.stderr.on('data',chunk=>stderr+=chunk.toString());
 let port=0;
 for(let i=0;i<150;i++){
  try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
  await delay(100);
 }
 assert.ok(port>0,'Chrome DevTools unavailable '+stderr.slice(-700));
 let target;
 for(let i=0;i<150;i++){
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=pages.find(x=>x.type==='page'&&x.url.startsWith(url));
  if(target)break;await delay(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome target unavailable');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let seq=0;const waiting=new Map();
 socket.addEventListener('message',event=>{
  const value=JSON.parse(String(event.data)),w=waiting.get(value.id);
  if(!w)return;waiting.delete(value.id);
  if(value.error)w.reject(Error(JSON.stringify(value.error)));else w.resolve(value.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const x=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(x.exceptionDetails)throw Error(expression+': '+JSON.stringify(x.exceptionDetails));
  return x.result.value;
 };
 const until=async(expression,label)=>{
  for(let i=0;i<180;i++){
   try{if(await evaluate(expression))return;}catch{}
   await delay(100);
  }
  throw Error('Timeout '+label+': '+await evaluate('document.getElementById("status")?.textContent'));
 };
 await call('Runtime.enable');await call('Page.enable');
 await until('window.demo?.version==="v1"','v1');
 const initialId=await evaluate('demo.sessionId');
 assert.match(sri,/^sha256-[A-Za-z0-9+/]{43}=$/,'full 256-bit SHA-256 base64 SRI required');
 const bad=await evaluate('demo.patch("/altered-v2.js",'+JSON.stringify(sri)+')');
 assert.deepEqual(bad,{ok:false,reason:'integrity-or-load-failure'});
 assert.equal(await evaluate('window.unverifiedRan||0'),0,'altered code must never execute');
 assert.equal(await evaluate('demo.version'),'v1');
 assert.equal(await evaluate('demo.revision'),1);
 const valid=await evaluate('demo.patch("/valid-v2.js",'+JSON.stringify(sri)+')');
 assert.deepEqual(valid,{ok:true,version:'v2'});
 assert.equal(await evaluate('demo.revision'),2);
 assert.equal(await evaluate('demo.openSession()'),true);
 assert.equal(await evaluate('demo.add(7)'),7);
 assert.equal(await evaluate('demo.rejectIncompatible()'),'full-reload-required');
 assert.equal(await evaluate('demo.connected'),true,'veto must preserve working external session');
 assert.equal(await evaluate('demo.revision'),2);
 await until('demo.connected===true','live external session');
 const cleanup=await evaluate('demo.prepareReload()');
 assert.deepEqual(cleanup,{disposed:1,aborted:1});
 await call('Page.reload',{ignoreCache:true});
 await until('window.demo?.sessionId!=='+JSON.stringify(initialId)+'&&window.demo?.version==="v1"','fresh document');
 assert.equal(await evaluate('demo.count'),7,'committed JSON count must recover');
 assert.equal(await evaluate('demo.connected'),false,'Worker/MessagePort session must not be invented');
 assert.deepEqual(await evaluate('demo.previous()'),{id:initialId,cleanup});
 assert.equal(await evaluate('JscRuntime.state().registered'),1,'external resource module not registered on new page');
 assert.equal(validGets,1);assert.equal(badGets,1);
 assert.ok(workerGets>=1,'actual worker request expected');
 assert.ok(pendingStarted>=1,'real active fetch expected');
 console.log('PASS CHROME SRI: full SHA-256 blocked altered code before execution, verified v2 script installed, nonserializable external session required explicit reload, saved count=7 recovered; '+JSON.stringify({badGets,validGets,workerGets,pendingStarted,pendingAborted}));
}finally{
 socket?.close();
 if(chrome){chrome.kill('SIGKILL');await new Promise(resolve=>{if(chrome.exitCode!==null||chrome.signalCode!==null)resolve();else chrome.once('close',resolve);});}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await rm(dir,{recursive:true,force:true});
}
