// Browser-owned SRI/CORS compared with independent loader.loadScript revision-only checks.
// Full SRI digest is trusted from fixture; application creates script element, no loader API change.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..'),tmp=await mkdtemp(join(tmpdir(),'jsc-cross-sri-'));
const outputs=new Map();
for(const id of ['secure','plain']){
 const src=join(tmp,id+'.js'),manifest=join(tmp,id+'.json'),out=join(tmp,id+'.compiled.js');
 await writeFile(src,'module.exports.value='+JSON.stringify('verified-'+id)+';');
 await writeFile(manifest,JSON.stringify({version:1,modules:[{id,file:id+'.js',deps:[]}]}));
 const p=spawnSync(process.execPath,[join(root,'src/jsc.mjs'),manifest,out],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 outputs.set(id,await readFile(out));
}
const secure=outputs.get('secure'),plain=outputs.get('plain');
const sri='sha256-'+createHash('sha256').update(secure).digest('base64');
assert.match(sri,/^sha256-[A-Za-z0-9+/]{43}=$/);
const tampered=Buffer.concat([Buffer.from('globalThis.badExecuted=(globalThis.badExecuted||0)+1;'),secure]);
const revisionOnly=Buffer.concat([Buffer.from('globalThis.plainExecuted=(globalThis.plainExecuted||0)+1;'),plain]);
let noCorsGets=0,corruptGets=0,goodGets=0,plainGets=0;
const start=handler=>new Promise(ok=>{const s=http.createServer(handler);s.listen(0,'127.0.0.1',()=>ok(s));});
const cdn=await start((req,res)=>{
 const path=new URL(req.url,'http://cdn.invalid').pathname;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/javascript');
 if(path==='/no-cors.js'){noCorsGets++;res.end(secure);}
 else if(path==='/corrupt.js'){corruptGets++;res.setHeader('Access-Control-Allow-Origin','*');res.end(tampered);}
 else if(path==='/valid.js'){goodGets++;res.setHeader('Access-Control-Allow-Origin','*');res.end(secure);}
 else if(path==='/plain.js'){plainGets++;res.setHeader('Access-Control-Allow-Origin','*');res.end(revisionOnly);}
 else{res.statusCode=404;res.end('missing');}
});
const cdnOrigin='http://127.0.0.1:'+cdn.address().port;
const loader=await readFile(join(root,'src/loader.js'));
const page="<!doctype html><meta charset=\"utf-8\"><script src=\"/loader.js\"></script><pre id=\"status\">LOADING</pre><script>\nwindow.demo={\n async verified(url,integrity,expected){\n   const before=JscRuntime.revision(expected);\n   try{await new Promise((resolve,reject)=>{\n     const node=document.createElement('script');\n     node.crossOrigin='anonymous';node.integrity=integrity;node.src=url;\n     node.onload=()=>{node.remove();resolve();};\n     node.onerror=()=>{node.remove();reject(Error('script-refused'));};\n     document.head.append(node);\n   });}\n   catch(error){if(JscRuntime.revision(expected)!==before)throw Error('refused script changed expected revision');return {ok:false,reason:'script-refused'};}\n   if(JscRuntime.revision(expected)!==before+1)return {ok:false,reason:'expected-revision-missing'};\n   return {ok:true};\n },\n get secureRevision(){return JscRuntime.revision('secure');},\n get secureValue(){return JscRuntime.revision('secure')?JscRuntime.require('secure').value:null;}\n};\ndocument.getElementById('status').textContent='READY';\n</script>";
const app=await start((req,res)=>{
 const path=new URL(req.url,'http://app.invalid').pathname;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline' "+cdnOrigin+";connect-src 'self'");
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(page);}
 else if(path==='/loader.js'){res.setHeader('Content-Type','application/javascript');res.end(loader);}
 else{res.statusCode=404;res.end('missing');}
});
const origin='http://127.0.0.1:'+app.address().port+'/',sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
let chrome,socket;
try{
 const profile=join(tmp,'profile');
 chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',[
  '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
  '--user-data-dir='+profile,'--remote-debugging-port=0','--remote-allow-origins=*',origin
 ],{stdio:['ignore','pipe','pipe']});
 let stderr='';chrome.stderr.on('data',d=>stderr+=d.toString());
 let port=0;
 for(let i=0;i<150;i++){
  try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
  await sleep(100);
 }
 assert.ok(port>0,'Chrome CDP port unavailable '+stderr.slice(-600));
 let target;
 for(let i=0;i<140;i++){
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=pages.find(p=>p.type==='page'&&p.url.startsWith(origin));
  if(target)break;await sleep(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome page target missing');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
 let seq=0;const waiting=new Map();
 socket.addEventListener('message',event=>{
  const data=JSON.parse(String(event.data)),p=waiting.get(data.id);
  if(!p)return;waiting.delete(data.id);
  if(data.error)p.reject(Error(JSON.stringify(data.error)));else p.resolve(data.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error('Chrome JS failure '+JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 await call('Runtime.enable');await call('Page.enable');
 let ready=false;
 for(let i=0;i<100;i++){
  try{if(await evaluate('document.getElementById("status")?.textContent==="READY"')){ready=true;break;}}catch{}
  await sleep(100);
 }
 assert.ok(ready,'App page did not initialize');
 const verified=async name=>evaluate('demo.verified('+JSON.stringify(cdnOrigin+'/'+name+'.js')+','+JSON.stringify(sri)+',"secure")');
 assert.deepEqual(await verified('no-cors'),{ok:false,reason:'script-refused'},
  'browser must require CORS for cross-origin SRI');
 assert.equal(await evaluate('demo.secureRevision'),0);
 assert.deepEqual(await verified('corrupt'),{ok:false,reason:'script-refused'},
  'CORS alone does not bypass SRI mismatched SHA-256');
 assert.equal(await evaluate('window.badExecuted||0'),0,'altered code must not execute');
 assert.equal(await evaluate('demo.secureRevision'),0);
 assert.deepEqual(await verified('valid'),{ok:true});
 assert.equal(await evaluate('demo.secureRevision'),1);
 assert.equal(await evaluate('demo.secureValue'),'verified-secure');
 // Deliberate negative control: expected revision is not an integrity guarantee.
 await evaluate('JscRuntime.loadScript('+JSON.stringify(cdnOrigin+'/plain.js')+',{expect:"plain"}).then(()=>true)');
 assert.equal(await evaluate('JscRuntime.revision("plain")'),1);
 assert.equal(await evaluate('window.plainExecuted||0'),1);
 assert.deepEqual({noCorsGets,corruptGets,goodGets,plainGets},{noCorsGets:1,corruptGets:1,goodGets:1,plainGets:1});
 console.log('PASS CROSS ORIGIN SRI: no CORS => blocked, CORS+tamper => blocked before evaluation, CORS+full-SHA256 => loaded, revision-only loader intentionally executes altered-but-registering script; '+JSON.stringify({noCorsGets,corruptGets,goodGets,plainGets}));
}finally{
 socket?.close();
 if(chrome){chrome.kill('SIGKILL');await new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)ok();else chrome.once('close',ok);});}
 await Promise.all([app,cdn].map(s=>new Promise(ok=>s.close(ok))));
 await rm(tmp,{recursive:true,force:true});
}
