// PoC 062: real operator child-process crashes and fenced, resumable local quarantine.
// This service fixture tests cooperating clients through one authority, NOT arbitrary
// external devices, malicious same-user processes, distributed consensus or power durability.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,open,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const random=()=>randomBytes(24).toString('hex');
const post=(url,value,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
const claim=(dir,id)=>join(dir,'claim-'+id+'.json');
const lock=(dir,id)=>join(dir,'recovery-'+id+'.lock');
const planFile=dir=>join(dir,'repair-intent.json');
const doneFile=dir=>join(dir,'repair-done.json');
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function maybeRead(file){try{return await readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function syncedNew(file,data){
 const h=await open(file,'wx');
 try{await h.writeFile(data);await h.sync();}finally{await h.close();}
}
function child(mode,dir,id,url,token){
 const proc=spawn(process.execPath,[import.meta.filename,'--operator',mode,dir,id,url,token],{stdio:['ignore','pipe','pipe']});
 let out='',err='';const waiters=[];
 proc.stdout.on('data',b=>{out+=b.toString();for(const w of [...waiters])if(out.includes(w.mark)){
  waiters.splice(waiters.indexOf(w),1);clearTimeout(w.timer);w.ok();
 }});
 proc.stderr.on('data',b=>err+=b.toString());
 return {proc,wait(mark){if(out.includes(mark))return Promise.resolve();return new Promise((ok,fail)=>{
  const timer=setTimeout(()=>fail(Error('operator checkpoint timeout '+mark+' '+out+' '+err)),10000);
  waiters.push({mark,timer,ok});
 });},async stop(signal='SIGKILL'){
  if(proc.exitCode===null&&proc.signalCode===null)proc.kill(signal);
  await new Promise(ok=>{if(proc.exitCode!==null||proc.signalCode!==null)ok();else proc.once('close',ok);});
 },get output(){return out;},get errors(){return err;}};
}
function checkpoint(mode,target){
 if(mode!==target)return;
 process.stdout.write('CHECKPOINT '+target+'\n');
 // Retain a live child until the supervising parent sends a real SIGKILL.
 setInterval(()=>{},1000);
 return new Promise(()=>{});
}
async function repairWorker(){
 const [mode,dir,id,url,token]=process.argv.slice(3);
 const begin=await post(url+'/operator/begin',{id}, {'X-Operator-Capability':token});
 if(!begin.ok){process.stdout.write('DENIED '+begin.status+'\n');return;}
 process.stdout.write('BEGUN\n');
 await checkpoint(mode,'crash-after-begin');
 const ledger=await fetch(url+'/ledger?id='+encodeURIComponent(id));
 if(!ledger.ok)throw Error('operator authoritative ledger unavailable: '+ledger.status);
 const authority=await ledger.json();
 if(authority.id!==id||authority.amount!==7||authority.applied!==1)throw Error('external effect inconsistent');
 const intentPath=planFile(dir);
 let intent;
 const old=await maybeRead(intentPath);
 if(old){
  intent=JSON.parse(old.toString());
  if(intent.id!==id||intent.amount!==7||intent.externalDigest!==digest(JSON.stringify(authority))||
     !Array.isArray(intent.files)||intent.files.length!==3)throw Error('invalid existing repair intent');
 }else{
  const files=[basename(lock(dir,id)),...((await readdir(dir)).filter(n=>n.startsWith('claim-'+id+'.json.stage-')).sort())];
  if(files.length!==3)throw Error('unexpected repair staging count');
  const entries=[];
  for(const name of files){
   const bytes=await readFile(join(dir,name));
   if(name!==basename(lock(dir,id))){
    const payload=JSON.parse(bytes);
    if(payload.id!==id||payload.amount!==7||payload.applied!==1||payload.status!=='done')
     throw Error('invalid staged receipt');
   }
   entries.push({name,sha256:digest(bytes)});
  }
  const before=await readFile(claim(dir,id));
  const parsed=JSON.parse(before);
  if(parsed.id!==id||parsed.amount!==7||parsed.status!=='pending')throw Error('claim not pending');
  intent={id,amount:7,claimDigest:digest(before),externalDigest:digest(JSON.stringify(authority)),
   files:entries,firstOperator:mode,version:1};
  await syncedNew(intentPath,JSON.stringify(intent)); // unique durable-intent file, not directory fsync
 }
 process.stdout.write('INTENT\n');
 await checkpoint(mode,'crash-after-intent');
 if(digest(await readFile(claim(dir,id)))!==intent.claimDigest)throw Error('claim changed');
 const quarantine=join(dir,'quarantine');
 await mkdir(quarantine,{recursive:true});
 const allStageNames=(await readdir(dir)).filter(n=>n.startsWith('claim-'+id+'.json.stage-')).sort();
 const planned=intent.files.slice(1).map(x=>x.name).sort();
 if(allStageNames.some(x=>!planned.includes(x)))throw Error('unexpected stage added');
 // Repeated calls are allowed only when each exact byte image exists in precisely
 // one of the two locations, and the original plan cannot be silently rewritten.
 for(let index=0;index<intent.files.length;index++){
  const entry=intent.files[index],src=join(dir,entry.name),dst=join(quarantine,entry.name);
  const s=await maybeRead(src),d=await maybeRead(dst);
  if((s===null)===(d===null))throw Error('missing-or-duplicated-repair-component');
  const bytes=s??d;
  if(digest(bytes)!==entry.sha256)throw Error('component digest mismatch');
  if(s!==null)await rename(src,dst);
  if(index===0){process.stdout.write('MOVED_LOCK\n');await checkpoint(mode,'crash-after-lock-move');}
  if(index===1){process.stdout.write('MOVED_STAGE_ONE\n');await checkpoint(mode,'crash-after-first-stage');}
 }
 if(await maybeRead(doneFile(dir))===null)
  await syncedNew(doneFile(dir),JSON.stringify({id,intentDigest:digest(JSON.stringify(intent)),result:'quarantined'}));
 process.stdout.write('DONE_MARKER\n');
 await checkpoint(mode,'crash-after-done');
 const end=await post(url+'/operator/end',{id,plan:digest(JSON.stringify(intent))},
  {'X-Operator-Capability':token});
 if(!end.ok)throw Error('supervisor refused completion '+end.status);
 process.stdout.write('FINISHED\n');
}
async function main(){
 const root=await mkdtemp(join(tmpdir(),'jsc-operator-takeover-'));
 const effects=new Map();
 const known=new Map();
 const state={epoch:1,maintenance:false,owner:null};
 const workerSecret=random(),wrong=random();
 let server,releaseDelayed=null,delayedStarted=null;
 const blocked=new Promise(resolve=>delayedStarted=resolve);
 const delayed=new Promise(resolve=>releaseDelayed=resolve);
 let active=[];
 try{
  server=http.createServer(async(req,res)=>{
   const route=new URL(req.url,'http://supervisor.invalid');
   const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
   if(route.pathname==='/ledger'){
    const record=effects.get(route.searchParams.get('id'));
    if(!record){reply(404,{reason:'unverifiable'});return;}
    reply(200,record);return;
   }
   let params={};
   try{const parts=[];for await(const part of req)parts.push(part);
    params=JSON.parse(Buffer.concat(parts).toString()||'{}');
   }catch{reply(400,{error:'bad-json'});return;}
   if(route.pathname==='/apply'){
    if(req.headers['x-worker-capability']!==workerSecret){reply(403,{reason:'unknown-worker'});return;}
    const at=Number(req.headers['x-epoch']);
    if(at!==state.epoch){reply(409,{reason:'stale-generation'});return;}
    if(state.maintenance){reply(423,{reason:'supervised-maintenance'});return;}
    if(params.id==='delayed'){
     delayedStarted();await delayed; // deliberate pre-commit admission race
    }
    if(at!==state.epoch||state.maintenance){reply(423,{reason:'revoked-inflight-admission'});return;}
    const old=effects.get(params.id);
    const next={id:params.id,amount:params.amount,applied:(old?.applied||0)+1};
    effects.set(params.id,next);reply(200,next);return;
   }
   const token=req.headers['x-operator-capability'],actor=known.get(token);
   if(!actor){reply(403,{reason:'operator-not-registered'});return;}
   const alive=x=>x&&x.proc.exitCode===null&&x.proc.signalCode===null;
   if(route.pathname==='/operator/begin'){
    if(state.owner&&alive(state.owner)){reply(423,{reason:'live-operator-owns-repair'});return;}
    if(!state.maintenance){state.maintenance=true;state.epoch+=1;}
    // After a real observed child exit, a new child can resume; no timeout/PID probe.
    state.owner=actor;
    reply(200,{epoch:state.epoch,recoveredFromObservedExit:true});return;
   }
   if(route.pathname==='/operator/end'){
    if(state.owner!==actor||!state.maintenance){reply(409,{reason:'not-current-owner'});return;}
    state.owner=null;state.maintenance=false;state.epoch+=1;
    reply(200,{epoch:state.epoch});return;
   }
   reply(404,{error:'unknown-route'});
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const url='http://127.0.0.1:'+server.address().port;
  const operator=(mode,dir,id)=>{
   const token=random(),task=child(mode,dir,id,url,token);
   known.set(token,task);active.push(task);return task;
  };
  const runEffect=async(id,epoch=state.epoch,token=workerSecret)=>
   post(url+'/apply',{id,amount:7},{'X-Worker-Capability':token,'X-Epoch':String(epoch)});
  assert.equal((await runEffect('unknown',1,'not-registered')).status,403);
  const outcomes=[];
  for(const [id,mode] of [['intent','crash-after-intent'],['lock','crash-after-lock-move'],
   ['stage','crash-after-first-stage'],['done','crash-after-done']]){
   const dir=join(root,id);await mkdir(dir);
   assert.equal((await runEffect(id)).status,200);
   assert.equal(effects.get(id).applied,1);
   await writeFile(claim(dir,id),JSON.stringify({id,amount:7,status:'pending'}));
   await syncedNew(lock(dir,id),JSON.stringify({id,owner:'dead-recovery-worker'}));
   for(const suffix of ['one','two'])
    await syncedNew(claim(dir,id)+'.stage-'+suffix,
     JSON.stringify({id,amount:7,status:'done',applied:1,source:suffix}));
   const oldEpoch=state.epoch;
   const first=operator(mode,dir,id);
   await first.wait(mode==='crash-after-intent'?'INTENT':
    mode==='crash-after-lock-move'?'MOVED_LOCK':
    mode==='crash-after-first-stage'?'MOVED_STAGE_ONE':'DONE_MARKER');
   assert.equal(state.maintenance,true);
   assert.equal((await runEffect('forbidden',oldEpoch)).status,409);
   assert.equal((await runEffect('forbidden',state.epoch)).status,423);
   if(id==='intent'){
    // Independent HTTP request accepted before maintenance; still rejected at commit.
    // A second operator is definitely rejected while the first process is alive.
    const competitor=operator('normal',dir,id);await competitor.wait('DENIED 423');
    await competitor.stop('SIGTERM');
   }
   await first.stop('SIGKILL');
   assert.equal(state.maintenance,true,'SIGKILL must not automatically resume effects');
   const successor=operator('normal',dir,id);
   await successor.wait('FINISHED');
   await successor.stop('SIGTERM');
   assert.equal(state.maintenance,false);
   assert.equal(effects.get(id).applied,1);
   const manifest=JSON.parse(await readFile(planFile(dir),'utf8'));
   assert.equal(manifest.files.length,3);
   const quarantine=await readdir(join(dir,'quarantine'));
   assert.equal(quarantine.length,3);
   assert.equal(await maybeRead(lock(dir,id)),null);
   assert.equal((await readdir(dir)).filter(x=>x.includes('.stage-')).length,0);
   assert.equal(JSON.parse(await readFile(doneFile(dir),'utf8')).result,'quarantined');
   assert.equal(JSON.parse(await readFile(claim(dir,id),'utf8')).status,'pending',
    'quarantine must not assert an effect receipt or replay it');
   outcomes.push({id,crash:mode,files:quarantine.length,effectCount:effects.get(id).applied});
   active=active.filter(x=>x!==first&&x!==successor);
  }
  // A late request that passed an earlier check must be fenced again at commit.
  const oldEpoch=state.epoch;
  const waiting=runEffect('delayed',oldEpoch);
  await blocked;
  const dir=join(root,'fenced');await mkdir(dir);
  assert.equal((await runEffect('fenced')).status,200);
  await writeFile(claim(dir,'fenced'),JSON.stringify({id:'fenced',amount:7,status:'pending'}));
  await syncedNew(lock(dir,'fenced'),JSON.stringify({id:'fenced',owner:'dead'}));
  for(const suffix of ['one','two'])await syncedNew(claim(dir,'fenced')+'.stage-'+suffix,
   JSON.stringify({id:'fenced',amount:7,status:'done',applied:1}));
  const gate=operator('crash-after-begin',dir,'fenced');await gate.wait('BEGUN');
  releaseDelayed();
  assert.equal((await waiting).status,423);
  assert.equal(effects.has('delayed'),false);
  await gate.stop('SIGKILL');
  const next=operator('normal',dir,'fenced');await next.wait('FINISHED');await next.stop('SIGTERM');
  assert.equal(effects.get('fenced').applied,1);
  console.log('PASS FENCED OPERATOR TAKEOVER: '+JSON.stringify(outcomes)+
   '; live competitor rejected, dead-child takeover, one write-once repair intent, 3-component partial quarantine recovered, old and in-flight worker epochs fenced, no external POST replay');
 }finally{
  if(releaseDelayed)releaseDelayed();
  await Promise.all(active.map(x=>x.stop('SIGKILL')));
  if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  await rm(root,{recursive:true,force:true});
 }
}
if(process.argv[2]==='--operator')await repairWorker();else await main();
