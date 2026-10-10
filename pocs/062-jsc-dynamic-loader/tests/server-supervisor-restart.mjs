// PoC 062: real supervisor SIGKILL/restart, local persisted fence, orphaned operator ownership.
// All credentials / effect service are deliberately fixture-scoped. Process death != power durability.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,open,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const hash=s=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(24).toString('hex');
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
const file=dir=>join(dir,'supervisor-state.json');
const stage=dir=>join(dir,'supervisor-state.stage');
const initialized=dir=>join(dir,'supervisor-initialized.marker');
const post=(u,data,headers={})=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
function encode(state){return JSON.stringify({state,sha256:hash(JSON.stringify(state))});}
function parse(data){
 const entry=JSON.parse(data);
 if(!entry||!entry.state||entry.sha256!==hash(JSON.stringify(entry.state)))throw Error('bad-state-integrity');
 const s=entry.state;
 if(!Number.isSafeInteger(s.epoch)||s.epoch<1||!['normal','maintenance'].includes(s.phase)||
    !(s.operation===null||(typeof s.operation==='string'&&/^[a-z0-9-]{1,60}$/.test(s.operation)))||
    !(s.ownerTag===null||(typeof s.ownerTag==='string'&&/^[a-f0-9]{64}$/.test(s.ownerTag))))throw Error('bad-state-shape');
 return s;
}
async function readMaybe(path){try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function writeNext(dir,state,stopAt){
 const fh=await open(stage(dir),'wx');
 try{await fh.writeFile(encode(state));await fh.sync();}finally{await fh.close();}
 if(stopAt==='after-stage'){process.stdout.write('AFTER_STAGE\n');await new Promise(()=>{});}
 await rename(stage(dir),file(dir));
 if(stopAt==='after-rename'){process.stdout.write('AFTER_RENAME\n');await new Promise(()=>{});}
}
async function boot(dir){
 let original=await readMaybe(file(dir)),pending=await readMaybe(stage(dir));
 if(original===null&&pending===null){
  if(await readMaybe(initialized(dir))!==null)throw Error('missing-initialized-state');
  // Create-only initialized marker precedes first normal state, so lost state
  // is never interpreted as a new installation after initial setup.
  const f=await open(initialized(dir),'wx');
  try{await f.writeFile('initialized-v1\n');await f.sync();}finally{await f.close();}
  const s={epoch:1,phase:'normal',operation:null,ownerTag:null};
  await writeNext(dir,s);return s;
 }
 if(await readMaybe(initialized(dir))!=='initialized-v1\n')throw Error('untrusted-bootstrap-marker');
 if(original===null)throw Error('missing-canonical-state');
 let current=parse(original);
 if(pending!==null){
  const p=parse(pending);
  if(p.epoch!==current.epoch+1||p.phase!=='maintenance'||
     (current.operation!==null&&p.operation!==current.operation))throw Error('untrusted-staged-transition');
  await rename(stage(dir),file(dir));current=p;
 }
 // Every process restart invalidates the old generation and preserves uncertainty.
 // A previous ownerTag is *observational metadata*, never an authenticator.
 const restarted={epoch:current.epoch+1,phase:'maintenance',operation:current.operation,ownerTag:null};
 await writeNext(dir,restarted);
 return restarted;
}
async function supervisor(){
 const [mode,dir,port,external,workerToken,operatorToken]=process.argv.slice(3);
 let state,error=null;
 try{state=await boot(dir);}catch(e){error=e.message;}
 const server=http.createServer(async(req,res)=>{
  const route=new URL(req.url,'http://supervisor.invalid');
  const answer=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(route.pathname==='/health'){answer(200,{ready:error===null,error,state});return;}
  if(error){answer(503,{reason:'failed-closed-restart',error});return;}
  let op={};
  try{const parts=[];for await(const b of req)parts.push(b);op=JSON.parse(Buffer.concat(parts).toString()||'{}');}
  catch{answer(400,{reason:'invalid-json'});return;}
  if(route.pathname==='/effect'){
   if(req.headers['x-worker-token']!==workerToken){answer(403,{reason:'worker-not-authorized'});return;}
   if(Number(req.headers['x-epoch'])!==state.epoch){answer(409,{reason:'revoked-generation'});return;}
   if(state.phase!=='normal'){answer(423,{reason:'maintenance'});return;}
   if(typeof op.id!=='string'||!/^[a-z0-9-]+$/.test(op.id)||op.amount!==7){answer(400,{reason:'bad-payload'});return;}
   if(mode==='inflight'&&op.id==='inflight'){
    process.stdout.write('INFLIGHT\n');await new Promise(()=>{});return;
   }
   // Recheck after any future awaits before delegating; no guarantee for already-delegated calls.
   if(Number(req.headers['x-epoch'])!==state.epoch||state.phase!=='normal'){answer(423,{reason:'fenced'});return;}
   const applied=await post(external+'/apply',op);
   if(!applied.ok){answer(503,{reason:'external-error'});return;}
   answer(200,await applied.json());return;
  }
  if(!['/operator/begin','/operator/claim','/operator/end'].includes(route.pathname)){
   answer(404,{reason:'unknown-route'});return;
  }
  if(req.headers['x-operator-token']!==operatorToken){answer(403,{reason:'operator-not-authorized'});return;}
  if(typeof op.id!=='string'||!/^[a-z0-9-]+$/.test(op.id)){answer(400,{reason:'bad-operation-id'});return;}
  if(route.pathname==='/operator/begin'){
   if(state.phase!=='normal'){answer(423,{reason:'already-maintenance'});return;}
   const next={epoch:state.epoch+1,phase:'maintenance',operation:op.id,ownerTag:hash(operatorToken)};
   try{await writeNext(dir,next,mode==='kill-stage'?'after-stage':mode==='kill-rename'?'after-rename':null);
    state=next;answer(200,{epoch:state.epoch});}
   catch(e){error='write-failed:'+e.message;answer(503,{reason:'write-failed'});}return;
  }
  if(state.phase!=='maintenance'||state.operation!==op.id){answer(409,{reason:'wrong-recovery-context'});return;}
  if(route.pathname==='/operator/claim'){
   if(state.ownerTag!==null){answer(423,{reason:'owner-session-still-live'});return;}
   const next={...state,epoch:state.epoch+1,ownerTag:hash(operatorToken)};
   try{await writeNext(dir,next);state=next;answer(200,{epoch:state.epoch});}
   catch(e){error='claim-write-failed:'+e.message;answer(503,{reason:'claim-write-failed'});}return;
  }
  if(state.ownerTag!==hash(operatorToken)){answer(403,{reason:'operator-session-not-owner'});return;}
  let witness;
  try{const r=await fetch(external+'/ledger?id='+encodeURIComponent(op.id));
   if(!r.ok){answer(503,{reason:'no-authoritative-effect',status:r.status});return;}
   witness=await r.json();}
  catch{answer(503,{reason:'ledger-offline'});return;}
  if(witness.id!==op.id||witness.amount!==7||witness.applied!==1){answer(503,{reason:'external-disagreement'});return;}
  const next={epoch:state.epoch+1,phase:'normal',operation:null,ownerTag:null};
  try{await writeNext(dir,next);state=next;answer(200,{epoch:state.epoch});}
  catch(e){error='end-write-failed:'+e.message;answer(503,{reason:'end-write-failed'});}
 });
 await new Promise(ok=>server.listen(Number(port),'127.0.0.1',ok));process.stdout.write('READY\n');
}
function launch(mode,dir,port,external,workerToken,operatorToken){
 const proc=spawn(process.execPath,[import.meta.filename,'--supervisor',mode,dir,String(port),external,workerToken,operatorToken],{stdio:['ignore','pipe','pipe']});
 let out='',err='';const callbacks=[];
 proc.stdout.on('data',b=>{out+=b.toString();for(const c of [...callbacks])if(out.includes(c.mark)){
  callbacks.splice(callbacks.indexOf(c),1);clearTimeout(c.timer);c.ok();
 }});
 proc.stderr.on('data',b=>err+=b.toString());
 return {proc,wait(mark){if(out.includes(mark))return Promise.resolve();return new Promise((ok,fail)=>{
  const timer=setTimeout(()=>fail(Error('missing '+mark+' output='+out+' err='+err)),10000);
  callbacks.push({mark,timer,ok});
 });},async stop(signal='SIGKILL'){
  if(proc.exitCode===null&&proc.signalCode===null)proc.kill(signal);
  await new Promise(ok=>{if(proc.exitCode!==null||proc.signalCode!==null)ok();else proc.once('close',ok);});
 }};
}
async function freePort(){const s=http.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
async function main(){
 const root=await mkdtemp(join(tmpdir(),'poc062-supervisor-restart-'));
 const effects=new Map();let ext,worker;
 try{
  ext=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://device.invalid');
   const respond=(status,x)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(x));};
   if(u.pathname==='/ledger'){
    const item=effects.get(u.searchParams.get('id'));
    if(!item){respond(404,{reason:'unknown-is-not-proof-of-nonexecution'});return;}
    respond(200,item);return;
   }
   if(u.pathname==='/apply'){
    const parts=[];for await(const b of req)parts.push(b);
    const op=JSON.parse(Buffer.concat(parts).toString());
    const prev=effects.get(op.id);
    const next={id:op.id,amount:op.amount,applied:(prev?.applied||0)+1};
    effects.set(op.id,next);respond(200,next);return;
   }
   respond(404,{reason:'not-found'});
  });
  await new Promise(ok=>ext.listen(0,'127.0.0.1',ok));const external='http://127.0.0.1:'+ext.address().port;
  const result=[];
  for(const mode of ['kill-stage','kill-rename','inflight']){
   const id='repair-'+mode,dir=join(root,mode);await mkdir(dir);
   const port=await freePort(),url='http://127.0.0.1:'+port;
   const w1=token(),o1=token(),w2=token(),o2=token();
   worker=launch(mode,dir,port,external,w1,o1);await worker.wait('READY');
   let health=await (await fetch(url+'/health')).json();assert.equal(health.ready,true);
   assert.equal(health.state.epoch,1);assert.equal(health.state.phase,'normal');
   const submit=(tok,epoch,requestId)=>post(url+'/effect',{id:requestId,amount:7},{'X-Worker-Token':tok,'X-Epoch':String(epoch)});
   // External effect is separate, controlled, and happens once before recovery.
   assert.equal((await submit(w1,1,id)).status,200);assert.equal(effects.get(id).applied,1);
   let unfinished,checkpoint;
   if(mode==='inflight'){
    unfinished=submit(w1,1,'inflight').then(()=> 'unexpected-response',()=> 'ambiguous');
    checkpoint='INFLIGHT';
   }else{
    unfinished=post(url+'/operator/begin',{id},{'X-Operator-Token':o1}).then(()=> 'unexpected-response',()=> 'ambiguous');
    checkpoint=mode==='kill-stage'?'AFTER_STAGE':'AFTER_RENAME';
   }
   await worker.wait(checkpoint);await worker.stop();worker=null;
   assert.equal(await Promise.race([unfinished,pause(6000).then(()=> 'timeout')]),'ambiguous');
   const rawBefore=await readFile(file(dir),'utf8');
   const stagedBefore=await readMaybe(stage(dir));
   if(mode==='kill-stage')assert.notEqual(stagedBefore,null);
   if(mode==='kill-rename')assert.equal(stagedBefore,null);
   worker=launch('normal',dir,port,external,w2,o2);await worker.wait('READY');
   health=await (await fetch(url+'/health')).json();assert.equal(health.ready,true);
   assert.equal(health.state.phase,'maintenance');
   assert.equal(health.state.ownerTag,null,'previous operator ownership is invalidated');
   assert.ok(health.state.epoch>=(mode==='inflight'?2:3),'restart advanced durable generation');
   if(mode!=='inflight')assert.equal(health.state.operation,id);
   else assert.equal(health.state.operation,null,'unknown inflight effect is not reconstructed as applied');
   assert.equal((await submit(w1,1,'stale-'+mode)).status,403);
   assert.equal((await post(url+'/operator/claim',{id},{'X-Operator-Token':o1})).status,403);
   assert.equal((await submit(w2,1,'wrong-generation-'+mode)).status,409);
   assert.equal((await submit(w2,health.state.epoch,'held-'+mode)).status,423);
   assert.equal(effects.has('held-'+mode),false);
   assert.equal(effects.has('inflight'),false);
   if(mode!=='inflight'){
    const own=await post(url+'/operator/claim',{id},{'X-Operator-Token':o2});assert.equal(own.status,200);
    const claimed=await (await fetch(url+'/health')).json();assert.equal(claimed.state.phase,'maintenance');
    assert.equal(claimed.state.ownerTag,hash(o2));
    assert.equal((await post(url+'/operator/end',{id},{'X-Operator-Token':o1})).status,403);
    const complete=await post(url+'/operator/end',{id},{'X-Operator-Token':o2});assert.equal(complete.status,200);
    const released=await (await fetch(url+'/health')).json();assert.equal(released.state.phase,'normal');
    assert.equal((await submit(w2,health.state.epoch,'stale-during-recovery')).status,409);
    assert.equal((await submit(w2,released.state.epoch,'fresh-'+mode)).status,200);
    assert.equal(effects.get('fresh-'+mode).applied,1);
   }else{
    assert.equal((await post(url+'/operator/claim',{id:'inflight'},{'X-Operator-Token':o2})).status,409);
    assert.equal(health.state.phase,'maintenance'); // intentionally no unsafe operator release
    // Negative control: the external test device remains reachable outside the supervisor.
    assert.equal((await post(external+'/apply',{id:'bypass-during-maintenance',amount:7})).status,200);
    assert.equal(effects.get('bypass-during-maintenance').applied,1);
   }
   result.push({mode,epoch:health.state.epoch,phaseAtRestart:health.state.phase,effectCount:effects.get(id).applied,
    initialStageBytes:stagedBefore===null?0:stagedBefore.length});
   await worker.stop('SIGTERM');worker=null;
  }
  // Corrupt stage at startup: do not discard it and do not silently reopen writes.
  const dir=join(root,'corrupt');await mkdir(dir);
  await writeFile(initialized(dir),'initialized-v1\n');
  await writeFile(file(dir),encode({epoch:1,phase:'normal',operation:null,ownerTag:null}));
  await writeFile(stage(dir),'TAMPERED');
  const port=await freePort(),url='http://127.0.0.1:'+port;
  worker=launch('normal',dir,port,external,token(),token());await worker.wait('READY');
  const health=await (await fetch(url+'/health')).json();assert.equal(health.ready,false);
  assert.equal((await post(url+'/effect',{id:'must-not-run',amount:7})).status,503);
  assert.equal(await readFile(stage(dir),'utf8'),'TAMPERED');
  assert.equal(effects.has('must-not-run'),false);
  await worker.stop('SIGTERM');worker=null;
  // Absent canonical state after known initialization must never re-bootstrap normal.
  const missing=join(root,'missing');await mkdir(missing);
  await writeFile(initialized(missing),'initialized-v1\n');
  const portMissing=await freePort(),baseMissing='http://127.0.0.1:'+portMissing;
  worker=launch('normal',missing,portMissing,external,token(),token());await worker.wait('READY');
  const absent=await (await fetch(baseMissing+'/health')).json();
  assert.equal(absent.ready,false);assert.equal(absent.error,'missing-initialized-state');
  assert.equal((await post(baseMissing+'/effect',{id:'lost-state',amount:7})).status,503);
  assert.equal(effects.has('lost-state'),false);
  await worker.stop('SIGTERM');worker=null;
  console.log('PASS SUPERVISOR REAL SIGKILL/RESTART: '+JSON.stringify(result)+
   '; old tokens/epochs rejected, recovery maintenance persistent, corrupt/missing state blocked, operator completion verified, external bypass remains possible');
 }finally{if(worker)await worker.stop();if(ext){ext.closeAllConnections();await new Promise(ok=>ext.close(ok));}
  await rm(root,{recursive:true,force:true});}
}
if(process.argv[2]==='--supervisor')await supervisor();else await main();
