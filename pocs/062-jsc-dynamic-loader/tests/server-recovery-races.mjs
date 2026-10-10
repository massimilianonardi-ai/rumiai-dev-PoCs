// PoC 062: real HTTP worker processes racing to reconcile one persisted application claim.
// This is an isolated application experiment, not a loader API or cross-host guarantee.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,open,readFile,writeFile,rename,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const bodyPost=(url,value)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const validId=id=>typeof id==='string'&&/^[a-z0-9-]{1,60}$/.test(id);
const claimPath=(dir,id)=>join(dir,'claim-'+id+'.json');
const lockPath=(dir,id)=>join(dir,'recovery-'+id+'.lock');
async function readClaim(path){
 try{
  const value=JSON.parse(await readFile(path,'utf8'));
  if(!validId(value.id)||!Number.isSafeInteger(value.amount)||value.amount<=0||
     !['pending','done','held'].includes(value.status))throw Error('untrusted claim');
  return value;
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function replaceClaim(path,value){
 const temp=path+'.stage-'+process.pid;
 const f=await open(temp,'wx');
 try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}
 await rename(temp,path); // tested process-level replacement, NOT power-cut durability
}
async function exclusive(path){
 try{return await open(path,'wx');}
 catch(e){if(e.code==='EEXIST')return null;throw e;}
}
async function listen(server){await new Promise(ok=>server.listen(0,'127.0.0.1',ok));return 'http://127.0.0.1:'+server.address().port;}
function launch(mode,dir,port,external){
 const proc=spawn(process.execPath,[import.meta.filename,'--worker',mode,dir,String(port),external],{stdio:['ignore','pipe','pipe']});
 let output='',errors='';const listeners=[];
 proc.stdout.on('data',chunk=>{
  output+=chunk.toString();
  for(const l of [...listeners])if(output.includes(l.mark)){
   listeners.splice(listeners.indexOf(l),1);clearTimeout(l.timer);l.resolve();
  }
 });
 proc.stderr.on('data',chunk=>errors+=chunk.toString());
 return {proc,wait(mark){if(output.includes(mark))return Promise.resolve();return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('missing '+mark+' '+errors+' '+output)),10000);
  listeners.push({mark,timer,resolve});
 });},async stop(signal='SIGKILL'){
  if(proc.exitCode===null&&proc.signalCode===null)proc.kill(signal);
  await new Promise(ok=>{if(proc.exitCode!==null||proc.signalCode!==null)ok();else proc.once('close',ok);});
 }};
}
async function worker(){
 const [mode,dir,port,external]=process.argv.slice(3);
 const server=http.createServer(async(req,res)=>{
  const route=new URL(req.url,'http://worker.invalid');
  res.setHeader('Cache-Control','no-store');
  const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(route.pathname==='/health'){respond(200,{ok:true});return;}
  let op;
  try{
   if(route.pathname==='/reconcile')op={id:route.searchParams.get('id')};
   else if(req.method==='POST'&&['/effect','/operator/hold'].includes(route.pathname)){
    const parts=[];for await(const part of req)parts.push(part);
    op=JSON.parse(Buffer.concat(parts).toString());
   }else{respond(404,{error:'unknown-route'});return;}
   if(!validId(op?.id)||((route.pathname!=='/reconcile')&&(!Number.isSafeInteger(op.amount)||op.amount<=0))){
    respond(400,{error:'invalid-operation'});return;
   }
   const file=claimPath(dir,op.id),lock=lockPath(dir,op.id);
   let current=await readClaim(file);
   if(route.pathname==='/effect'){
    if(current){
     if(current.amount!==op.amount){respond(409,{state:'payload-conflict'});return;}
     if(current.status==='done'){respond(200,{...current,replayed:true});return;}
     respond(current.status==='held'?423:503,{state:current.status});return;
    }
    const handle=await exclusive(file);
    if(!handle){respond(503,{state:'claim-race'});return;}
    try{await handle.writeFile(JSON.stringify({status:'pending',...op}));await handle.sync();}
    finally{await handle.close();}
    const effect=await bodyPost(external+'/apply',op);
    if(!effect.ok){respond(503,{state:'effect-uncertain'});return;}
    const reply=await effect.json();
    if(reply.id!==op.id||reply.amount!==op.amount||reply.applied!==1){respond(503,{state:'effect-receipt-inconsistent'});return;}
    await replaceClaim(file,{status:'done',...op,applied:1});
    respond(200,{status:'done',...op,applied:1,replayed:false});return;
   }
   if(!current){respond(503,{state:'missing-claim-not-proof-of-no-effect'});return;}
   if(route.pathname==='/operator/hold'&&current.amount!==op.amount){respond(409,{state:'payload-conflict'});return;}
   if(current.status==='done'){respond(200,{...current,replayed:true});return;}
   if(current.status==='held'){respond(423,{state:'operator-hold'});return;}
   const lockHandle=await exclusive(lock);
   if(!lockHandle){respond(503,{state:'recovery-in-progress-or-lock-abandoned'});return;}
   try{
    await lockHandle.writeFile(JSON.stringify({id:op.id,owner:process.pid}));await lockHandle.sync();
    if(mode==='crash-on-lock'&&route.pathname==='/reconcile'){
     process.stdout.write('LOCK_HELD\n');await new Promise(()=>{});return;
    }
    current=await readClaim(file); // reread after exclusive recovery ownership
    if(current?.status!=='pending'){respond(503,{state:'changed-during-recovery'});return;}
    if(route.pathname==='/operator/hold'){
     // Fixture operator explicitly quarantines uncertain work; never asserts applied/unapplied.
     await replaceClaim(file,{...current,status:'held',reason:'no-authoritative-receipt'});
     respond(200,{state:'held-without-effect-conclusion'});return;
    }
    const r=await fetch(external+'/ledger?id='+encodeURIComponent(op.id),{cache:'no-store'});
    if(!r.ok){respond(503,{state:'authoritative-answer-unavailable',status:r.status});return;}
    const actual=await r.json();
    if(actual.id!==current.id||actual.amount!==current.amount||actual.applied!==1){
     respond(503,{state:'authoritative-result-inconsistent'});return;
    }
    await replaceClaim(file,{...current,status:'done',applied:1});
    respond(200,{state:'reconciled',id:current.id,amount:current.amount,applied:1});return;
   }finally{await lockHandle.close();if(mode!=='crash-on-lock')await unlink(lock);}
  }catch(e){respond(500,{error:'fixture-server-error',message:e.message});}
 });
 await new Promise(ok=>server.listen(Number(port),'127.0.0.1',ok));process.stdout.write('READY\n');
}
async function port(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const n=s.address().port;await new Promise(ok=>s.close(ok));return n;}
async function main(){
 const dir=await mkdtemp(join(tmpdir(),'jsc-reconcile-races-'));
 let workers=[],external;
 const ledger=new Map(),lookups=new Map(),applications=new Map();
 let releaseFirst,firstStarted;const firstHeld=new Promise(ok=>firstStarted=ok),gate=new Promise(ok=>releaseFirst=ok);
 try{
  external=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://authority.invalid');
   if(u.pathname==='/ledger'){
    const id=u.searchParams.get('id');lookups.set(id,(lookups.get(id)||0)+1);
    if(id==='race'&&lookups.get(id)===1){firstStarted();await gate;}
    if(id==='offline'){res.statusCode=501;res.end('no authoritative lookup supported');return;}
    if(id==='absent'){res.statusCode=404;res.end('unknown, not necessarily unapplied');return;}
    const current=ledger.get(id);
    if(!current){res.statusCode=404;res.end('unknown');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(current));return;
   }
   if(u.pathname==='/apply'&&req.method==='POST'){
    const parts=[];for await(const chunk of req)parts.push(chunk);
    const op=JSON.parse(Buffer.concat(parts).toString());
    applications.set(op.id,(applications.get(op.id)||0)+1);
    const receipt={...op,applied:applications.get(op.id)};ledger.set(op.id,receipt);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(receipt));return;
   }
   res.statusCode=404;res.end('unknown');
  });
  const externalUrl=await listen(external);
  const shared=join(dir,'claims');await mkdir(shared);
  const op={id:'race',amount:7};
  await writeFile(claimPath(shared,op.id),JSON.stringify({...op,status:'pending'}));
  assert.equal((await bodyPost(externalUrl+'/apply',op)).status,200); // actual external HTTP effect
  const ports=await Promise.all(Array.from({length:4},()=>port()));
  workers=ports.map(p=>launch('normal',shared,p,externalUrl));await Promise.all(workers.map(w=>w.wait('READY')));
  const urls=ports.map(p=>'http://127.0.0.1:'+p);
  const first=fetch(urls[0]+'/reconcile?id=race');await firstHeld;
  const competing=await Promise.all(Array.from({length:12},(_,i)=>fetch(urls[i%4]+'/reconcile?id=race')));
  assert.ok(competing.every(r=>r.status===503));
  assert.equal(lookups.get('race'),1,'exactly one external lookup during locked race');
  const conflict=await bodyPost(urls[1]+'/effect',{id:'race',amount:8});assert.equal(conflict.status,409);
  const identical=await bodyPost(urls[2]+'/effect',op);assert.equal(identical.status,503);
  const unrelated=await bodyPost(urls[3]+'/effect',{id:'fresh',amount:2});assert.equal(unrelated.status,200);
  assert.equal(applications.get('fresh'),1);
  releaseFirst();assert.equal((await first).status,200);
  const after=await Promise.all(urls.map(u=>fetch(u+'/reconcile?id=race')));
  assert.ok(after.every(r=>r.status===200));
  assert.equal((await bodyPost(urls[0]+'/effect',op)).status,200);
  assert.equal(applications.get('race'),1,'reconciliation must not repeat actual external apply');
  assert.deepEqual(await readClaim(claimPath(shared,'race')),{id:'race',amount:7,status:'done',applied:1});
  assert.deepEqual(await readClaim(claimPath(shared,'fresh')),{id:'fresh',amount:2,status:'done',applied:1});
  await Promise.all(workers.map(w=>w.stop('SIGTERM')));workers=[];

  // An external system without authoritative lookup cannot supply proof for automatic retry.
  const heldDir=join(dir,'no-ledger');await mkdir(heldDir);
  await writeFile(claimPath(heldDir,'offline'),JSON.stringify({id:'offline',amount:11,status:'pending'}));
  workers=[launch('normal',heldDir,await port(),externalUrl)];await workers[0].wait('READY');
  let u='http://127.0.0.1:'+workers[0].proc.spawnargs.at(-2);
  assert.equal((await fetch(u+'/reconcile?id=offline')).status,503);
  assert.equal((await bodyPost(u+'/effect',{id:'offline',amount:11})).status,503);
  assert.equal((await bodyPost(u+'/operator/hold',{id:'offline',amount:12})).status,409);
  const hold=await bodyPost(u+'/operator/hold',{id:'offline',amount:11});
  assert.equal(hold.status,200);assert.equal((await hold.json()).state,'held-without-effect-conclusion');
  assert.equal((await fetch(u+'/reconcile?id=offline')).status,423);
  assert.equal((await bodyPost(u+'/effect',{id:'offline',amount:11})).status,423);
  assert.equal((await bodyPost(u+'/effect',{id:'offline',amount:12})).status,409);
  assert.equal((await bodyPost(u+'/effect',{id:'new-after-hold',amount:3})).status,200);
  assert.equal(applications.get('offline')||0,0);
  // Missing and corrupt claims must not be interpreted as evidence that work never occurred.
  assert.equal((await fetch(u+'/reconcile?id=missing')).status,503);
  await writeFile(claimPath(heldDir,'corrupt'),'\x00INVALID');
  assert.equal((await fetch(u+'/reconcile?id=corrupt')).status,500);
  assert.equal((await bodyPost(u+'/effect',{id:'corrupt',amount:5})).status,500);
  assert.equal(applications.get('corrupt')||0,0);
  await workers[0].stop('SIGTERM');workers=[];

  // Crash after acquiring the recovery lock: no PID/timeout-based silent lock stealing.
  const crashDir=join(dir,'crashlock');await mkdir(crashDir);
  await writeFile(claimPath(crashDir,'abandoned'),JSON.stringify({id:'abandoned',amount:17,status:'pending'}));
  assert.equal((await bodyPost(externalUrl+'/apply',{id:'abandoned',amount:17})).status,200);
  const portCrash=await port();workers=[launch('crash-on-lock',crashDir,portCrash,externalUrl)];await workers[0].wait('READY');
  const crashUrl='http://127.0.0.1:'+portCrash;
  const interrupted=fetch(crashUrl+'/reconcile?id=abandoned').then(()=> 'unexpected-response',()=> 'connection-lost');
  await workers[0].wait('LOCK_HELD');await workers[0].stop('SIGKILL');workers=[];
  assert.equal(await Promise.race([interrupted,sleep(5000).then(()=> 'timeout')]),'connection-lost');
  workers=[launch('normal',crashDir,portCrash,externalUrl)];await workers[0].wait('READY');
  assert.equal((await fetch(crashUrl+'/reconcile?id=abandoned')).status,503);
  assert.equal((await bodyPost(crashUrl+'/operator/hold',{id:'abandoned',amount:17})).status,503);
  assert.equal((await bodyPost(crashUrl+'/effect',{id:'abandoned',amount:17})).status,503);
  assert.deepEqual(await readClaim(claimPath(crashDir,'abandoned')),{id:'abandoned',amount:17,status:'pending'});
  assert.equal(lookups.get('abandoned')||0,0);
  console.log('PASS RECOVERY RACES: four HTTP workers, one authoritative lookup for 13 concurrent reconcile requests, conflict 409, pending 503, unrelated effect proceeds; no-ledger operator hold preserves uncertainty; SIGKILL lock remains blocked');
 }finally{
  if(releaseFirst)releaseFirst();
  await Promise.all(workers.map(w=>w.stop()));
  if(external){external.closeAllConnections();await new Promise(ok=>external.close(ok));}
  await rm(dir,{recursive:true,force:true});
 }
}
if(process.argv[2]==='--worker')await worker();else await main();
