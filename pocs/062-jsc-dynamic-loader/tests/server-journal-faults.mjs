// PoC 062: actual SIGKILL during journal writes, integrity-checked restart, fail-closed recovery.
// Local filesystem observations only; neither power-failure durability nor distributed exactly-once.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,open,rm} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checksum=payload=>createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const encode=payload=>JSON.stringify({payload,sha256:checksum(payload)})+'\n';
async function recover(path){
 let bytes;
 try{bytes=await readFile(path);}catch(error){if(error.code==='ENOENT')return {receipts:new Map(),total:0};throw error;}
 if(bytes.length&&!bytes.toString('utf8').endsWith('\n'))throw Error('incomplete-journal-tail');
 const receipts=new Map();let total=0;
 for(const line of bytes.toString('utf8').split('\n').filter(Boolean)){
  let entry;
  try{entry=JSON.parse(line);}catch{throw Error('invalid-journal-json');}
  const p=entry?.payload;
  if(!p||typeof p.id!=='string'||!/^[a-z0-9-]+$/.test(p.id)||!Number.isSafeInteger(p.amount)||p.amount<=0||
     !Number.isSafeInteger(p.total)||p.total!==total+p.amount||entry.sha256!==checksum(p)||receipts.has(p.id))
   throw Error('journal-integrity-or-sequence-error');
  receipts.set(p.id,p);total=p.total;
 }
 return {receipts,total};
}
async function syncAppend(path,bytes){
 const file=await open(path,'a');
 try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
}
async function port(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));
 const number=s.address().port;await new Promise(ok=>s.close(ok));return number;}
function worker(phase,path,p){
 const child=spawn(process.execPath,[import.meta.filename,'--worker',phase,path,String(p)],{stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';const listeners=[];
 child.stdout.on('data',b=>{stdout+=b.toString();for(const l of [...listeners])if(stdout.includes(l.mark)){
  listeners.splice(listeners.indexOf(l),1);l.resolve();
 }});
 child.stderr.on('data',b=>stderr+=b.toString());
 return {child,async wait(mark){
  if(stdout.includes(mark))return;
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('worker timeout '+mark+' '+stdout+' '+stderr)),10000);
   timer.unref();
   listeners.push({mark,resolve:()=>{clearTimeout(timer);resolve();}});
  });
 },async stop(signal='SIGKILL'){
  if(child.exitCode===null&&child.signalCode===null)child.kill(signal);
  await new Promise(ok=>{if(child.exitCode!==null||child.signalCode!==null)ok();else child.once('close',ok);});
 }};
}
async function mainWorker(){
 const [phase,path,p]=process.argv.slice(3);let state,error=null;
 try{state=await recover(path);}catch(e){error=e.message;}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const url=new URL(req.url,'http://local.invalid');
  if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:!error,error}));return;}
  if(error){res.statusCode=503;res.end('recovery-blocked:'+error);return;}
  if(url.pathname==='/ledger'){
   const prior=state.receipts.get(url.searchParams.get('id'));
   if(!prior){res.statusCode=404;res.end('unknown');return;}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...prior,replayed:true}));return;
  }
  if(url.pathname==='/effect'&&req.method==='POST'){
   try{
    const chunks=[];for await(const c of req)chunks.push(c);
    const op=JSON.parse(Buffer.concat(chunks).toString());
    if(typeof op.id!=='string'||!/^[a-z0-9-]+$/.test(op.id)||!Number.isSafeInteger(op.amount)||op.amount<1){res.statusCode=400;res.end('invalid');return;}
    const prior=state.receipts.get(op.id);
    if(prior){if(prior.amount!==op.amount){res.statusCode=409;res.end('conflict');return;}
     res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...prior,replayed:true}));return;}
    const record={id:op.id,amount:op.amount,total:state.total+op.amount},bytes=encode(record);
    if(phase==='partial'){
     await syncAppend(path,bytes.slice(0,Math.floor(bytes.length/2)));
     process.stdout.write('PARTIAL_SYNCED\n');return; // leave HTTP pending, parent SIGKILL
    }
    await syncAppend(path,bytes);
    state.receipts.set(op.id,record);state.total=record.total;
    if(phase==='complete'){
     process.stdout.write('COMPLETE_SYNCED\n');return; // leave HTTP pending, parent SIGKILL
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...record,replayed:false}));return;
   }catch(e){res.statusCode=500;res.end('effect-error:'+e.message);return;}
  }
  res.statusCode=404;res.end('unknown-route');
 });
 await new Promise(ok=>server.listen(Number(p),'127.0.0.1',ok));process.stdout.write('READY\n');
}
async function parent(){
 const dir=await mkdtemp(join(tmpdir(),'jsc-journal-fault-'));let active;
 const results=[];
 try{
  for(const mode of ['partial','complete','corrupt']){
   const file=join(dir,mode+'.log'),p=await port(),url='http://127.0.0.1:'+p;
   if(mode==='corrupt')await writeFile(file,encode({id:'corrupt',amount:7,total:7}).replace('"amount":7','"amount":8'));
   active=worker(mode==='corrupt'?'normal':mode,file,p);await active.wait('READY');
   if(mode!=='corrupt'){
    const pending=fetch(url+'/effect',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:mode,amount:7})}).then(()=> 'unexpected-http-response',()=> 'ambiguous');
    await active.wait(mode==='partial'?'PARTIAL_SYNCED':'COMPLETE_SYNCED');
    await active.stop('SIGKILL');active=null;
    assert.equal(await Promise.race([pending,pause(8000).then(()=> 'timeout')]),'ambiguous');
   }
   if(active){await active.stop('SIGKILL');active=null;}
   const bytesBefore=await readFile(file);
   active=worker('normal',file,p);await active.wait('READY');
   const health=await (await fetch(url+'/health')).json();
   if(mode==='complete'){
    assert.deepEqual(health,{ready:true,error:null});
    const receipt=await (await fetch(url+'/ledger?id=complete')).json();
    assert.deepEqual(receipt,{id:'complete',amount:7,total:7,replayed:true});
    const retry=await fetch(url+'/effect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'complete',amount:7})});
    assert.equal(retry.status,200);assert.equal((await retry.json()).replayed,true);
    const conflict=await fetch(url+'/effect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'complete',amount:9})});
    assert.equal(conflict.status,409);
   }else{
    assert.equal(health.ready,false);
    assert.match(health.error,mode==='partial'?/incomplete-journal-tail/:/journal-integrity-or-sequence-error/);
    assert.equal((await fetch(url+'/ledger?id='+mode)).status,503);
    assert.equal((await fetch(url+'/effect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:mode,amount:7})})).status,503);
    assert.deepEqual(await readFile(file),bytesBefore,'fail-closed server must not silently truncate or repair');
   }
   results.push({mode,health:health.ready?'recovered':'blocked',reason:health.error});
   await active.stop('SIGTERM');active=null;
  }
  console.log('PASS JOURNAL SIGKILL/TORN/CORRUPT: '+JSON.stringify(results));
 }finally{if(active)await active.stop();await rm(dir,{recursive:true,force:true});}
}
if(process.argv[2]==='--worker')await mainWorker();else await parent();
