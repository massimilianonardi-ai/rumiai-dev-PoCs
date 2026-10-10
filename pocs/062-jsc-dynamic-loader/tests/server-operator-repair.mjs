// PoC 062: operator-supervised repair after real SIGKILL at recovery-lock / receipt stages.
// A local, disposable service fixture; NOT distributed locking, authorization or power-loss durability.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdtemp,mkdir,open,readFile,writeFile,readdir,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const opFile=(dir,id)=>join(dir,'claim-'+id+'.json');
const lockFile=(dir,id)=>join(dir,'recovery-'+id+'.lock');
const pauseFile=dir=>join(dir,'MAINTENANCE');
const validId=id=>typeof id==='string'&&/^[a-z0-9-]{1,50}$/.test(id);
async function exists(file){try{await readFile(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function syncWrite(file,value,mode='wx'){
 const f=await open(file,mode);
 try{await f.writeFile(value);await f.sync();}finally{await f.close();}
}
async function port(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));
 const n=s.address().port;await new Promise(ok=>s.close(ok));return n;}
function child(mode,dir,id,external,p){
 const proc=spawn(process.execPath,[import.meta.filename,'--worker',mode,dir,id,external,String(p)],{stdio:['ignore','pipe','pipe']});
 let output='',error='';const waiters=[];
 proc.stdout.on('data',b=>{output+=b.toString();for(const w of [...waiters])if(output.includes(w.mark)){
  waiters.splice(waiters.indexOf(w),1);clearTimeout(w.timer);w.resolve();
 }});
 proc.stderr.on('data',b=>error+=b.toString());
 return {proc,
  wait(mark){if(output.includes(mark))return Promise.resolve();return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('worker timeout '+mark+' stdout='+output+' stderr='+error)),12000);
   waiters.push({mark,timer,resolve});
  });},
  async stop(signal='SIGKILL'){
   if(proc.exitCode===null&&proc.signalCode===null)proc.kill(signal);
   await new Promise(ok=>{if(proc.exitCode!==null||proc.signalCode!==null)ok();else proc.once('close',ok);});
  }
 };
}
async function service(){
 const [mode,dir,id,external,portStr]=process.argv.slice(3);
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://worker.invalid');
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname==='/health'){reply(200,{status:'ready'});return;}
  if(await exists(pauseFile(dir))){reply(503,{state:'maintenance'});return;}
  if(url.pathname!=='/reconcile'&&url.pathname!=='/effect'){reply(404,{state:'missing-route'});return;}
  try{
   const current=JSON.parse(await readFile(opFile(dir,id),'utf8'));
   if(current.id!==id||current.amount!==7){reply(503,{state:'bad-claim'});return;}
   if(url.pathname==='/effect'){
    reply(current.status==='done'?200:503,{state:current.status,replayed:current.status==='done'});return;
   }
   if(current.status==='done'){reply(200,{state:'done',replayed:true});return;}
   if(await exists(lockFile(dir,id))){reply(503,{state:'locked'});return;}
   await syncWrite(lockFile(dir,id),JSON.stringify({id,owner:process.pid}), 'wx');
   if(mode==='kill-lock'){process.stdout.write('LOCK_SYNCED\n');return;}
   const answer=await fetch(external+'/ledger?id='+encodeURIComponent(id),{cache:'no-store'});
   if(!answer.ok){reply(503,{state:'unverified-external-result'});return;}
   const seen=await answer.json();
   if(seen.id!==id||seen.amount!==7||seen.applied!==1){reply(503,{state:'conflicting-external-result'});return;}
   const stage=opFile(dir,id)+'.stage-'+process.pid;
   await syncWrite(stage,JSON.stringify({id,amount:7,status:'done',applied:1}));
   if(mode==='kill-stage'){process.stdout.write('STAGE_SYNCED\n');return;}
   await rename(stage,opFile(dir,id));
   if(mode==='kill-rename'){process.stdout.write('RENAMED\n');return;}
   reply(200,{state:'reconciled'});
  }catch(e){reply(500,{state:'fixture-failure',reason:e.message});}
 });
 await new Promise(ok=>server.listen(Number(portStr),'127.0.0.1',ok));
 process.stdout.write('READY\n');
}
async function snapshot(dir,id){
 const claim=await readFile(opFile(dir,id));
 const lock=await readFile(lockFile(dir,id));
 const stageNames=(await readdir(dir)).filter(x=>x.startsWith('claim-'+id+'.json.stage-')).sort();
 const stages=await Promise.all(stageNames.map(async name=>({name,bytes:await readFile(join(dir,name))})));
 return {claim,lock,stages,
  digest:sha(Buffer.concat([claim,lock,...stages.flatMap(x=>[Buffer.from(x.name),x.bytes])]))};
}
function parseReceipt(raw,id){
 try{const p=JSON.parse(raw);
  if(p.id!==id||p.amount!==7||!['pending','done'].includes(p.status)||
    (p.status==='done'&&p.applied!==1))return false;
  return true;
 }catch{return false;}
}
async function auditRead(path){
 try{return (await readFile(path,'utf8')).split('\n').filter(Boolean).map(x=>JSON.parse(x));}
 catch(e){if(e.code==='ENOENT')return [];throw e;}
}
async function operatorRepair({dir,id,token,expected,secret,quiesced,external,operator='fixture-operator'}){
 // Test-only capability check: no real OS/process authentication or network authorization.
 const a=Buffer.from(sha(token)),b=Buffer.from(sha(secret));
 if(!timingSafeEqual(a,b))return {status:'unauthorized'};
 if(!quiesced)return {status:'workers-not-quiesced'};
 if(!validId(id)||!/^[a-z0-9-]+$/.test(operator))return {status:'bad-request'};
 const before=await snapshot(dir,id);
 if(before.digest!==expected)return {status:'stale-evidence'};
 if(!parseReceipt(before.claim,id)||before.stages.some(x=>!parseReceipt(x.bytes,id)))return {status:'invalid-state'};
 let claimed;
 try{claimed=JSON.parse(before.claim);}catch{return {status:'invalid-state'};}
 let current;
 try{
  const response=await fetch(external+'/ledger?id='+encodeURIComponent(id),{cache:'no-store'});
  if(!response.ok)return {status:'authority-unavailable',code:response.status};
  current=await response.json();
 }catch{return {status:'authority-unavailable'};}
 if(current.id!==id||current.amount!==claimed.amount||current.applied!==1)return {status:'authority-conflict'};
 // Caller must first have stopped all workers. A filesystem maintenance sentinel
 // stops conforming worker requests; this is NOT proof an unknown process is absent.
 let sentinel;
 try{sentinel=await open(pauseFile(dir),'wx');}
 catch(e){if(e.code==='EEXIST')return {status:'already-in-maintenance'};throw e;}
 try{
  await sentinel.writeFile(JSON.stringify({operator,id}));await sentinel.sync();
  const again=await snapshot(dir,id);
  if(again.digest!==before.digest)return {status:'changed-under-maintenance'};
  const audit=join(dir,'operator-audit.jsonl');
  await syncWrite(audit,JSON.stringify({event:'recovery-lock-quarantine',operator,id,
   claimDigest:sha(before.claim),lockDigest:sha(before.lock),
   evidenceDigest:before.digest,confirmedEffect:1,stages:before.stages.map(x=>x.name)})+'\n','a');
  const quarantine=join(dir,'quarantine');await mkdir(quarantine,{recursive:true});
  await rename(lockFile(dir,id),join(quarantine,'recovery-'+id+'.lock'));
  for(const st of before.stages)await rename(join(dir,st.name),join(quarantine,st.name));
  return {status:'quarantined',stages:before.stages.length};
 }finally{await sentinel.close();await rm(pauseFile(dir),{force:true});}
}
async function parent(){
 const root=await mkdtemp(join(tmpdir(),'jsc-operator-repair-'));
 const secret=randomBytes(24).toString('hex'),wrong=randomBytes(24).toString('hex');
 const applications=new Map();let external,active;
 const outcomes=[];
 try{
  external=http.createServer(async(req,res)=>{
   const url=new URL(req.url,'http://device.invalid');
   if(url.pathname==='/apply'&&req.method==='POST'){
    const pieces=[];for await(const p of req)pieces.push(p);
    const op=JSON.parse(Buffer.concat(pieces).toString());
    applications.set(op.id,(applications.get(op.id)||0)+1);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({id:op.id,amount:op.amount,applied:applications.get(op.id)}));return;
   }
   if(url.pathname==='/ledger'){
    const id=url.searchParams.get('id');
    if(!applications.has(id)){res.statusCode=404;res.end('not authoritative proof of absence');return;}
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({id,amount:7,applied:applications.get(id)}));return;
   }
   res.statusCode=404;res.end('missing');
  });
  await new Promise(ok=>external.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+external.address().port;
  for(const mode of ['kill-lock','kill-stage','kill-rename','no-effect']){
   const id=mode,dir=join(root,mode);await mkdir(dir);
   await writeFile(opFile(dir,id),JSON.stringify({id,amount:7,status:'pending'}));
   if(mode!=='no-effect'){
    const application=await fetch(origin+'/apply',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id,amount:7})});
    assert.equal(application.status,200);
   }
   const p=await port(),base='http://127.0.0.1:'+p;
   active=child(mode==='no-effect'?'kill-lock':mode,dir,id,origin,p);
   await active.wait('READY');
   const pending=fetch(base+'/reconcile').then(()=> 'unexpected-http-response',()=> 'ambiguous');
   await active.wait(mode==='no-effect'||mode==='kill-lock'?'LOCK_SYNCED':mode==='kill-stage'?'STAGE_SYNCED':'RENAMED');
   // Owner still running: even a correct capability and snapshot must be insufficient.
   const beforeDeath=await snapshot(dir,id);
   const same={dir,id,token:secret,expected:beforeDeath.digest,secret,quiesced:false,external:origin};
   assert.equal((await operatorRepair(same)).status,'workers-not-quiesced');
   assert.equal((await fetch(base+'/effect')).status,mode==='kill-rename'?200:503);
   await active.stop('SIGKILL');active=null;
   assert.equal(await Promise.race([pending,sleep(7000).then(()=> 'timeout')]),'ambiguous');
   // Restart before privileged intervention: an orphaned local lock must block reconciliation.
   active=child('normal',dir,id,origin,p);await active.wait('READY');
   const blocked=await fetch(base+'/reconcile');
   assert.equal(blocked.status,mode==='kill-rename'?200:503);
   await active.stop('SIGTERM');active=null;
   const fresh=await snapshot(dir,id);
   let args={dir,id,token:secret,expected:fresh.digest,secret,quiesced:true,external:origin};
   assert.equal((await operatorRepair({...args,token:wrong})).status,'unauthorized');
   assert.equal((await operatorRepair({...args,expected:'bad-revision'})).status,'stale-evidence');
   assert.deepEqual(await auditRead(join(dir,'operator-audit.jsonl')),[]);
   if(mode==='no-effect'){
    assert.equal((await operatorRepair(args)).status,'authority-unavailable');
    assert.equal(await exists(lockFile(dir,id)),true);
    assert.equal(applications.get(id)||0,0);
    outcomes.push({mode,repaired:false,reason:'unverifiable-effect'});
    continue;
   }
   // Corrupt the interrupted receipt stage to demonstrate fail-closed operator validation.
   if(mode==='kill-stage'){
    assert.equal(fresh.stages.length,1);
    await writeFile(join(dir,fresh.stages[0].name),'{"status":"done","id":"tampered"}');
    assert.equal((await operatorRepair(args)).status,'stale-evidence');
    const modified=await snapshot(dir,id);
    assert.equal((await operatorRepair({...args,expected:modified.digest})).status,'invalid-state');
    // Restore the original observed bytes in this controlled fixture, requiring fresh evidence.
    await writeFile(join(dir,fresh.stages[0].name),fresh.stages[0].bytes);
    args.expected=(await snapshot(dir,id)).digest;
   }
   const done=await operatorRepair(args);
   assert.deepEqual(done,{status:'quarantined',stages:mode==='kill-stage'?1:0});
   const audit=await auditRead(join(dir,'operator-audit.jsonl'));
   assert.equal(audit.length,1);assert.equal(audit[0].id,id);assert.equal(audit[0].confirmedEffect,1);
   assert.equal(await exists(lockFile(dir,id)),false);
   assert.equal((await readdir(join(dir,'quarantine'))).length,1+done.stages);
   // A fresh process recovers or replays the original receipt; it must NOT send the external POST again.
   active=child('normal',dir,id,origin,p);await active.wait('READY');
   assert.equal((await fetch(base+'/reconcile')).status,200);
   assert.equal((await fetch(base+'/effect')).status,200);
   assert.equal(applications.get(id),1);
   assert.equal(JSON.parse(await readFile(opFile(dir,id),'utf8')).status,'done');
   await active.stop('SIGTERM');active=null;
   outcomes.push({mode,repaired:true,stages:done.stages,externalEffects:applications.get(id)});
  }
  console.log('PASS OPERATOR REPAIR SIGKILL/STAGE/RENAME: '+JSON.stringify(outcomes)+
   '; explicit quiescence, capability comparison, fresh evidence, verified external receipt, fsynced audit, quarantine and no automatic effect replay');
 }finally{
  if(active)await active.stop('SIGKILL');
  if(external){external.closeAllConnections();await new Promise(ok=>external.close(ok));}
  await rm(root,{recursive:true,force:true});
 }
}
if(process.argv[2]==='--worker')await service();else await parent();
