// PoC 062: real multi-process supervisor ownership and post-dispatch SIGKILL.
// A same-host TCP listener gives one cooperative local owner; external HTTP effects
// and local receipts still have no atomic boundary. Not a production security protocol.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,open,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const hash=x=>createHash('sha256').update(x).digest('hex');
const secret=()=>randomBytes(24).toString('hex');
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
const send=(u,x,headers={})=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(x)});
const stateFile=d=>join(d,'supervisor.json');
const stageFile=d=>join(d,'supervisor.stage');
const markFile=d=>join(d,'supervisor.initialized');
const validId=x=>typeof x==='string'&&/^[a-z0-9-]{1,50}$/.test(x);
async function maybe(file){try{return await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const encode=s=>JSON.stringify({state:s,sha256:hash(JSON.stringify(s))});
function decode(raw){const env=JSON.parse(raw),s=env?.state;
 if(!s||env.sha256!==hash(JSON.stringify(s))||!Number.isSafeInteger(s.epoch)||s.epoch<1||
 !['normal','maintenance'].includes(s.phase)||!(s.pending===null||(validId(s.pending?.id)&&s.pending.amount===7))||
 !(s.receipt===null||(validId(s.receipt?.id)&&s.receipt.amount===7&&s.receipt.applied===1)))throw Error('invalid-supervisor-envelope');
 if(s.pending&&s.receipt)throw Error('pending-and-done');return s;
}
async function commit(dir,state){
 const h=await open(stageFile(dir),'wx');
 try{await h.writeFile(encode(state));await h.sync();}finally{await h.close();}
 await rename(stageFile(dir),stateFile(dir)); // not evidence for power-loss/directory durability
}
async function bootstrap(dir){
 const initial=await maybe(markFile(dir));let canonical=await maybe(stateFile(dir));let stage=await maybe(stageFile(dir));
 if(initial===null){
  if(canonical!==null||stage!==null)throw Error('state-without-initialization');
  const marker=await open(markFile(dir),'wx');
  try{await marker.writeFile('initialized-v1\n');await marker.sync();}finally{await marker.close();}
  const fresh={epoch:1,phase:'normal',pending:null,receipt:null};await commit(dir,fresh);return fresh;
 }
 if(initial!=='initialized-v1\n'||canonical===null)throw Error('missing-or-invalid-initialized-state');
 let current=decode(canonical);
 if(stage!==null){
  const candidate=decode(stage);
  if(candidate.epoch!==current.epoch+1||candidate.phase!=='maintenance'||
    JSON.stringify(candidate.pending)!==JSON.stringify(current.pending)||
    JSON.stringify(candidate.receipt)!==JSON.stringify(current.receipt))throw Error('unknown-partial-transition');
  await rename(stageFile(dir),stateFile(dir));current=candidate;
 }
 const recovering={...current,epoch:current.epoch+1,phase:'maintenance'};
 await commit(dir,recovering);return recovering;
}
function launch(dir,port,device,workerKey,operatorKey){
 const child=spawn(process.execPath,[import.meta.filename,'--supervisor',dir,String(port),device,workerKey,operatorKey],{stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';const waits=[];
 child.stdout.on('data',b=>{stdout+=b.toString();for(const w of [...waits])if(stdout.includes(w.mark)){waits.splice(waits.indexOf(w),1);clearTimeout(w.timer);w.ok();}});
 child.stderr.on('data',b=>stderr+=b.toString());
 return {child,workerKey,operatorKey,wait(mark){if(stdout.includes(mark))return Promise.resolve();return new Promise((ok,fail)=>{
  const timer=setTimeout(()=>fail(Error('child waiting for '+mark+' stdout='+stdout+' stderr='+stderr)),12000);
  waits.push({mark,timer,ok});
 });},async stop(signal='SIGKILL'){
  if(child.exitCode===null&&child.signalCode===null)child.kill(signal);
  await new Promise(ok=>{if(child.exitCode!==null||child.signalCode!==null)ok();else child.once('close',ok);});
 },get stdout(){return stdout;},get stderr(){return stderr;}};
}
async function freePort(){const s=http.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
async function supervisor(){
 const [dir,p,device,workerKey,operatorKey]=process.argv.slice(3);
 const server=http.createServer();
 try{await new Promise((ok,fail)=>{server.once('error',fail);server.listen(Number(p),'127.0.0.1',ok);});}
 catch(e){if(e.code==='EADDRINUSE'){process.stdout.write('BUSY\n');return;}throw e;}
 // Binding before reading/writing state ensures one cooperating local supervisor.
 let state=null,fault=null,busy=false;
 try{state=await bootstrap(dir);}catch(e){fault=e.message;}
 server.on('request',async(req,res)=>{
  const route=new URL(req.url,'http://supervisor.invalid');
  const reply=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
  if(route.pathname==='/health'){reply(200,{ready:!fault,state,error:fault});return;}
  if(fault){reply(503,{reason:'untrusted-supervisor-state',error:fault});return;}
  let op;
  try{const chunks=[];for await(const c of req)chunks.push(c);op=JSON.parse(Buffer.concat(chunks).toString()||'{}');}
  catch{reply(400,{reason:'bad-json'});return;}
  if(route.pathname==='/effect'){
   if(req.headers['x-worker-token']!==workerKey){reply(403,{reason:'invalid-worker'});return;}
   if(Number(req.headers['x-epoch'])!==state.epoch){reply(409,{reason:'stale-epoch'});return;}
   if(state.phase!=='normal'){reply(423,{reason:'maintenance'});return;}
   if(!validId(op.id)||op.amount!==7){reply(400,{reason:'bad-operation'});return;}
   if(state.receipt?.id===op.id){reply(200,{...state.receipt,replayed:true});return;}
   if(state.pending){reply(503,{reason:'unreconciled-pending'});return;}
   if(state.receipt){reply(503,{reason:'fixture-one-effect-slot'});return;}
   if(busy){reply(503,{reason:'concurrent-effect'});return;}
   busy=true;
   try{
    const next={...state,pending:{id:op.id,amount:7}};
    await commit(dir,next);state=next;
    process.stdout.write('DISPATCH '+op.id+'\n');
    const remote=await send(device+'/apply',op);
    if(!remote.ok){reply(503,{reason:'external-outcome-unknown'});return;}
    const receipt=await remote.json();
    if(receipt.id!==op.id||receipt.amount!==7||receipt.applied!==1){reply(503,{reason:'untrusted-remote-receipt'});return;}
    const done={...state,pending:null,receipt};await commit(dir,done);state=done;
    reply(200,{...receipt,replayed:false});
   }catch(e){fault='effect-execution-uncertain';reply(503,{reason:'effect-execution-uncertain'});}
   finally{busy=false;}
   return;
  }
  if(!['/operator/reconcile','/operator/resume'].includes(route.pathname)){reply(404,{reason:'unknown-route'});return;}
  if(req.headers['x-operator-token']!==operatorKey){reply(403,{reason:'unauthorized-operator'});return;}
  if(state.phase!=='maintenance'){reply(409,{reason:'not-in-maintenance'});return;}
  if(busy){reply(503,{reason:'operation-in-flight'});return;}
  busy=true;
  try{
   const known=state.pending??state.receipt;
   if(!known||op.id!==known.id){reply(409,{reason:'incorrect-recovery-id'});return;}
   const external=await fetch(device+'/ledger?id='+encodeURIComponent(known.id));
   if(!external.ok){reply(503,{reason:'authority-unavailable',status:external.status});return;}
   const seen=await external.json();
   if(seen.id!==known.id||seen.amount!==7||seen.applied!==1){reply(503,{reason:'authority-inconsistent'});return;}
   const next={epoch:state.epoch+1,phase:'normal',pending:null,receipt:seen};
   await commit(dir,next);state=next;reply(200,{state:'verified-and-resumed',epoch:state.epoch});
  }catch(e){fault='reconciliation-write-uncertain';reply(503,{reason:'reconciliation-write-uncertain'});}
  finally{busy=false;}
 });
 process.stdout.write('READY\n');
}
async function main(){
 const root=await mkdtemp(join(tmpdir(),'poc062-concurrent-supervisors-'));
 const receipts=new Map(),applyCount=new Map(),held=[];let device;const children=[];
 let release,notify;const started=new Promise(ok=>notify=ok),unblock=new Promise(ok=>release=ok);
 try{
  device=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://device.invalid');
   const respond=(code,o)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
   if(u.pathname==='/ledger'){
    const entry=receipts.get(u.searchParams.get('id'));
    if(!entry){respond(404,{state:'not-authoritative-nonexecution'});return;}
    respond(200,entry);return;
   }
   if(u.pathname==='/apply'){
    const parts=[];for await(const b of req)parts.push(b);const op=JSON.parse(Buffer.concat(parts).toString());
    const count=(applyCount.get(op.id)||0)+1;applyCount.set(op.id,count);
    const receipt={id:op.id,amount:op.amount,applied:count};receipts.set(op.id,receipt);
    if(op.id==='after-dispatch'){held.push(res);notify();await unblock;}
    respond(200,receipt);return;
   }
   respond(404,{reason:'no-route'});
  });
  await new Promise(ok=>device.listen(0,'127.0.0.1',ok));
  const external='http://127.0.0.1:'+device.address().port;
  // Eight real processes contend for exactly one loopback port and shared state.
  const d1=join(root,'race');await mkdir(d1);const p1=await freePort(),base1='http://127.0.0.1:'+p1;
  const contenders=Array.from({length:8},()=>launch(d1,p1,external,secret(),secret()));children.push(...contenders);
  await Promise.all(contenders.map(async c=>{
   await Promise.race([c.wait('READY'),c.wait('BUSY')]);
  }));
  const winners=contenders.filter(c=>c.stdout.includes('READY'));
  assert.equal(winners.length,1,'exactly one successful local socket bind');
  assert.equal(contenders.filter(c=>c.stdout.includes('BUSY')).length,7);
  const owner=winners[0];
  let health=await (await fetch(base1+'/health')).json();assert.equal(health.ready,true);
  assert.equal(health.state.epoch,1);
  const effect=(url,key,epoch,id)=>send(url+'/effect',{id,amount:7},{'X-Worker-Token':key,'X-Epoch':String(epoch)});
  const op=(url,key,id)=>send(url+'/operator/reconcile',{id},{'X-Operator-Token':key});
  assert.equal((await effect(base1,owner.workerKey,1,'race-effect')).status,200);
  assert.equal(applyCount.get('race-effect'),1);
  const stateBefore=await readFile(stateFile(d1));
  await Promise.all(contenders.filter(c=>c!==owner).map(c=>c.stop('SIGTERM')));
  assert.deepEqual(await readFile(stateFile(d1)),stateBefore,'losing supervisors cannot mutate state');
  await owner.stop('SIGKILL');
  const reboot=launch(d1,p1,external,secret(),secret());children.push(reboot);await reboot.wait('READY');
  health=await (await fetch(base1+'/health')).json();assert.equal(health.ready,true);
  assert.equal(health.state.phase,'maintenance');assert.equal(health.state.epoch,2);
  assert.equal((await effect(base1,owner.workerKey,1,'stale-owner')).status,403);
  assert.equal((await effect(base1,reboot.workerKey,1,'stale-revision')).status,409);
  assert.equal((await effect(base1,reboot.workerKey,2,'new-during-maintenance')).status,423);
  assert.equal((await op(base1,owner.operatorKey,'race-effect')).status,403);
  assert.equal((await op(base1,reboot.operatorKey,'race-effect')).status,200);
  assert.equal(applyCount.get('race-effect'),1);
  await reboot.stop('SIGTERM');

  // A separate external HTTP server actually applies the effect then withholds reply.
  const d2=join(root,'post-dispatch');await mkdir(d2);const p2=await freePort(),base2='http://127.0.0.1:'+p2;
  const interrupted=launch(d2,p2,external,secret(),secret());children.push(interrupted);await interrupted.wait('READY');
  const pending=effect(base2,interrupted.workerKey,1,'after-dispatch').then(()=> 'unexpected-response',()=> 'connection-lost');
  await started;assert.equal(applyCount.get('after-dispatch'),1);
  await interrupted.stop('SIGKILL');
  assert.equal(await Promise.race([pending,pause(5000).then(()=> 'timeout')]),'connection-lost');
  release();
  const restarted=launch(d2,p2,external,secret(),secret());children.push(restarted);await restarted.wait('READY');
  const recovered=await (await fetch(base2+'/health')).json();
  assert.equal(recovered.ready,true);assert.equal(recovered.state.phase,'maintenance');
  assert.deepEqual(recovered.state.pending,{id:'after-dispatch',amount:7});assert.equal(recovered.state.receipt,null);
  assert.equal((await effect(base2,restarted.workerKey,recovered.state.epoch,'after-dispatch')).status,423);
  assert.equal((await effect(base2,interrupted.workerKey,1,'after-dispatch')).status,403);
  assert.equal(applyCount.get('after-dispatch'),1);
  const reconciled=await op(base2,restarted.operatorKey,'after-dispatch');assert.equal(reconciled.status,200);
  const latest=await (await fetch(base2+'/health')).json();assert.equal(latest.state.phase,'normal');
  const replay=await effect(base2,restarted.workerKey,latest.state.epoch,'after-dispatch');
  assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
  assert.equal(applyCount.get('after-dispatch'),1);
  await restarted.stop('SIGTERM');
  // Negative control: a ledger with two effects cannot authorize a recovered receipt.
  const d3=join(root,'inconsistent');await mkdir(d3);
  const p3=await freePort(),base3='http://127.0.0.1:'+p3;
  const inconsistent=launch(d3,p3,external,secret(),secret());children.push(inconsistent);await inconsistent.wait('READY');
  // Fixture-held external apply already occurred once, and then an independent uncontrolled apply duplicates it.
  const start=effect(base3,inconsistent.workerKey,1,'inconsistent-id');assert.equal((await start).status,200);
  await inconsistent.stop('SIGTERM');
  const direct=await send(external+'/apply',{id:'inconsistent-id',amount:7});assert.equal(direct.status,200);
  assert.equal(applyCount.get('inconsistent-id'),2);
  const restartedBad=launch(d3,p3,external,secret(),secret());children.push(restartedBad);await restartedBad.wait('READY');
  const refusal=await op(base3,restartedBad.operatorKey,'inconsistent-id');assert.equal(refusal.status,503);
  assert.equal((await (await fetch(base3+'/health')).json()).state.phase,'maintenance');
  await restartedBad.stop('SIGTERM');
  // Negative control: binding uniqueness is not a lock on the state directory.
  // A second service on a DIFFERENT port can enter maintenance while the old
  // service keeps its prior in-memory normal epoch and overwrites disk state.
  const d4=join(root,'different-ports');await mkdir(d4);
  const p4a=await freePort(),p4b=await freePort();
  assert.notEqual(p4a,p4b);
  const splitA=launch(d4,p4a,external,secret(),secret());children.push(splitA);
  await splitA.wait('READY');
  const splitB=launch(d4,p4b,external,secret(),secret());children.push(splitB);
  await splitB.wait('READY');
  const addrA='http://127.0.0.1:'+p4a,addrB='http://127.0.0.1:'+p4b;
  const beforeSplit=await (await fetch(addrB+'/health')).json();
  assert.equal(beforeSplit.state.phase,'maintenance');assert.equal(beforeSplit.state.epoch,2);
  assert.equal((await (await fetch(addrA+'/health')).json()).state.phase,'normal');
  assert.equal((await effect(addrA,splitA.workerKey,1,'unguarded-split-brain')).status,200);
  assert.equal(applyCount.get('unguarded-split-brain'),1);
  const diskSplit=decode(await readFile(stateFile(d4),'utf8'));
  assert.equal(diskSplit.epoch,1,'stale original owner overwrote newer epoch: negative control');
  assert.equal((await (await fetch(addrB+'/health')).json()).state.epoch,2);
  await Promise.all([splitA.stop('SIGTERM'),splitB.stop('SIGTERM')]);
  console.log('PASS SUPERVISOR MULTI-PROCESS + POST-DISPATCH SIGKILL: 8 contenders -> 1 bound owner; loser state untouched; restarted epoch 2 maintenance; killed after real external apply and missing receipt -> verified single effect recovery without replay; inconsistent double-apply refused; DIFFERENT port negative control shows stale original process can still apply and roll back disk epoch');
 }finally{
  release?.();
  await Promise.all(children.map(c=>c.stop()));
  if(device){device.closeAllConnections();await new Promise(ok=>device.close(ok));}
  await rm(root,{recursive:true,force:true});
 }
}
if(process.argv[2]==='--supervisor')await supervisor();else await main();
