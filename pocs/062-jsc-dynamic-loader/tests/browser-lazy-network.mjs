// Compare network-lazy compiled classic module loading to optional one-file packaging in real Chrome.
// Both paths use the same independent loader; jsc itself never performs network dynamic loading.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..');
const dir=await mkdtemp(join(tmpdir(),'jsc-network-lazy-'));
const modules=[['entry','entry'],['optional','optional']];
for(const [id,value] of modules)await writeFile(join(dir,id+'.js'),'module.exports.value='+JSON.stringify(value)+';');
const run=(compiler,ids,destination)=>{
  const manifest=join(dir,destination+'.json'),output=join(dir,destination+'.js');
  return {manifest,output,ids,compiler};
};
const results={};
for(const config of [run('jsc.mjs',['entry'],'entry'),run('jsc.mjs',['optional'],'optional'),run('assemble.mjs',['entry','optional'],'combined')]){
 await writeFile(config.manifest,JSON.stringify({version:1,modules:config.ids.map(id=>({id,file:id+'.js',deps:[]}))}));
 const compiled=spawnSync(process.execPath,[join(root,'src',config.compiler),config.manifest,config.output],{encoding:'utf8'});
 assert.equal(compiled.status,0,compiled.stderr);
 results[config.ids.join('+')]=await readFile(config.output);
}
const loader=await readFile(join(root,'src/loader.js'));
const compiledEntry=results.entry,compiledOptional=results.optional,combined=results['entry+optional'];
assert.ok(!compiledEntry.includes(Buffer.from('const definitions = new Map()')),'compiler output should not embed loader');
assert.ok(combined.includes(loader),'packaging must embed the unchanged independent loader');
const lazyPage="<!doctype html><meta charset=\"utf-8\"><script src=\"/loader.js\"></script><script src=\"/entry.js\"></script><pre id=\"result\">WAIT</pre><script>\n(async()=>{\n try{\n  if(JscRuntime.state().registered!==1||JscRuntime.state().active!==0)throw Error('boot should register only entry');\n  const before=await(await fetch('/counts',{cache:'no-store'})).json();\n  if(before.optional!==0)throw Error('optional network request occurred before demand');\n  if(JscRuntime.require('entry').value!=='entry')throw Error('entry not initialized');\n  await JscRuntime.loadScript('/optional.js',{expect:'optional'});\n  if(JscRuntime.state().registered!==2||JscRuntime.state().active!==1)throw Error('optional should be registered but not evaluated');\n  const after=await(await fetch('/counts',{cache:'no-store'})).json();\n  if(after.optional!==1)throw Error('expected exactly one optional module HTTP fetch');\n  if(JscRuntime.require('optional').value!=='optional')throw Error('optional module incorrect');\n  document.getElementById('result').textContent='PASS LAZY GET=1';\n }catch(e){document.getElementById('result').textContent='FAIL LAZY '+e.stack;}\n})();\n</script>";
const combinedPage="<!doctype html><meta charset=\"utf-8\"><script src=\"/combined.js\"></script><pre id=\"result\">WAIT</pre><script>\n(async()=>{\n try{\n  if(JscRuntime.state().registered!==2||JscRuntime.state().active!==0)throw Error('combined eager fetch must still allow deferred execution');\n  if(JscRuntime.require('optional').value!=='optional')throw Error('combined optional module incorrect');\n  const counts=await(await fetch('/counts',{cache:'no-store'})).json();\n  if(counts.optional!==1||counts.combined!==1)throw Error('combined distribution requested an optional network chunk');\n  document.getElementById('result').textContent='PASS COMBINED no optional network fetch';\n }catch(e){document.getElementById('result').textContent='FAIL COMBINED '+e.stack;}\n})();\n</script>";
let loaderGets=0,entryGets=0,optionalGets=0,combinedGets=0;
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://example.invalid').pathname;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
 if(p==='/lazy'){res.setHeader('Content-Type','text/html');res.end(lazyPage);}
 else if(p==='/combined'){res.setHeader('Content-Type','text/html');res.end(combinedPage);}
 else if(p==='/loader.js'){loaderGets++;res.setHeader('Content-Type','text/javascript');res.end(loader);}
 else if(p==='/entry.js'){entryGets++;res.setHeader('Content-Type','text/javascript');res.end(compiledEntry);}
 else if(p==='/optional.js'){optionalGets++;res.setHeader('Content-Type','text/javascript');res.end(compiledOptional);}
 else if(p==='/combined.js'){combinedGets++;res.setHeader('Content-Type','text/javascript');res.end(combined);}
 else if(p==='/counts'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({loader:loaderGets,entry:entryGets,optional:optionalGets,combined:combinedGets}));}
 else{res.statusCode=404;res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let chrome,socket;
try{
 const profile=join(dir,'profile');
 chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',[
  '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
  '--user-data-dir='+profile,'--remote-debugging-port=0','--remote-allow-origins=*',origin+'/lazy'
 ],{stdio:['ignore','pipe','pipe']});
 let stderr='';chrome.stderr.on('data',d=>stderr+=d.toString());
 let port=0;
 for(let n=0;n<140;n++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port>0)break;}catch{}await delay(100);}
 assert.ok(port>0,'Chrome debug port missing: '+stderr.slice(-800));
 let target;
 for(let n=0;n<140;n++){
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=pages.find(x=>x.type==='page'&&x.url.startsWith(origin));
  if(target)break;await delay(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome page missing');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 const pending=new Map();let sequence=0;
 socket.addEventListener('message',e=>{
  const message=JSON.parse(String(e.data));const cb=pending.get(message.id);
  if(!cb)return;pending.delete(message.id);
  if(message.error)cb.reject(Error(JSON.stringify(message.error)));else cb.resolve(message.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
 });
 const evalJs=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 const until=async(label,prefix)=>{
  for(let i=0;i<220;i++){
   try{
    const observed=await evalJs('document.getElementById("result")?.textContent');
    if(observed?.startsWith('FAIL'))throw Error(observed);
    if(observed?.startsWith(prefix))return observed;
   }catch(e){if(String(e).includes('FAIL'))throw e;}
   await delay(100);
  }
  throw Error('Timed out on '+label);
 };
 await call('Runtime.enable');await call('Page.enable');
 assert.ok((await until('separate network-load','PASS LAZY')).startsWith('PASS LAZY'));
 assert.equal(loaderGets,1);assert.equal(entryGets,1);assert.equal(optionalGets,1);assert.equal(combinedGets,0);
 await call('Page.navigate',{url:origin+'/combined'});
 assert.ok((await until('combined distribution','PASS COMBINED')).startsWith('PASS COMBINED'));
 assert.equal(combinedGets,1);assert.equal(optionalGets,1);
 console.log('PASS NETWORK LAZY: separate loader+entry at boot, optional classic module GET only on demand, single-file distribution delivers both definitions at boot; bytes='+JSON.stringify({loader:loader.length,entry:compiledEntry.length,optional:compiledOptional.length,combined:combined.length}));
}finally{
 socket?.close();
 if(chrome){chrome.kill('SIGKILL');await new Promise(resolve=>{if(chrome.exitCode!==null||chrome.signalCode!==null)resolve();else chrome.once('close',resolve);});}
 await new Promise(resolve=>server.close(resolve));
 await rm(dir,{recursive:true,force:true});
}
