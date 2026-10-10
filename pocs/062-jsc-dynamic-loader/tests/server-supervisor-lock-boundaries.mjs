// PoC 062: Linux-specific advisory-lock boundaries, isolated from jsc and its loader.
// Real kernel flock, independent Node processes, unlink/recreation, inherited fd and bypass.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, readdir, unlink, stat, rm} from 'node:fs/promises';
import {statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const file=(dir,name)=>join(dir,name);
const fdProbe=(lock)=>spawnSync('flock',['-n','-E','73',lock,'true'],{encoding:'utf8'});
async function until(fn,description){for(let n=0;n<160;n++){if(await fn())return;await sleep(25);}throw Error('checkpoint timeout: '+description);}
function keeper(lock,dir,mode){
 const p=spawn('flock',['-n','-E','73','-F',lock,process.execPath,import.meta.filename,'--keeper',mode,dir,lock],{stdio:['ignore','pipe','pipe']});
 let out='',err='';
 p.stdout.on('data',b=>out+=b.toString());p.stderr.on('data',b=>err+=b.toString());
 return {p,async ready(){await until(()=>out.includes('READY\n')||p.exitCode!==null,'keeper '+mode);assert.ok(out.includes('READY\n'),'keeper '+mode+' died ('+p.exitCode+'): '+out+' '+err);},
  async close(){if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');await new Promise(ok=>p.exitCode!==null||p.signalCode!==null?ok():p.once('close',ok));},
  get out(){return out;},get err(){return err;}};
}
async function keeperProcess(){
 const [mode,dir,lock]=process.argv.slice(3);
 if(mode==='inherit'){
  const lockStat=await stat(lock);let lockfd=null;
  for(const name of await readdir('/proc/self/fd')){
   if(!/^\d+$/.test(name)||Number(name)<3)continue;
   try{const s=statSync('/proc/self/fd/'+name);if(s.ino===lockStat.ino&&s.dev===lockStat.dev){lockfd=Number(name);break;}}
   catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(lockfd===null)throw Error('flock holder FD not visible');
  const descendant=spawn(process.execPath,[import.meta.filename,'--inherited-sleeper'],{stdio:['ignore','ignore','ignore',lockfd],detached:true});
  descendant.unref();process.stdout.write('READY\nDESCENDANT '+descendant.pid+'\n');return;
 }
 process.stdout.write('READY\n');
 // Keep this process alive so a lock is held throughout the observed checkpoint.
 const lifetime=setInterval(()=>{},1000);
 if(mode==='old'||mode==='new'){
  const desired=mode==='old'?1:2;
  const timer=setInterval(async()=>{
   try{await stat(file(dir,'go-'+mode));}catch(e){if(e.code==='ENOENT')return;throw e;}
   clearInterval(timer);
   await writeFile(file(dir,'state.json'),JSON.stringify({epoch:desired,writer:mode}));
   await writeFile(file(dir,'done-'+mode),'done');
  },20);
 }
 await new Promise(()=>{});
}
async function inheritedSleeper(){
 // File descriptor 3 was explicitly inherited; no child PID/timeout lock reclamation.
 assert.ok(statSync('/proc/self/fd/3').isFile());
 setInterval(()=>{},1000);
 await new Promise(()=>{});
}
async function bypass(){
 const [dir,device]=process.argv.slice(3);
 await writeFile(file(dir,'state.json'),JSON.stringify({epoch:999,writer:'noncooperative'}));
 const response=await fetch(device+'/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'direct',amount:7})});
 assert.equal(response.status,200);process.stdout.write('BYPASSED\n');
}
async function main(){
 if(process.platform!=='linux'){console.log('SKIP LOCK BOUNDARIES: Linux-specific flock/procfs scenarios');return;}
 assert.equal(spawnSync('flock',['--version']).status,0,'util-linux flock required');
 const root=await mkdtemp(join(tmpdir(),'poc062-lock-boundaries-'));const active=[];let device;
 let inheritedPid;
 try{
  // 1. Advisory lock attaches to an inode, not to a pathname that may be deleted/recreated.
  const dir=file(root,'unlink');await mkdir(dir);const lock=file(dir,'state-writer.lock');await writeFile(lock,'original');
  const oldInode=(await stat(lock)).ino;
  const old=keeper(lock,dir,'old');active.push(old);await old.ready();assert.equal(fdProbe(lock).status,73);
  await unlink(lock);await writeFile(lock,'replacement');assert.notEqual((await stat(lock)).ino,oldInode);
  const newer=keeper(lock,dir,'new');active.push(newer);await newer.ready();
  await writeFile(file(dir,'go-new'),'go');await until(async()=>!!(await exists(file(dir,'done-new'))),'new writer');
  assert.equal(JSON.parse(await readFile(file(dir,'state.json'))).epoch,2);
  await writeFile(file(dir,'go-old'),'go');await until(async()=>!!(await exists(file(dir,'done-old'))),'old writer');
  assert.equal(JSON.parse(await readFile(file(dir,'state.json'))).epoch,1,'real stale writer rollback after inode replacement');
  await Promise.all([old.close(),newer.close()]);
  // 2. Linux directory inode lock ignores replacement of a *separate lock-file name*.
  const dir2=file(root,'directory');await mkdir(dir2);const marker=file(dir2,'state-writer.lock');await writeFile(marker,'original');
  const keeperDir=keeper(dir2,dir2,'idle');active.push(keeperDir);await keeperDir.ready();
  await unlink(marker);await writeFile(marker,'replacement');assert.equal(fdProbe(dir2).status,73);
  await keeperDir.close();assert.equal(fdProbe(dir2).status,0);
  // 3. Open lock description survives original owner exit if inherited by a child.
  const dir3=file(root,'inherit');await mkdir(dir3);const lock3=file(dir3,'writer.lock');await writeFile(lock3,'lock');
  const launcher=keeper(lock3,dir3,'inherit');active.push(launcher);
  await until(()=>launcher.out.includes('DESCENDANT '),'descendant PID');
  inheritedPid=Number(/DESCENDANT (\d+)/.exec(launcher.out)[1]);assert.ok(Number.isInteger(inheritedPid));
  await launcher.close();
  assert.equal(fdProbe(lock3).status,73,'inherited fd keeps lock despite original owner termination');
  process.kill(inheritedPid,'SIGKILL');inheritedPid=null;
  await until(()=>fdProbe(lock3).status===0,'descriptor close after descendant SIGKILL');
  // 4. Lock is advisory: a process can write the state and talk directly to the device.
  const dir4=file(root,'bypass');await mkdir(dir4);const lock4=file(dir4,'writer.lock');await writeFile(lock4,'lock');
  let applied=0;
  device=http.createServer(async(req,res)=>{if(req.url==='/apply'){const parts=[];for await(const part of req)parts.push(part);applied+=1;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({applied}));return;}res.writeHead(404);res.end();});
  await new Promise(ok=>device.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+device.address().port;
  const trusted=keeper(lock4,dir4,'idle');active.push(trusted);await trusted.ready();assert.equal(fdProbe(lock4).status,73);
  const rogue=spawn(process.execPath,[import.meta.filename,'--bypass',dir4,origin],{stdio:['ignore','pipe','pipe']});
  let out='',err='';rogue.stdout.on('data',b=>out+=b.toString());rogue.stderr.on('data',b=>err+=b.toString());
  const exitCode=await new Promise(ok=>rogue.once('close',ok));assert.equal(exitCode,0,err);
  assert.ok(out.includes('BYPASSED'));assert.equal(applied,1);
  assert.equal(JSON.parse(await readFile(file(dir4,'state.json'))).epoch,999);
  assert.equal(fdProbe(lock4).status,73,'advisory lock remains held while uncooperative writer acts');
  await trusted.close();
  console.log('PASS LOCK INODE/INHERITANCE/BYPASS: unlink+recreate permits 2 owners and epoch rollback; directory inode lock resists unrelated marker swap; descendant keeps descriptor lock after owner exit; uncooperative writer and direct HTTP effect bypass live advisory lock');
 }finally{
  if(inheritedPid){try{process.kill(inheritedPid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
  await Promise.all(active.map(x=>x.close()));
  if(device){device.closeAllConnections();await new Promise(ok=>device.close(ok));}
  await rm(root,{recursive:true,force:true});
 }
}
async function exists(p){try{await stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
if(process.argv[2]==='--keeper')await keeperProcess();else if(process.argv[2]==='--inherited-sleeper')await inheritedSleeper();else if(process.argv[2]==='--bypass')await bypass();else await main();
