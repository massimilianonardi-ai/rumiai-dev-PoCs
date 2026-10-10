// PoC 062: two independent HTTP workers versus one shared local claim; external HTTP effect
// deliberately not atomic with local receipt. Uses real child processes and process SIGKILL.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const post=(url,op)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)});
async function getPort(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
function child(mode,dir,port,external){
 const proc=spawn(process.execPath,[import.meta.filename,'--server',mode,dir,String(port),external],{stdio:['pipe','pipe','pipe']});
 let output='',errors='';const watchers=[];
 proc.stdout.on('data',b=>{output+=b.toString();for(const w of [...watchers])if(output.includes(w.mark)){
  watchers.splice(watchers.indexOf(w),1);w.ok();
 }});
 proc.stderr.on('data',b=>errors+=b.toString());
 return {proc,go(){proc.stdin.write('GO\n');},
  wait(mark){if(output.includes(mark))return Promise.resolve();
   return new Promise((ok,fail)=>{
    const timer=setTimeout(()=>fail(Error('child timeout '+mode+' '+mark+' output='+output+' errors='+errors)),12000);
    timer.unref();watchers.push({mark,ok:()=>{clearTimeout(timer);ok();}});
   });},
  async stop(signal='SIGKILL'){if(proc.exitCode===null&&proc.signalCode===null)proc.kill(signal);
   await new Promise(ok=>{if(proc.exitCode!==null||proc.signalCode!==null)ok();else proc.once('close',ok);});}
 };
}
async function readClaim(path){
 try{const raw=await readFile(path,'utf8');const value=JSON.parse(raw);
  if(!value||!['pending','done'].includes(value.status)||typeof value.id!=='string'||!Number.isSafeInteger(value.amount))return null;
  return value;
 }catch{return null;}
}
async function writeReceipt(path,value){
 const tmp=path+'.stage.'+process.pid;
 const file=await open(tmp,'wx');
 try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
 await rename(tmp,path); // process-level replacement, NOT proof of power-loss atomicity
}
async function server(){
 const [mode,dir,port,device]=process.argv.slice(3);
 const stale=new Map(); // intentionally local to each process (bad multi-process dedup)
 let unlock;const gate=new Promise(ok=>unlock=ok);
 process.stdin.on('data',b=>{if(b.toString().includes('GO'))unlock();});
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local.invalid');res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/health'){res.end('OK');return;}
  if(!['/effect','/reconcile'].includes(url.pathname)){res.statusCode=404;res.end('unknown');return;}
  let op;
  try{
   if(url.pathname==='/reconcile')op={id:url.searchParams.get('id')};
   else {const chunks=[];for await(const chunk of req)chunks.push(chunk);op=JSON.parse(Buffer.concat(chunks).toString());}
  }catch{res.statusCode=400;res.end('invalid json');return;}
  if(typeof op.id!=='string'||!/^[a-z0-9-]+$/.test(op.id)||(url.pathname==='/effect'&&(!Number.isSafeInteger(op.amount)||op.amount<1))){
   res.statusCode=400;res.end('invalid operation');return;
  }
  const path=join(dir,'claim-'+op.id+'.json');
  const reply=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
  try{
   if(url.pathname==='/reconcile'){
    const claim=await readClaim(path);
    if(!claim){reply(503,{state:'unreadable-or-missing-claim'});return;}
    if(claim.status==='done'){reply(200,{...claim,replayed:true});return;}
    const authority=await fetch(device+'/ledger?id='+encodeURIComponent(op.id));
    if(!authority.ok){reply(503,{state:'pending-authority-unavailable',status:authority.status});return;}
    const seen=await authority.json();
    if(seen.id!==claim.id||seen.amount!==claim.amount||seen.applied!==1){reply(503,{state:'pending-authority-inconsistent'});return;}
    const receipt={...claim,status:'done',applied:1};
    await writeReceipt(path,receipt);
    reply(200,{...receipt,replayed:true,explicitReconciliation:true});return;
   }
   if(['unsafe','claim'].includes(mode) && !stale.has('__gated')){
    stale.set('__gated',true);process.stdout.write('ARMED\n');await gate;
   }
   if(mode==='unsafe'){
    // BOTH workers started with an independent empty map. No common idempotency authority.
    const prior=stale.get(op.id);
    if(prior){reply(200,{...prior,replayed:true});return;}
    const external=await post(device+'/apply',op);
    if(!external.ok)throw Error('external apply failed');
    const receipt={id:op.id,amount:op.amount,applied:1};stale.set(op.id,receipt);
    reply(200,{...receipt,replayed:false});return;
   }
   const existing=await readClaim(path);
   if(existing){
    if(existing.id!==op.id||existing.amount!==op.amount){reply(409,{state:'payload-conflict'});return;}
    if(existing.status==='done'){reply(200,{...existing,replayed:true});return;}
    reply(503,{state:'pending-no-automatic-retry'});return;
   }
   let file;
   try{file=await open(path,'wx');}
   catch(e){if(e.code==='EEXIST'){reply(503,{state:'another-process-owns-claim'});return;}throw e;}
   try{await file.writeFile(JSON.stringify({status:'pending',id:op.id,amount:op.amount}));await file.sync();}
   finally{await file.close();}
   if(mode==='before-effect'){
    process.stdout.write('CLAIMED_BEFORE_EFFECT\n');return; // parent SIGKILL
   }
   const applied=await post(device+'/apply',op);
   if(!applied.ok)throw Error('external apply failed');
   if(mode==='after-effect'){
    process.stdout.write('APPLIED_BEFORE_RECEIPT\n');return; // parent SIGKILL
   }
   await writeReceipt(path,{status:'done',id:op.id,amount:op.amount,applied:1});
   reply(200,{id:op.id,amount:op.amount,applied:1,replayed:false});
  }catch(e){process.stderr.write('HTTP operation error '+e.stack+'\n');reply(500,{error:'server-operation-failed'});}
 });
 await new Promise(ok=>server.listen(Number(port),'127.0.0.1',ok));process.stdout.write('READY\n');
}
async function parent(){
 const root=await mkdtemp(join(tmpdir(),'jsc-concurrent-external-'));
 let processes=[];let device;
 const effects=new Map();let lookupAvailable=true;
 try{
  device=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://device.invalid');
   if(u.pathname==='/ledger'){
    if(!lookupAvailable){res.statusCode=503;res.end('ledger temporarily unavailable');return;}
    const value=effects.get(u.searchParams.get('id'));
    if(!value){res.statusCode=404;res.end('not found');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;
   }
   if(u.pathname==='/apply'&&req.method==='POST'){
    const chunks=[];for await(const c of req)chunks.push(c);
    const op=JSON.parse(Buffer.concat(chunks).toString());
    const old=effects.get(op.id);
    effects.set(op.id,{id:op.id,amount:op.amount,applied:(old?.applied||0)+1});
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(effects.get(op.id)));return;
   }
   res.statusCode=404;res.end('unknown');
  });
  await new Promise(ok=>device.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+device.address().port;
  for(const mode of ['unsafe','claim']){
   const dir=join(root,mode);await mkdir(dir);
   const ports=[await getPort(),await getPort()];
   processes=ports.map(p=>child(mode,dir,p,origin));
   await Promise.all(processes.map(p=>p.wait('READY')));
   const urls=ports.map(p=>'http://127.0.0.1:'+p);
   const op={id:'two-workers-'+mode,amount:7};
   const requests=urls.map(u=>post(u+'/effect',op));
   await Promise.all(processes.map(p=>p.wait('ARMED')));
   processes.forEach(p=>p.go());
   const replies=await Promise.all(requests);
   const statuses=replies.map(r=>r.status);
   assert.equal(effects.get(op.id).applied,mode==='unsafe'?2:1);
   if(mode==='unsafe')assert.deepEqual(statuses.sort(),[200,200]);
   else {
    assert.equal(statuses.filter(x=>x===200).length,1);
    assert.equal(statuses.filter(x=>x===503).length,1);
    for(const url of urls){const r=await post(url+'/effect',op);assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);}
    assert.equal((await post(urls[0]+'/effect',{id:op.id,amount:8})).status,409);
    assert.equal(effects.get(op.id).applied,1);
   }
   await Promise.all(processes.map(p=>p.stop('SIGTERM')));processes=[];
  }
  for(const scenario of ['before-effect','after-effect','duplicate-external-effect']){
   const mode=scenario==='duplicate-external-effect'?'after-effect':scenario;
   const dir=join(root,mode);await mkdir(dir);
   const port=await getPort(),url='http://127.0.0.1:'+port;
   const op={id:'crash-'+scenario,amount:11};
   processes=[child(mode,dir,port,origin)];await processes[0].wait('READY');
   const pending=post(url+'/effect',op).then(()=> 'unexpected-success',()=> 'ambiguous');
   await processes[0].wait(mode==='before-effect'?'CLAIMED_BEFORE_EFFECT':'APPLIED_BEFORE_RECEIPT');
   await processes[0].stop('SIGKILL');processes=[];
   assert.equal(await Promise.race([pending,delay(8000).then(()=> 'timeout')]),'ambiguous');
   if(scenario==='duplicate-external-effect'){
    const extra=await post(origin+'/apply',op);
    assert.equal(extra.status,200,'external system actually applied a second effect');
   }
   const count=effects.get(op.id)?.applied||0;
   assert.equal(count,scenario==='before-effect'?0:scenario==='after-effect'?1:2);
   processes=[child('restart',dir,port,origin)];await processes[0].wait('READY');
   assert.equal((await post(url+'/effect',op)).status,503,'restarted server must not blindly repeat external effect');
   lookupAvailable=false;
   assert.equal((await fetch(url+'/reconcile?id='+op.id)).status,503);
   lookupAvailable=true;
   const recovery=await fetch(url+'/reconcile?id='+op.id);
   assert.equal(recovery.status,scenario==='after-effect'?200:503);
   if(scenario==='after-effect'){
    assert.equal((await recovery.json()).explicitReconciliation,true);
    const retry=await post(url+'/effect',op);assert.equal(retry.status,200);assert.equal((await retry.json()).replayed,true);
   }else assert.equal((await post(url+'/effect',op)).status,503,'unknown or conflicting state requires explicit intervention');
   assert.equal(effects.get(op.id)?.applied||0,count);
   await Promise.all(processes.map(p=>p.stop('SIGTERM')));processes=[];
  }
  console.log('PASS MULTI-PROCESS + EXTERNAL: stale independent workers applied same key twice; shared exclusive claim applied once, stale/pending fail closed; real SIGKILL before/after external HTTP effect preserved ambiguity; inconsistent double-apply ledger blocks recovery; read-only reconciliation resolves only confirmed single effect');
 }finally{
  await Promise.all(processes.map(p=>p.stop()));
  if(device)await new Promise(ok=>device.close(ok));
  await rm(root,{recursive:true,force:true});
 }
}
if(process.argv[2]==='--server')await server();else await parent();
