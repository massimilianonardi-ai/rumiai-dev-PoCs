// PoC 062: Linux util-linux flock(-F) holds a local state-directory writer lock
// across the lifetime of a cooperating Node supervisor, independent of HTTP port.
// NOT a POSIX-wide facility, hostile-process barrier, distributed lock, or power-loss guarantee.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sha=s=>createHash('sha256').update(s).digest('hex');
const key=()=>randomBytes(24).toString('hex');
const sleep=ms=>new Promise(ok=>{const timer=setTimeout(ok,ms);timer.unref();});
const send=(url,data,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
const stateFile=dir=>join(dir,'state.json');
const stageFile=dir=>join(dir,'state.stage');
const markerFile=dir=>join(dir,'initialized.marker');
const lockFile=dir=>join(dir,'state-writer.lock');
const validId=x=>typeof x==='string'&&/^[a-z0-9-]{1,60}$/.test(x);
async function maybe(file){try{return await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const pack=s=>JSON.stringify({state:s,digest:sha(JSON.stringify(s))});
function unpack(raw){const j=JSON.parse(raw),s=j?.state;
 if(!s||sha(JSON.stringify(s))!==j.digest||!Number.isSafeInteger(s.epoch)||s.epoch<1||
 !['normal','maintenance'].includes(s.phase)||!(s.pending===null||(validId(s.pending?.id)&&s.pending.amount===7))||
 !(s.receipt===null||(validId(s.receipt?.id)&&s.receipt.amount===7&&s.receipt.applied===1))||
 (s.pending&&s.receipt))throw Error('untrusted-state');
 return s;
}
async function replace(dir,s){const h=await open(stageFile(dir),'wx');
 try{await h.writeFile(pack(s));await h.sync();}finally{await h.close();}
 await rename(stageFile(dir),stateFile(dir));
}
async function boot(dir){const mark=await maybe(markerFile(dir)),raw=await maybe(stateFile(dir)),stage=await maybe(stageFile(dir));
 if(mark===null){if(raw!==null||stage!==null)throw Error('unmarked-state');
  const h=await open(markerFile(dir),'wx');try{await h.writeFile('initialized-v1\n');await h.sync();}finally{await h.close();}
  const initial={epoch:1,phase:'normal',pending:null,receipt:null};await replace(dir,initial);return initial;
 }
 if(mark!=='initialized-v1\n'||raw===null)throw Error('missing-canonical-state');
 let s=unpack(raw);
 if(stage!==null){const t=unpack(stage);
  if(t.epoch!==s.epoch+1||t.phase!=='maintenance'||JSON.stringify(t.pending)!==JSON.stringify(s.pending)||
     JSON.stringify(t.receipt)!==JSON.stringify(s.receipt))throw Error('inconsistent-stage');
  await rename(stageFile(dir),stateFile(dir));s=t;
 }
 const recovered={...s,epoch:s.epoch+1,phase:'maintenance'};await replace(dir,recovered);return recovered;
}
async function port(){const x=http.createServer();await new Promise(ok=>x.listen(0,'127.0.0.1',ok));
 const n=x.address().port;await new Promise(ok=>x.close(ok));return n;}
function start(dir,p,device,workerToken,operatorToken,{guarded=true}={}){
 const args=[import.meta.filename,'--supervisor',dir,String(p),device,workerToken,operatorToken];
 const cmd=guarded?'flock':process.execPath;
 const argv=guarded?['-n','-E','73','-F',lockFile(dir),process.execPath,...args]:args;
 const child=spawn(cmd,argv,{stdio:['ignore','pipe','pipe']});let output='',errors='';
 let settle;const outcome=new Promise(ok=>settle=ok);
 child.stdout.on('data',b=>{output+=b.toString();if(output.includes('READY\n'))settle('ready');});
 child.stderr.on('data',b=>errors+=b.toString());
 child.once('close',(code,signal)=>settle(code===73?'busy':'exited:'+code+':'+signal+':'+errors));
 return {child,workerToken,operatorToken,guarded,outcome:Promise.race([outcome,sleep(12000).then(()=>{throw Error('startup timeout '+output+' '+errors);})]),
  async stop(signal='SIGKILL'){if(child.exitCode===null&&child.signalCode===null)child.kill(signal);
   await new Promise(ok=>{if(child.exitCode!==null||child.signalCode!==null)ok();else child.once('close',ok);});},
  get output(){return output;}};
}
async function supervisor(){const [dir,portString,device,workerToken,operatorToken]=process.argv.slice(3);
 let state,error=null,working=false;
 try{state=await boot(dir);}catch(e){error=e.message;}
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://supervisor.invalid');
  const answer=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(u.pathname==='/health'){answer(200,{ready:error===null,state,error});return;}
  if(error){answer(503,{reason:'untrusted-state',error});return;}
  let op;try{const b=[];for await(const x of req)b.push(x);op=JSON.parse(Buffer.concat(b).toString()||'{}');}
  catch{answer(400,{reason:'bad-json'});return;}
  if(u.pathname==='/effect'){
   if(req.headers['x-worker-token']!==workerToken){answer(403,{reason:'unknown-worker'});return;}
   if(Number(req.headers['x-epoch'])!==state.epoch){answer(409,{reason:'stale-generation'});return;}
   if(state.phase!=='normal'){answer(423,{reason:'maintenance'});return;}
   if(!validId(op.id)||op.amount!==7){answer(400,{reason:'bad-operation'});return;}
   if(state.receipt?.id===op.id){answer(200,{...state.receipt,replayed:true});return;}
   if(state.pending||state.receipt||working){answer(503,{reason:'pending-or-busy'});return;}
   working=true;
   try{
    const next={...state,pending:{id:op.id,amount:7}};await replace(dir,next);state=next;
    process.stdout.write('PENDING_SYNCED '+op.id+'\n');
    const response=await send(device+'/apply',op);
    if(!response.ok){answer(503,{reason:'external-uncertain'});return;}
    const receipt=await response.json();
    if(receipt.id!==op.id||receipt.amount!==7||receipt.applied!==1){answer(503,{reason:'receipt-inconsistent'});return;}
    const done={...state,pending:null,receipt};await replace(dir,done);state=done;
    answer(200,{...receipt,replayed:false});
   }catch(e){error='effect-state-fault';answer(503,{reason:'effect-state-fault'});}
   finally{working=false;}
   return;
  }
  if(u.pathname==='/reconcile'){
   if(req.headers['x-operator-token']!==operatorToken){answer(403,{reason:'unknown-operator'});return;}
   if(state.phase!=='maintenance'){answer(409,{reason:'not-in-maintenance'});return;}
   if(working){answer(503,{reason:'recovery-busy'});return;}
   if(!validId(op.id)||op.id!==(state.pending??state.receipt)?.id){answer(409,{reason:'mismatched-id'});return;}
   working=true;
   try{const r=await fetch(device+'/ledger?id='+encodeURIComponent(op.id));
    if(!r.ok){answer(503,{reason:'authority-unavailable',status:r.status});return;}
    const receipt=await r.json();
    if(receipt.id!==op.id||receipt.amount!==7||receipt.applied!==1){answer(503,{reason:'authority-disagreement'});return;}
    const next={epoch:state.epoch+1,phase:'normal',pending:null,receipt};await replace(dir,next);state=next;
    answer(200,{status:'reconciled',epoch:state.epoch});
   }catch(e){error='reconcile-state-fault';answer(503,{reason:'reconcile-state-fault'});}
   finally{working=false;}
   return;
  }
  answer(404,{reason:'missing-route'});
 });
 await new Promise(ok=>server.listen(Number(portString),'127.0.0.1',ok));process.stdout.write('READY\n');
}
async function main(){
 if(process.platform!=='linux'){
  console.log('SKIP SUPERVISOR DIRECTORY FILE LOCK: requires Linux util-linux flock -F; no cross-platform claim');
  return;
 }
 const have=spawnSync('flock',['--version'],{encoding:'utf8'});
 assert.equal(have.status,0,'requires util-linux flock on this Linux test host');
 const root=await mkdtemp(join(tmpdir(),'poc062-directory-lock-'));
 const effects=new Map(),children=[];let device,releaseHold,notifyHold;
 const blocked=new Promise(ok=>notifyHold=ok),gate=new Promise(ok=>releaseHold=ok);
 try{
  device=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://device.invalid');
   const answer=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
   if(u.pathname==='/ledger'){const r=effects.get(u.searchParams.get('id'));
    if(!r){answer(404,{reason:'unknown-not-proof-of-no-effect'});return;}answer(200,r);return;}
   if(u.pathname==='/apply'){
    const b=[];for await(const x of req)b.push(x);const op=JSON.parse(Buffer.concat(b).toString());
    const previous=effects.get(op.id),next={id:op.id,amount:op.amount,applied:(previous?.applied||0)+1};
    effects.set(op.id,next);
    if(op.id==='held-after-apply'){notifyHold();await gate;}
    answer(200,next);return;
   }
   answer(404,{reason:'unknown-endpoint'});
  });
  await new Promise(ok=>device.listen(0,'127.0.0.1',ok));const url='http://127.0.0.1:'+device.address().port;
  const dir=join(root,'cooperating');await mkdir(dir);
  const ports=await Promise.all(Array.from({length:8},()=>port()));
  assert.equal(new Set(ports).size,8);
  const contenders=ports.map(p=>start(dir,p,url,key(),key()));children.push(...contenders);
  const outcomes=await Promise.all(contenders.map(c=>c.outcome));
  assert.equal(outcomes.filter(x=>x==='ready').length,1,'one lock owner despite distinct HTTP ports');
  assert.equal(outcomes.filter(x=>x==='busy').length,7,'kernel locks exclude other endpoints');
  const winner=contenders[outcomes.indexOf('ready')],oldPort=ports[outcomes.indexOf('ready')];
  const base='http://127.0.0.1:'+oldPort;
  const effect=(url,w,epoch,id)=>send(url+'/effect',{id,amount:7},{'X-Worker-Token':w,'X-Epoch':String(epoch)});
  const reconcile=(url,k,id)=>send(url+'/reconcile',{id},{'X-Operator-Token':k});
  let health=await (await fetch(base+'/health')).json();assert.equal(health.ready,true);assert.equal(health.state.epoch,1);
  const persistent=await readFile(stateFile(dir));
  await Promise.all(contenders.filter(x=>x!==winner).map(x=>x.stop()));
  assert.deepEqual(await readFile(stateFile(dir)),persistent,'lock losers never touched the shared revision');
  const pending=effect(base,winner.workerToken,1,'held-after-apply').then(()=> 'unexpected-response',()=> 'connection-lost');
  await blocked;assert.equal(effects.get('held-after-apply').applied,1);
  const pendingState=unpack(await readFile(stateFile(dir),'utf8'));
  assert.deepEqual(pendingState.pending,{id:'held-after-apply',amount:7});
  // A contender on another port is excluded even while the owner waits for device reply.
  const altPort=await port();assert.notEqual(altPort,oldPort);
  const contender=start(dir,altPort,url,key(),key());children.push(contender);assert.equal(await contender.outcome,'busy');
  await winner.stop('SIGKILL');assert.equal(await Promise.race([pending,sleep(5000).then(()=> 'timeout')]),'connection-lost');
  releaseHold();
  const next=start(dir,altPort,url,key(),key());children.push(next);assert.equal(await next.outcome,'ready');
  const nextBase='http://127.0.0.1:'+altPort;
  health=await (await fetch(nextBase+'/health')).json();
  assert.equal(health.ready,true);assert.equal(health.state.epoch,2);assert.equal(health.state.phase,'maintenance');
  assert.deepEqual(health.state.pending,{id:'held-after-apply',amount:7});
  assert.equal((await effect(nextBase,winner.workerToken,1,'held-after-apply')).status,403);
  assert.equal((await effect(nextBase,next.workerToken,1,'held-after-apply')).status,409);
  assert.equal((await effect(nextBase,next.workerToken,2,'held-after-apply')).status,423);
  assert.equal((await reconcile(nextBase,next.operatorToken,'held-after-apply')).status,200);
  const final=await (await fetch(nextBase+'/health')).json();
  assert.equal(final.state.epoch,3);assert.equal(final.state.phase,'normal');
  assert.equal(unpack(await readFile(stateFile(dir),'utf8')).epoch,3);
  const replay=await effect(nextBase,next.workerToken,3,'held-after-apply');
  assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
  assert.equal(effects.get('held-after-apply').applied,1,'no duplicate external operation');
  // No concurrent replacement writer can regress the generation while this owner lives.
  const third=start(dir,await port(),url,key(),key());children.push(third);assert.equal(await third.outcome,'busy');
  assert.equal(unpack(await readFile(stateFile(dir),'utf8')).epoch,3);
  await next.stop('SIGTERM');
  console.log('PASS SUPERVISOR DIRECTORY FILE LOCK: eight distinct HTTP ports -> one Linux kernel-held lock owner; seven denied without mutation; mid-external-response SIGKILL releases lock; successor on another port starts epoch 2 maintenance, reconciles one real effect without repeat, retains epoch 3; remaining contender denied');
 }finally{
  releaseHold?.();await Promise.all(children.map(c=>c.stop()));
  if(device){device.closeAllConnections();await new Promise(ok=>device.close(ok));}
  await rm(root,{recursive:true,force:true});
 }
}
if(process.argv[2]==='--supervisor')await supervisor();else await main();
