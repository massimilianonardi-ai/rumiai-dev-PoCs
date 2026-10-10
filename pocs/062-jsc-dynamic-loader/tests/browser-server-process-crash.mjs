// Real Chrome + child-process SIGKILL/restart experiment.
// The HTTP application's data policy is intentionally outside jsc/loader.
// fsync on local files is observed as an API call, not power-loss durability evidence.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const parseLines=async file=>{
  try{return (await readFile(file,'utf8')).split('\n').filter(Boolean).map(x=>JSON.parse(x));}
  catch(e){if(e.code==='ENOENT')return [];throw e;}
};
async function appendSynced(file,value){
  const handle=await open(file,'a');
  try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}
  finally{await handle.close();}
}
const html=String.raw`<!doctype html><meta charset="utf-8"><script src="/loader.js"></script>
<pre id="state">BOOT</pre><script>
(async()=>{
 try{
  const pendingKey='server-crash-pending',savedKey='server-crash-last';
  let last=JSON.parse(sessionStorage.getItem(savedKey)||'{"schema":1,"total":0}');
  if(last.schema!==1||!Number.isSafeInteger(last.total))throw Error('invalid saved value');
  JscRuntime.install('client',[],(_require,module)=>{
   const pending=()=>{const x=sessionStorage.getItem(pendingKey);return x?JSON.parse(x):null;};
   const post=op=>fetch('/effect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)});
   function accept(op,receipt){
    if(receipt.id!==op.id||receipt.amount!==op.amount||receipt.applied!==1||!Number.isSafeInteger(receipt.total))
     throw Error('receipt mismatch');
    last={schema:1,total:receipt.total};sessionStorage.setItem(savedKey,JSON.stringify(last));
    sessionStorage.removeItem(pendingKey);
   }
   module.exports={
    pending,get total(){return last.total;},
    async send(id,amount){
     if(pending())throw Error('must recover first');
     const op={id,amount};sessionStorage.setItem(pendingKey,JSON.stringify(op));
     try{const response=await post(op);if(!response.ok)return 'http-'+response.status;
      accept(op,await response.json());return 'acknowledged';
     }catch{return 'ambiguous';}
    },
    async reconcile(){
     const op=pending();if(!op)return 'no-pending';
     try{const response=await fetch('/ledger?id='+encodeURIComponent(op.id),{cache:'no-store'});
      if(response.status===404)return 'unknown-preserved';
      if(!response.ok)return 'unavailable-preserved';
      accept(op,await response.json());return 'reconciled';
     }catch{return 'unavailable-preserved';}
    },
    async retry(){
     const op=pending();if(!op)return 'no-pending';
     try{const response=await post(op);if(!response.ok)return 'http-'+response.status;
      accept(op,await response.json());return 'retried';
     }catch{return 'ambiguous';}
    },
    async repeat(id,amount){
     const response=await post({id,amount});
     return {status:response.status,body:response.ok?await response.json():await response.text()};
    }
   };
  });
  window.demo={session:crypto.randomUUID(),client:JscRuntime.require('client')};
  document.getElementById('state').textContent=demo.client.pending()?'RECOVERY_REQUIRED':'READY';
 }catch(e){document.getElementById('state').textContent='ERROR '+e.stack;}
})();
</script>`;
async function serverMain(){
 const [mode,phase,dir,portString]=process.argv.slice(3),port=Number(portString);
 if(!['volatile','split','journal'].includes(mode)||!['kill','restart'].includes(phase))throw Error('invalid child arguments');
 const effects=join(dir,'effects.jsonl'),receipts=join(dir,'receipts.jsonl'),journal=join(dir,'journal.jsonl');
 const actual=mode==='journal'?await parseLines(journal):await parseLines(effects);
 const stored=mode==='journal'?actual:mode==='split'?await parseLines(receipts):[];
 const records=new Map(stored.map(x=>[x.id,x])),volatile=new Map();
 let total=actual.reduce((s,e)=>s+e.amount,0),crashTriggered=false;
 const loader=await readFile(join(root,'src/loader.js'));
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   res.setHeader('Cache-Control','no-store');
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
   if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
   if(url.pathname==='/loader.js'){res.setHeader('Content-Type','text/javascript');res.end(loader);return;}
   if(url.pathname==='/inspect'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({mode,total,effects:actual.length,receipts:mode==='volatile'?volatile.size:records.size,ids:actual.map(x=>x.id)}));return;
   }
   if(url.pathname==='/ledger'){
    const found=(mode==='volatile'?volatile:records).get(url.searchParams.get('id'));
    if(!found){res.statusCode=404;res.end('not recorded');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...found,replayed:true}));return;
   }
   if(url.pathname==='/effect'&&req.method==='POST'){
    let raw='';for await(const b of req)raw+=b.toString();
    let op;try{op=JSON.parse(raw);}catch{res.statusCode=400;res.end('bad json');return;}
    if(!op||typeof op.id!=='string'||!/^[a-z0-9-]{1,70}$/.test(op.id)||
       !Number.isSafeInteger(op.amount)||op.amount<1||op.amount>1000){
      res.statusCode=400;res.end('bad operation');return;
    }
    const prior=(mode==='volatile'?volatile:records).get(op.id);
    if(prior&&prior.amount!==op.amount){res.statusCode=409;res.end('conflicting payload');return;}
    if(prior){
     res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...prior,replayed:true}));return;
    }
    const receipt={id:op.id,amount:op.amount,total:total+op.amount,applied:1,replayed:false};
    if(mode==='journal'){
     // In this fixture the event IS the effect, and carries its idempotency receipt.
     await appendSynced(journal,receipt);
     records.set(op.id,receipt);
    }else{
     // External-looking effect and receipt are separate writes (not transactional).
     await appendSynced(effects,{id:op.id,amount:op.amount});
     if(mode==='volatile')volatile.set(op.id,receipt);
     else if(phase==='restart'){await appendSynced(receipts,receipt);records.set(op.id,receipt);}
    }
    actual.push({id:op.id,amount:op.amount});total+=op.amount;
    if(phase==='kill'&&!crashTriggered){
     crashTriggered=true;
     process.stdout.write('CHECKPOINT\n'); // after actual file sync, before response
     return; // deliberately leave HTTP response pending until parent sends real SIGKILL
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(receipt));return;
   }
   res.statusCode=404;res.end('not found');
  }catch(e){process.stderr.write(e.stack+'\n');if(!res.headersSent){res.statusCode=500;res.end('server error');}else res.destroy();}
 });
 await new Promise(ok=>server.listen(port,'127.0.0.1',ok));
 process.stdout.write('READY\n');
}
async function freePort(){
 const server=net.createServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const port=server.address().port;await new Promise(ok=>server.close(ok));return port;
}
function startChild(mode,phase,dir,port){
 const processChild=spawn(process.execPath,[import.meta.filename,'server',mode,phase,dir,String(port)],{stdio:['ignore','pipe','pipe']});
 let output='',errors='';const waiters=[];
 processChild.stdout.on('data',b=>{
  output+=b.toString();
  for(const w of [...waiters])if(output.includes(w.mark)){waiters.splice(waiters.indexOf(w),1);w.ok();}
 });
 processChild.stderr.on('data',b=>errors+=b.toString());
 return {
  child:processChild,
  wait(mark){return Promise.race([
   new Promise((ok,fail)=>{if(output.includes(mark))ok();else waiters.push({mark,ok,fail});}),
   delay(12000).then(()=>{throw Error('child checkpoint timeout '+mode+'/'+phase+' '+mark+' stdout='+output+' stderr='+errors);})
  ]);},
  async stop(signal='SIGTERM'){
   if(processChild.exitCode===null&&processChild.signalCode===null)processChild.kill(signal);
   await new Promise(ok=>{if(processChild.exitCode!==null||processChild.signalCode!==null)ok();else processChild.once('close',ok);});
  }
 };
}
async function parentMain(){
 const dir=await mkdtemp(join(tmpdir(),'jsc-http-server-crash-'));
 let chrome,socket,active;
 try{
  const profile=join(dir,'profile'),port=await freePort(),url='http://127.0.0.1:'+port+'/';
  // One Chrome document is retained while the HTTP service process dies and restarts.
  // Separate mode directories are initialized before the first spawn.
  const {mkdir}=await import('node:fs/promises');
  for(const mode of ['volatile','split','journal'])await mkdir(join(dir,mode));
  active=startChild('volatile','kill',join(dir,'volatile'),port);await active.wait('READY');
  chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',[
   '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
   '--user-data-dir='+profile,'--remote-debugging-port=0','--remote-allow-origins=*',url
  ],{stdio:['ignore','pipe','pipe']});
  let stderr='';chrome.stderr.on('data',b=>stderr+=b.toString());
  let devPort=0;
  for(let i=0;i<160;i++){try{devPort=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(devPort)break;}catch{}await delay(100);}
  assert.ok(devPort,'Chrome DevTools did not start '+stderr.slice(-600));
  let target;
  for(let i=0;i<120;i++){
   const pages=await(await fetch('http://127.0.0.1:'+devPort+'/json/list')).json();
   target=pages.find(x=>x.type==='page'&&x.url.startsWith(url));
   if(target)break;await delay(100);
  }
  assert.ok(target?.webSocketDebuggerUrl,'Chrome application page missing');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
  let seq=0;const waiting=new Map();
  socket.addEventListener('message',event=>{
   const result=JSON.parse(String(event.data)),p=waiting.get(result.id);
   if(!p)return;waiting.delete(result.id);
   if(result.error)p.fail(Error(JSON.stringify(result.error)));else p.ok(result.result);
  });
  const call=(method,params={})=>new Promise((ok,fail)=>{
   const id=++seq;waiting.set(id,{ok,fail});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
   const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
   if(result.exceptionDetails)throw Error('Chrome '+expression+' '+JSON.stringify(result.exceptionDetails));
   return result.result.value;
  };
  const until=async(expression,label)=>{
   for(let i=0;i<140;i++){try{if(await evaluate(expression))return;}catch{}await delay(100);}
   throw Error('Chrome timeout '+label+' '+await evaluate('document.getElementById("state")?.textContent'));
  };
  await call('Runtime.enable');await call('Page.enable');
  const outcomes=[];
  for(const mode of ['volatile','split','journal']){
   if(mode!=='volatile'){
    active=startChild(mode,'kill',join(dir,mode),port);await active.wait('READY');
    await call('Page.navigate',{url}); // same origin; previous scenario must be fully cleared
    await until('document.getElementById("state")?.textContent==="READY"','fresh '+mode);
   }else await until('document.getElementById("state")?.textContent==="READY"','initial volatile');
   const opId='crash-'+mode;
   // Reset scenario-local storage, retaining the same browser realm only for each crash.
   await evaluate('sessionStorage.clear()');
   const request=evaluate('demo.client.send('+JSON.stringify(opId)+',7)');
   await active.wait('CHECKPOINT');
   await active.stop('SIGKILL');active=null;
   assert.equal(await request,'ambiguous','SIGKILL must cause ambiguous browser POST');
   assert.deepEqual(await evaluate('demo.client.pending()'),{id:opId,amount:7});
   active=startChild(mode,'restart',join(dir,mode),port);await active.wait('READY');
   const inspect=async()=>await(await fetch(url+'inspect')).json();
   assert.deepEqual(await inspect(),{mode,total:7,effects:1,receipts:mode==='journal'?1:0,ids:[opId]});
   const oldSession=await evaluate('demo.session');
   await call('Page.reload',{ignoreCache:true});
   await until('window.demo?.session!=='+JSON.stringify(oldSession)+'&&document.getElementById("state")?.textContent==="RECOVERY_REQUIRED"','reload recovery '+mode);
   assert.deepEqual(await evaluate('demo.client.pending()'),{id:opId,amount:7});
   const response=await evaluate('demo.client.reconcile()');
   assert.equal(response,mode==='journal'?'reconciled':'unknown-preserved');
   if(mode==='journal'){
    assert.equal(await evaluate('demo.client.total'),7);
    assert.equal(await evaluate('demo.client.pending()'),null);
    const duplicate=await evaluate('demo.client.repeat("'+opId+'",7)');
    assert.equal(duplicate.status,200);assert.equal(duplicate.body.replayed,true);
    assert.equal(duplicate.body.total,7);
    const mismatch=await evaluate('demo.client.repeat("'+opId+'",9)');
    assert.equal(mismatch.status,409);
    assert.deepEqual(await inspect(),{mode,total:7,effects:1,receipts:1,ids:[opId]});
   }else{
    // Read-only status cannot distinguish never-applied from applied-but-unrecorded.
    assert.deepEqual(await evaluate('demo.client.pending()'),{id:opId,amount:7});
    assert.equal(await evaluate('demo.client.total'),0);
    // Deliberately unsafe negative control: retrying blindly causes a duplicate effect.
    assert.equal(await evaluate('demo.client.retry()'),'retried');
    assert.deepEqual(await inspect(),{mode,total:14,effects:2,receipts:1,ids:[opId,opId]});
   }
   outcomes.push({mode,reconcile:response,afterRestart:mode==='journal'?7:14});
   await active.stop();active=null;
  }
  console.log('PASS REAL SERVER SIGKILL/RESTART + CHROME: '+JSON.stringify(outcomes)+
   '; volatile/split receipts permit duplicate after restart; single event+receipt journal deduplicates this one-process local-file experiment');
 }finally{
  socket?.close();
  if(active)await active.stop('SIGKILL');
  if(chrome){chrome.kill('SIGKILL');await new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)ok();else chrome.once('close',ok);});}
  await rm(dir,{recursive:true,force:true});
 }
}
if(process.argv[2]==='server')await serverMain();
else await parentMain();
