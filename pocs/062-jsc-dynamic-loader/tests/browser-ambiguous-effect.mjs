// Real Chrome/Node HTTP PoC: server-side effect can be committed although HTTP response
// is lost. Idempotency, retries and reconciliation are TEST APPLICATION responsibilities.
// This is not exactly-once transport or durable ledger/recovery proof.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'jsc-ambiguous-effect-'));
const loader=await readFile(join(root,'src/loader.js'));
const html="<!doctype html><meta charset=\"utf-8\"><script src=\"/loader.js\"></script><pre id=\"status\">BOOT</pre><script>\n(async()=>{\ntry{\n const pendingKey='poc-pending',savedKey='poc-saved';\n const saved=JSON.parse(sessionStorage.getItem(savedKey)||'{\"schema\":1,\"total\":0}');\n if(saved.schema!==1||!Number.isSafeInteger(saved.total))throw Error('invalid saved state');\n let total=saved.total;\n JscRuntime.install('client',[],(_r,module)=>{\n  async function post(op){\n   return fetch('/effect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)});\n  }\n  function pending(){const v=sessionStorage.getItem(pendingKey);return v===null?null:JSON.parse(v);}\n  function accept(op,receipt){\n   if(receipt.id!==op.id||receipt.amount!==op.amount||receipt.applied!==1||!Number.isSafeInteger(receipt.total))\n    throw Error('receipt did not match pending operation');\n   total=receipt.total;\n   sessionStorage.setItem(savedKey,JSON.stringify({schema:1,total}));\n   sessionStorage.removeItem(pendingKey);\n  }\n  module.exports={\n   get total(){return total;},pending,\n   async send(id,amount){\n    if(pending())throw Error('pending operation needs explicit recovery');\n    const op={id,amount};\n    sessionStorage.setItem(pendingKey,JSON.stringify(op)); // before any network request\n    try{\n     const r=await post(op);\n     if(!r.ok)return 'http-'+r.status;\n     accept(op,await r.json());return 'acknowledged';\n    }catch{return 'ambiguous';}\n   },\n   async retry(){\n    const op=pending();if(!op)return 'no-pending';\n    try{\n     const r=await post(op);\n     if(!r.ok)return 'http-'+r.status;\n     accept(op,await r.json());return 'resolved-by-retry';\n    }catch{return 'still-ambiguous';}\n   },\n   async reconcile(){\n    const op=pending();if(!op)return 'no-pending';\n    try{\n     const r=await fetch('/ledger?id='+encodeURIComponent(op.id),{cache:'no-store'});\n     if(r.status===404)return 'not-found-still-pending';\n     if(!r.ok)return 'ledger-unavailable';\n     accept(op,await r.json());return 'resolved-by-ledger';\n    }catch{return 'ledger-unavailable';}\n   },\n   async mismatched(id,amount){\n    const r=await post({id,amount});return r.status;\n   },\n   async concurrent(id,amount){\n    const [a,b]=await Promise.all([post({id,amount}),post({id,amount})]);\n    const x=await a.json(),y=await b.json();\n    if(a.status!==200||b.status!==200||x.total!==y.total||x.applied!==1||y.applied!==1)\n     throw Error('concurrent receipts inconsistent');\n    total=x.total;sessionStorage.setItem(savedKey,JSON.stringify({schema:1,total}));\n    return {sameTotal:x.total===y.total,replayed:[x.replayed,y.replayed].sort().join(',')};\n   }\n  };\n });\n const client=JscRuntime.require('client');\n window.demo={sessionId:crypto.randomUUID(),client,initialPending:client.pending()!==null};\n document.getElementById('status').textContent=client.pending()?'RECOVERY_REQUIRED':'READY';\n}catch(e){document.getElementById('status').textContent='ERROR '+e.stack;}\n})();\n</script>";
const records=new Map(),attempts=new Map();
let total=0,ledgerAvailable=true,droppedAfter=0,droppedBefore=0,conflicts=0,applied=0,duplicateReceipts=0;
const dropAfter=new Set(['applied-then-disconnected','reconcile-after-reload']);
const dropBefore=new Set(['disconnected-before-apply']);
const server=http.createServer(async(req,res)=>{
  function truncateAcknowledgment(){
   // Headers and a partial response have reached Chrome; there is no complete receipt.
   // Explicit content-length guarantees the browser cannot interpret an early EOF as success.
   res.writeHead(200,{'Content-Type':'application/json','Content-Length':'1024'});
   res.write('{"incomplete":');
   setTimeout(()=>res.destroy(),15);
  }
 const route=new URL(req.url,'http://local.invalid'),path=route.pathname;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline';connect-src 'self'");
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 if(path==='/loader.js'){res.setHeader('Content-Type','text/javascript');res.end(loader);return;}
 if(path==='/ledger'){
  if(!ledgerAvailable){res.statusCode=503;res.end('temporarily unavailable');return;}
  const value=records.get(route.searchParams.get('id'));
  if(!value){res.statusCode=404;res.end('unknown');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...value,replayed:true}));return;
 }
 if(path==='/effect'&&req.method==='POST'){
  let text='';
  try{for await(const chunk of req)text+=chunk.toString();}catch{res.destroy();return;}
  let op;
  try{op=JSON.parse(text);}catch{res.statusCode=400;res.end('invalid json');return;}
  if(!op||typeof op.id!=='string'||!/^[-a-z0-9]{1,80}$/.test(op.id)||
     !Number.isSafeInteger(op.amount)||op.amount<=0||op.amount>1000){
   res.statusCode=400;res.end('invalid operation');return;
  }
  const count=(attempts.get(op.id)||0)+1;attempts.set(op.id,count);
  if(dropBefore.has(op.id)&&count===1){
   droppedBefore++;truncateAcknowledgment();return; // no operation was applied
  }
  const prior=records.get(op.id);
  if(prior&&prior.amount!==op.amount){
   conflicts++;res.statusCode=409;res.end('id used with different payload');return;
  }
  let receipt;
  if(prior){duplicateReceipts++;receipt={...prior,replayed:true};}
  else{
   total+=op.amount;applied++;
   receipt={id:op.id,amount:op.amount,total,applied:1,replayed:false};
   records.set(op.id,receipt);
  }
  if(dropAfter.has(op.id)&&count===1){
   droppedAfter++;truncateAcknowledgment();return; // effect applied, receipt truncated
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(receipt));
  return;
 }
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
 let stderr='';chrome.stderr.on('data',x=>stderr+=x.toString());
 let port=0;
 for(let i=0;i<160;i++){
  try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
  await delay(100);
 }
 assert.ok(port>0,'Chrome DevTools did not start '+stderr.slice(-650));
 let target;
 for(let i=0;i<130;i++){
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=pages.find(p=>p.type==='page'&&p.url.startsWith(url));
  if(target)break;await delay(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome page unavailable');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let seq=0;const pending=new Map();
 socket.addEventListener('message',event=>{
  const result=JSON.parse(String(event.data)),p=pending.get(result.id);
  if(!p)return;pending.delete(result.id);
  if(result.error)p.reject(Error(JSON.stringify(result.error)));else p.resolve(result.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error('Chrome evaluate '+expression+' '+JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 const until=async(expression,label)=>{
  for(let i=0;i<160;i++){try{if(await evaluate(expression))return;}catch{}await delay(100);}
  throw Error('Timeout '+label+' '+(await evaluate('document.getElementById("status")?.textContent')));
 };
 await call('Runtime.enable');await call('Page.enable');
 await until('window.demo?.client&&document.getElementById("status")?.textContent==="READY"','initial page');
 const before=await evaluate('demo.sessionId');
 const run=expression=>evaluate('demo.client.'+expression);
 // Case 1: effect applied, TCP connection torn down before receipt; retry same id is safe.
 assert.equal(await run('send("applied-then-disconnected",7)'),'ambiguous');
 assert.equal(total,7);assert.equal(records.size,1);
 assert.equal(await run('total'),0,'no acknowledgment must not advance local state');
 assert.deepEqual(await run('pending()'),{id:'applied-then-disconnected',amount:7});
 assert.equal(await run('retry()'),'resolved-by-retry');
 assert.equal(total,7);assert.equal(await run('total'),7);
 assert.equal(await run('mismatched("applied-then-disconnected",99)'),409);
 assert.equal(total,7);assert.equal(records.get('applied-then-disconnected').amount,7);
 // Case 2: transport failed before the server committed anything; status says unknown.
 assert.equal(await run('send("disconnected-before-apply",3)'),'ambiguous');
 assert.equal(total,7);
 assert.equal(await run('reconcile()'),'not-found-still-pending');
 assert.deepEqual(await run('pending()'),{id:'disconnected-before-apply',amount:3});
 assert.equal(await run('retry()'),'resolved-by-retry');
 assert.equal(total,10);assert.equal(await run('total'),10);
 // Case 3: effect applied and response lost; ledger unavailable across browser reload.
 assert.equal(await run('send("reconcile-after-reload",5)'),'ambiguous');
 assert.equal(total,15);
 ledgerAvailable=false;
 await call('Page.reload',{ignoreCache:true});
 await until('window.demo?.sessionId!=='+JSON.stringify(before)+'&&document.getElementById("status")?.textContent==="RECOVERY_REQUIRED"','pending recovery after reload');
 assert.equal(await run('total'),10,'normal reload must retain only last acknowledged local total');
 assert.deepEqual(await run('pending()'),{id:'reconcile-after-reload',amount:5});
 assert.equal(await run('reconcile()'),'ledger-unavailable');
 assert.deepEqual(await run('pending()'),{id:'reconcile-after-reload',amount:5});
 assert.equal(attempts.get('reconcile-after-reload'),1,'no silent retransmission while status unknown');
 ledgerAvailable=true;
 assert.equal(await run('reconcile()'),'resolved-by-ledger');
 assert.equal(await run('total'),15);assert.equal(await run('pending()'),null);
 assert.equal(attempts.get('reconcile-after-reload'),1,'status lookup must not repeat the operation');
 // Case 4: simultaneously duplicated requests with the same key apply one effect.
 assert.deepEqual(await run('concurrent("concurrent-one-effect",2)'),{sameTotal:true,replayed:'false,true'});
 assert.equal(total,17);assert.equal(records.size,4);
 assert.equal(attempts.get('concurrent-one-effect'),2);
 assert.equal(applied,4);assert.equal(conflicts,1);
 assert.equal(droppedAfter,2);assert.equal(droppedBefore,1);
 assert.equal(duplicateReceipts,2);
 console.log('PASS AMBIGUOUS HTTP: commit-then-drop vs drop-before-commit, identical retry deduplicated, mismatched payload 409, 503 reconciliation preserves intent across reload, concurrent duplicate executes once; '+JSON.stringify({attempts:[...attempts],applied,total,conflicts,droppedAfter,droppedBefore,duplicateReceipts}));
}finally{
 socket?.close();
 if(chrome){chrome.kill('SIGKILL');await new Promise(resolve=>{if(chrome.exitCode!==null||chrome.signalCode!==null)resolve();else chrome.once('close',resolve);});}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await rm(dir,{recursive:true,force:true});
}
