// PoC 062: real POSIX fcntl record-lock versus FIFO activity-token semantics.
// Compiles a disposable C fixture only for this experiment; not a product command.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rename,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const fixture=join(dirname(fileURLToPath(import.meta.url)),'fixtures','posix-lock-probe.c');
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
function child(cmd,args) {
 const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});
 let out='',err='';
 p.stdout.on('data',b=>{out+=b.toString();for(const w of [...pending])if(out.includes(w.value)){
  pending.splice(pending.indexOf(w),1);clearTimeout(w.timer);w.done();
 }});
 p.stderr.on('data',b=>err+=b.toString());
 const pending=[];
 return {p,
  wait(value){if(out.includes(value))return Promise.resolve();return new Promise((done,fail)=>{
   const timer=setTimeout(()=>fail(Error('timeout '+value+' out='+out+' err='+err)),10000);
   pending.push({value,done,timer});
  });},
  async stop(){if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');
   await new Promise(done=>{if(p.exitCode!==null||p.signalCode!==null)done();else p.once('exit',done);});},
  get output(){return out;},get error(){return err;}
 };
}
async function expectProbe(bin,mode,path,expectedOutput,expectedCode=0) {
 const result=spawnSync(bin,[mode,path],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,expectedCode,mode+' '+path+' stderr='+result.stderr);
 assert.ok(result.stdout.includes(expectedOutput),mode+': '+result.stdout);
}
async function main(){
 if(process.platform==='win32'){console.log('SKIP POSIX LOCK SEMANTICS: POSIX host required');return;}
 const compiler=spawnSync('cc',['--version'],{encoding:'utf8'});
 if(compiler.error?.code==='ENOENT'){console.log('SKIP POSIX LOCK SEMANTICS: C compiler unavailable on this host');return;}
 const dir=await mkdtemp(join(tmpdir(),'poc062-posix-lock-')),bin=join(dir,'probe');
 const processes=[],descendants=[];
 const held=(mode,path)=>{const c=child(bin,[mode,path]);processes.push(c);return c;};
 try{
  const cc=spawnSync('cc',['-std=c11','-O0','-Wall','-Wextra','-Werror','-pedantic',fixture,'-o',bin],
   {encoding:'utf8',timeout:20000});
  assert.equal(cc.status,0,'compile POSIX probe failed: '+cc.stderr);
  // POSIX F_SETLK excludes another process and is released when its owner dies.
  const basic=join(dir,'basic.lock'),h=held('hold',basic);await h.wait('READY');
  await expectProbe(bin,'probe',basic,'BUSY',73);
  await h.stop();await expectProbe(bin,'probe',basic,'FREE');
  // POSIX process-owned record locks are lost upon close of ANOTHER descriptor
  // for the same inode, even if the original lock descriptor stays open.
  const closePath=join(dir,'close.lock'),closer=held('close-another',closePath);
  await closer.wait('CLOSED_OTHER');assert.equal(closer.p.exitCode,null);
  await expectProbe(bin,'probe',closePath,'FREE');await closer.stop();
  // fork() child inherits an open descriptor but NOT the parent's process record locks;
  // parent's exit releases the record lock even while that child is alive.
  const forkPath=join(dir,'fork.lock'),forker=held('fork-exit',forkPath);
  await forker.wait('FORKED ');const match=/FORKED (\d+)/.exec(forker.output);
  assert.ok(match, 'actual fork PID was logged');const grandchild=Number(match[1]);
  descendants.push(grandchild);
  await new Promise(done=>forker.p.exitCode!==null?done():forker.p.once('exit',done));
  assert.equal(forker.p.exitCode,0);
  await expectProbe(bin,'probe',forkPath,'FREE');
  process.kill(grandchild,'SIGKILL');descendants.pop();
  // exec without CLOEXEC retains the open record-lock descriptor and its lock;
  // FD_CLOEXEC instead closes the descriptor at exec, releasing the lock.
  const execPath=join(dir,'exec.lock'),execHolder=held('exec-retain',execPath);
  await execHolder.wait('EXECED');await expectProbe(bin,'probe',execPath,'BUSY',73);
  await execHolder.stop();
  const cloPath=join(dir,'cloexec.lock'),execClose=held('exec-cloexec',cloPath);
  await execClose.wait('EXECED');await expectProbe(bin,'probe',cloPath,'FREE');
  await execClose.stop();
  // Neither POSIX record locks nor Linux flock protect a pathname if a cooperating
  // caller recreates that file with a DIFFERENT inode while the original is locked.
  const path=join(dir,'identity.lock'),original=held('hold',path);await original.wait('READY');
  const originalInode=(await stat(path)).ino;
  await rename(path,join(dir,'old-identity.lock'));
  const replacement=held('hold',path);await replacement.wait('READY');
  assert.notEqual((await stat(path)).ino,originalInode);
  await expectProbe(bin,'probe',path,'BUSY',73);
  await original.stop();await expectProbe(bin,'probe',path,'BUSY',73);
  await replacement.stop();await expectProbe(bin,'probe',path,'FREE');
  // mk's private per-owner FIFO tokens show a living reader, not a generic mutex.
  // Each private FIFO can be live simultaneously; a probe switches to STALE
  // after its corresponding owner dies.
  const fifo1=join(dir,'owner-one.fifo'),fifo2=join(dir,'owner-two.fifo');
  const owner1=held('fifo-owner',fifo1),owner2=held('fifo-owner',fifo2);
  await Promise.all([owner1.wait('READY'),owner2.wait('READY')]);
  await expectProbe(bin,'fifo-probe',fifo1,'ACTIVE');
  await expectProbe(bin,'fifo-probe',fifo2,'ACTIVE');
  await owner1.stop();await expectProbe(bin,'fifo-probe',fifo1,'STALE');
  await expectProbe(bin,'fifo-probe',fifo2,'ACTIVE');
  await owner2.stop();await expectProbe(bin,'fifo-probe',fifo2,'STALE');
  // Linux flock comparison: a kernel-held lock on an open description remains
  // effective until its final descriptor is closed. This is separate from fcntl.
  let linuxFlock='not-applicable';
  if(process.platform==='linux'){
   const cmd=spawnSync('flock',['--version'],{encoding:'utf8'});
   if(cmd.status===0){
    const f=join(dir,'linux.lock'),flockOwner=child('flock',['-n','-E','73','-F',f,'sh','-c','echo READY; exec sleep 30']);
    processes.push(flockOwner);await flockOwner.wait('READY');
    const conflict=spawnSync('flock',['-n','-E','73',f,'true'],{encoding:'utf8'});
    assert.equal(conflict.status,73);
    await flockOwner.stop();
    const after=spawnSync('flock',['-n','-E','73',f,'true'],{encoding:'utf8'});
    assert.equal(after.status,0);
    linuxFlock='excluded-then-released';
   }
  }
  console.log('PASS POSIX RECORD-LOCK/FIFO COMPARISON: fcntl exclusivity and owner death; unrelated close drops process locks; fork child does not retain parent record lock; exec retains without FD_CLOEXEC but loses with it; inode replacement permits independent locks; independent FIFO activity tokens both live then stale; Linux flock='+linuxFlock);
 }finally{
  for(const pid of descendants)try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
  await Promise.all(processes.map(c=>c.stop()));
  await rm(dir,{recursive:true,force:true});
 }
}
await main();
