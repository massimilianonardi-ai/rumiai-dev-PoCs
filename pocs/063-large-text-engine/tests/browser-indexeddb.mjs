// Real Chromium IndexedDB integration across full browser process restarts.
// Uses Chrome DevTools Protocol via Node's built-in WebSocket (no npm packages).
// Polls the completed asynchronous page scenario, not a virtual-time snapshot.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,readFileSync,existsSync,accessSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const browser=process.env.CHROMIUM_BIN || ['/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].find(path=>{try{accessSync(path);return true;}catch{return false;}});
if(!browser)throw Error('Chromium/Chrome not installed; set CHROMIUM_BIN');
const types={'.html':'text/html','.mjs':'text/javascript'};
const requests=[];
const server=createServer((req,res)=>{
 requests.push(req.url);
 const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!path.startsWith(root+'/')||!(extname(path) in types)){res.writeHead(404);res.end('no route');return;}
 try{res.setHeader('Content-Type',types[extname(path)]);res.setHeader('Cache-Control','no-store');res.end(readFileSync(path));}
 catch{res.writeHead(404);res.end('missing source');}
});
const profile=mkdtempSync(join(tmpdir(),'rumiai-chromium-idb-'));
async function cdpSession(webSocketDebuggerUrl){
 const ws=new WebSocket(webSocketDebuggerUrl);let serial=0;const awaiting=new Map();
 await new Promise((yes,no)=>{ws.onopen=yes;ws.onerror=no;});
 ws.onmessage=event=>{const item=JSON.parse(event.data);if(item.id){const p=awaiting.get(item.id);if(p){awaiting.delete(item.id);item.error?p.reject(Error(JSON.stringify(item.error))):p.resolve(item.result);}}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;awaiting.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 return {send,close(){ws.close();}};
}
async function stageRun(stage,url){
 rmSync(join(profile,'DevToolsActivePort'),{force:true});
 const child=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--disable-extensions','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',c=>{stderr=(stderr+c.toString()).slice(-5000);});
 let connection;
 try{
  const active=join(profile,'DevToolsActivePort');const until=Date.now()+20000;
  while(!existsSync(active)){if(Date.now()>until)throw Error('DevToolsActivePort not created: '+stderr);await delay(80);}
  const port=Number(readFileSync(active,'utf8').split('\n')[0]);
  let targets;for(let tries=0;tries<30;tries++){
   try{targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();break;}catch{await delay(50);}
  }
  const page=targets?.find(x=>x.type==='page');if(!page?.webSocketDebuggerUrl)throw Error('CDP page unavailable: '+stderr);
  connection=await cdpSession(page.webSocketDebuggerUrl);
  await connection.send('Page.enable');await connection.send('Runtime.enable');
  await connection.send('Page.navigate',{url});
  const started=Date.now();
  while(Date.now()-started<120000){
   const evaluated=await connection.send('Runtime.evaluate',{expression:"document.querySelector('#result')?.textContent || 'pending'",returnByValue:true});
   const response=evaluated.result?.value;
   if(typeof response==='string' && response!=='pending'){
    const result=JSON.parse(response);
    assert.equal(result.pass,true,JSON.stringify(result));
    return result;
   }
   await delay(80);
  }
  throw Error('Timed out waiting for page result. Requests '+JSON.stringify(requests.slice(-16))+' STDERR '+stderr);
 } finally {
  connection?.close();const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');
  await Promise.race([exited,delay(3000).then(()=>child.kill('SIGKILL'))]);
 }
}
try{
 await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
 const origin='http://127.0.0.1:'+server.address().port+'/tests/browser-idb.html?stage=';
 for(const stage of ['write','reopen','branch','verify','background-write','background-reopen','spill-write','spill-reopen']){
  const result=await stageRun(stage,origin+stage);console.log(JSON.stringify(result));
 }
 console.log(JSON.stringify({pass:true,browser:'Chromium',provider:'real IndexedDB',freshBrowserProcesses:8}));
} finally{await new Promise(r=>server.close(r));try { rmSync(profile,{recursive:true,force:true,maxRetries:2,retryDelay:100}); } catch(error) { console.warn('Chromium profile cleanup incomplete (non-test failure): '+error.code); }}
