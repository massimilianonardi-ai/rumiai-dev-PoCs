'use strict';
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function ok(v, m) { if (!v) throw new Error(m); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function wait(pred, m) { for (let i = 0; i < 500; i++) { if (pred()) return; await sleep(20); } throw new Error(m); }
function run(cmd, args, opt = {}) { const r = cp.spawnSync(cmd, args, {encoding:'utf8', ...opt}); if (r.error) throw r.error; return r; }
function result(child) { return new Promise((resolve, reject) => { let out='', err=''; child.stdout?.on('data', x => out += x); child.stderr?.on('data', x => err += x); child.once('error', reject); child.once('exit', (status, signal) => resolve({status, signal, out, err})); }); }
function spawnMk(engine, target, project, extra = {}) { return cp.spawn(process.execPath, [engine, '--project', project, 'build'], {env:{...process.env, RUMIAI_POC_RUMIAI_OS:target, ...extra}, stdio:['ignore','pipe','pipe']}); }
function cacheRoot(target) { const r = run(path.join(target,'m'), [path.join(target,'bin','sys','state-path'),'user','sys','mk','cache'], {env:{...process.env,m_ROOT:target}}); ok(r.status===0, `state-path failed: ${r.stderr}`); return r.stdout.trim(); }
function pkey(project) { return crypto.createHash('sha256').update(fs.realpathSync(project)).digest('hex'); }
function projectCache(cache, project) { return path.join(cache,'projects',pkey(project)); }
function config() { return {version:2,goals:{build:['build']},operations:{build:{inputs:{source:{path:'src/input.txt'}},incremental:{},outputs:{artifact:{path:'out/artifact'}},action:{type:'process',command:'sh',args:['-c',"mkdir -p out; cp src/input.txt out/artifact; printf 'run\\n' >> trace"]}}}}; }
function project(root, name, data) { const p=path.join(root,name); fs.mkdirSync(path.join(p,'src'),{recursive:true}); fs.writeFileSync(path.join(p,'src','input.txt'),data); fs.writeFileSync(path.join(p,'mk.json'),JSON.stringify(config(),null,2)+'\n'); return p; }
function trace(p) { const f=path.join(p,'trace'); return fs.existsSync(f) ? fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).length : 0; }
function roots(shared) { return fs.existsSync(shared) ? fs.readdirSync(shared).filter(n=>/^[a-f0-9]{64}$/.test(n)).map(n=>path.join(shared,n)) : []; }
function oneRoot(shared) { const r=roots(shared); ok(r.length===1,`expected one fingerprint root, got ${r.length}`); return r[0]; }
function current(root) { const f=path.join(root,'current'); return fs.existsSync(f) ? fs.readFileSync(f,'utf8').trim() : null; }
function candidates(root) { const d=path.join(root,'candidates'); return fs.existsSync(d) ? fs.readdirSync(d).filter(n=>/^[a-f0-9]{64}(?:-[a-z0-9-]+)?$/.test(n)) : []; }
function leases(root, kind) { const d=path.join(root,`.${kind}-leases`); return fs.existsSync(d) ? fs.readdirSync(d).filter(n=>!n.startsWith('.prep-')) : []; }
function setCurrent(root, c) { const t=path.join(root,'.test-current'); fs.writeFileSync(t,c+'\n'); fs.renameSync(t,path.join(root,'current')); }
function maintain(script, mode, root) { const r=run(process.execPath,[script,mode,root]); ok(r.status===0,`maintenance failed: ${r.stderr}`); return JSON.parse(r.stdout.trim()); }
function findPrefix(shared, prefix) { return roots(shared).find(r=>fs.readdirSync(r).some(n=>n.startsWith(prefix))) || null; }
function reset(shared) { fs.rmSync(shared,{recursive:true,force:true}); }
function seed(engine,target,cache,root,name,data) { const p=project(root,name,data); fs.rmSync(projectCache(cache,p),{recursive:true,force:true}); const r=run(process.execPath,[engine,'--project',p,'build'],{env:{...process.env,RUMIAI_POC_RUMIAI_OS:target}}); ok(r.status===0,`seed ${name} failed: ${r.stderr}`); return p; }

async function candidateSafety(root, engine, maintenance, target, cache, shared) {
  reset(shared);
  seed(engine,target,cache,root,'seed','SAME\n');
  const fr=oneRoot(shared), base=current(fr), dup=base+'-dup';
  fs.cpSync(path.join(fr,'candidates',base),path.join(fr,'candidates',dup),{recursive:true}); setCurrent(fr,dup);
  let m=maintain(maintenance,'sweep',fr);
  ok(m.state==='ok' && !fs.existsSync(path.join(fr,'candidates',base)) && fs.existsSync(path.join(fr,'candidates',dup)),'sweep selected/unselected rule failed');
  fs.cpSync(path.join(fr,'candidates',dup),path.join(fr,'candidates',base),{recursive:true}); fs.unlinkSync(path.join(fr,'current'));

  const pub=project(root,'publisher','SAME\n'); fs.rmSync(projectCache(cache,pub),{recursive:true,force:true});
  const mark=path.join(root,'pub-ready'), release=path.join(root,'pub-release');
  const child=spawnMk(engine,target,pub,{RUMIAI_POC_ARTIFACT_PIN_MARKER:mark,RUMIAI_POC_ARTIFACT_PIN_WAIT:release}); const done=result(child);
  await wait(()=>fs.existsSync(mark),'publisher did not reach publication lease');
  ok(leases(fr,'publication').length===1,'publication FIFO not visible');
  m=maintain(maintenance,'sweep',fr); ok(m.state==='blocked-publication' && fs.existsSync(path.join(fr,'candidates',base)),'maintenance crossed live publication');
  fs.writeFileSync(release,'go\n'); ok((await done).status===0 && current(fr)===base,'publisher did not finish selection');

  const reader=project(root,'reader','SAME\n'); fs.rmSync(projectCache(cache,reader),{recursive:true,force:true});
  const rm=path.join(root,'reader-ready'), rr=path.join(root,'reader-release');
  const rc=spawnMk(engine,target,reader,{RUMIAI_POC_ARTIFACT_RESTORE_MARKER:rm,RUMIAI_POC_ARTIFACT_RESTORE_WAIT:rr}); const rd=result(rc);
  await wait(()=>fs.existsSync(rm),'reader did not capture candidate'); setCurrent(fr,dup); maintain(maintenance,'sweep',fr);
  ok(!fs.existsSync(path.join(fr,'candidates',base)),'old reader candidate not reclaimed'); fs.writeFileSync(rr,'go\n');
  ok((await rd).status===0 && trace(reader)===1 && fs.readFileSync(path.join(reader,'out','artifact'),'utf8')==='SAME\n','reader did not safely fall back');
}

async function crashResidue(root, engine, maintenance, target, cache, shared) {
  reset(shared);
  const live=project(root,'live-stage','STAGE\n'); fs.rmSync(projectCache(cache,live),{recursive:true,force:true});
  const lm=path.join(root,'stage-ready'), lr=path.join(root,'stage-release');
  const lc=spawnMk(engine,target,live,{RUMIAI_POC_ARTIFACT_STAGE_MARKER:lm,RUMIAI_POC_ARTIFACT_STAGE_WAIT:lr}); const ld=result(lc);
  await wait(()=>fs.existsSync(lm),'live staging pause missing'); const lroot=findPrefix(shared,'.staging-'); const lname=fs.readdirSync(lroot).find(n=>n.startsWith('.staging-'));
  maintain(maintenance,'sweep',lroot); ok(fs.existsSync(path.join(lroot,lname)),'live staging reclaimed'); fs.writeFileSync(lr,'go\n'); ok((await ld).status===0,'live staging writer failed');

  const dead=project(root,'dead-stage','DEAD\n'); fs.rmSync(projectCache(cache,dead),{recursive:true,force:true});
  const dm=path.join(root,'dead-ready'), dw=path.join(root,'dead-wait'); const dc=spawnMk(engine,target,dead,{RUMIAI_POC_ARTIFACT_STAGE_MARKER:dm,RUMIAI_POC_ARTIFACT_STAGE_WAIT:dw}); const dd=result(dc);
  await wait(()=>fs.existsSync(dm),'dead staging pause missing'); const droot=findPrefix(shared,'.staging-'); const dname=fs.readdirSync(droot).find(n=>n.startsWith('.staging-')); dc.kill('SIGKILL'); await dd;
  ok(leases(droot,'attempt').length===1,'dead attempt FIFO pathname missing'); maintain(maintenance,'sweep',droot); ok(!fs.existsSync(path.join(droot,dname)) && leases(droot,'attempt').length===0,'dead staging/lease not reclaimed');

  const sel=project(root,'dead-selector','SELECT\n'); fs.rmSync(projectCache(cache,sel),{recursive:true,force:true});
  const sm=path.join(root,'selector-ready'), sw=path.join(root,'selector-wait'); const sc=spawnMk(engine,target,sel,{RUMIAI_POC_ARTIFACT_CURRENT_MARKER:sm,RUMIAI_POC_ARTIFACT_CURRENT_WAIT:sw}); const sd=result(sc);
  await wait(()=>fs.existsSync(sm),'selector pause missing'); const sroot=findPrefix(shared,'.current-'); const stmp=fs.readdirSync(sroot).find(n=>n.startsWith('.current-'));
  ok(maintain(maintenance,'sweep',sroot).state==='blocked-publication','live selector publication not protected'); sc.kill('SIGKILL'); await sd; maintain(maintenance,'sweep',sroot);
  ok(!fs.existsSync(path.join(sroot,stmp)) && leases(sroot,'publication').length===0,'dead selector residue not reclaimed');

  const mr=oneRoot(shared), mm=path.join(root,'maint-ready'), mw=path.join(root,'maint-wait');
  const mc=cp.spawn(process.execPath,[maintenance,'sweep',mr],{env:{...process.env,RUMIAI_POC_MAINTENANCE_LEASE_MARKER:mm,RUMIAI_POC_MAINTENANCE_LEASE_WAIT:mw},stdio:['ignore','pipe','pipe']}); const md=result(mc);
  await wait(()=>fs.existsSync(mm),'maintenance lease pause missing'); ok(leases(mr,'maintenance').length===1,'maintenance FIFO not visible'); mc.kill('SIGKILL'); await md; maintain(maintenance,'sweep',mr);
  ok(leases(mr,'maintenance').length===0,'stale maintenance FIFO not reaped');
}

async function gateAndEvict(root, engine, maintenance, target, cache, shared) {
  reset(shared); const seedp=seed(engine,target,cache,root,'gate-seed','GATE\n'); const fr=oneRoot(shared); fs.unlinkSync(path.join(fr,'current'));
  const mm=path.join(root,'gate-ready'), mw=path.join(root,'gate-wait'); const mc=cp.spawn(process.execPath,[maintenance,'sweep',fr],{env:{...process.env,RUMIAI_POC_MAINTENANCE_LEASE_MARKER:mm,RUMIAI_POC_MAINTENANCE_LEASE_WAIT:mw},stdio:['ignore','pipe','pipe']}); const md=result(mc); await wait(()=>fs.existsSync(mm),'gate maintenance not active');
  const pub=project(root,'gate-pub','GATE\n'); fs.rmSync(projectCache(cache,pub),{recursive:true,force:true}); const pr=run(process.execPath,[engine,'--project',pub,'build'],{env:{...process.env,RUMIAI_POC_RUMIAI_OS:target}});
  ok(pr.status===0 && trace(pub)===1 && current(fr)===null,'publisher crossed live maintenance lease'); fs.writeFileSync(mw,'go\n'); ok((await md).status===0 && candidates(fr).length===0,'maintenance did not reclaim gated candidate');

  reset(shared); const p=seed(engine,target,cache,root,'evict','EVICT\n'); const er=oneRoot(shared), selected=current(er); maintain(maintenance,'sweep',er); ok(current(er)===selected,'ordinary sweep removed selected candidate');
  fs.rmSync(path.join(p,'out'),{recursive:true,force:true}); const fresh=projectCache(cache,p); ok(fs.existsSync(fresh),'freshness missing before eviction'); maintain(maintenance,'evict',er);
  ok(current(er)===null && candidates(er).length===0 && fs.existsSync(fresh),'eviction boundary wrong'); const after=run(process.execPath,[engine,'--project',p,'build'],{env:{...process.env,RUMIAI_POC_RUMIAI_OS:target}});
  ok(after.status===0 && trace(p)===2 && fs.readFileSync(path.join(p,'out','artifact'),'utf8')==='EVICT\n','post-eviction miss did not execute safely');
}

(async()=>{
  const target=process.env.RUMIAI_POC_RUMIAI_OS; if(!target) throw new Error('RUMIAI_POC_RUMIAI_OS is required');
  const tr=fs.realpathSync(target), engine=path.resolve(__dirname,'..','candidate-engine.js'), maintenance=path.resolve(__dirname,'..','maintenance.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rumiai-poc034-')), cache=cacheRoot(tr), shared=path.join(cache,'shared-artifacts');
  try {
    await candidateSafety(root,engine,maintenance,tr,cache,shared);
    await crashResidue(root,engine,maintenance,tr,cache,shared);
    await gateAndEvict(root,engine,maintenance,tr,cache,shared);
    console.log('PASS PoC 034 crash-released artifact maintenance coordination');
    console.log('OBSERVED ownership-witness=posix-fifo-open-reader');
    console.log('OBSERVED crash-liveness=stale-fifo-detectable-without-pid-or-timeout');
    console.log('OBSERVED abandoned-staging=reclaimable-after-owner-death');
    console.log('OBSERVED selector-temp=reclaimable-after-owner-death');
    console.log('OBSERVED reader-lease=still-not-required');
  } finally { fs.rmSync(shared,{recursive:true,force:true}); fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e=>{ process.stderr.write(`FAIL PoC 034: ${e.message}\n`); process.exitCode=1; });
