// End-to-end CLI consumer path: separate loader + compiled modules, on-demand
// registrations, patch and optional single-file assembled distribution.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'..');
const work=join(root,'example/workflow');
const dest=await mkdtemp(join(tmpdir(),'jsc-workflow-'));
function run(args){
 const r=spawnSync(process.execPath,args,{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr||r.stdout);
}
function makeContext(){
 const listeners=new Set();
 const tap={addEventListener(type,callback){assert.equal(type,'click');listeners.add(callback);},
  removeEventListener(type,callback){assert.equal(type,'click');assert.ok(listeners.delete(callback));},
  click(){for(const listener of listeners)listener();}};
 const context=vm.createContext({document:{getElementById(id){assert.equal(id,'tap');return tap;}},
  workflowMetrics:{taps:0,disposals:0,last:null}});
 return {context,tap,listeners};
}
try{
 run([join(work,'build.mjs'),dest]);
 for(const name of ['initial.js','optional.js','patch.js','bundle-all.js','loader.js','client.js','dev.html','release.html']){
  const f=join(dest,name);
  assert.ok((await stat(f)).size>0,name+' output missing');
  if(name.endsWith('.js'))run(['--check',f]);
 }
 const [loader,base,optional,patch,all]=await Promise.all(['loader.js','initial.js','optional.js','patch.js','bundle-all.js']
  .map(p=>readFile(join(dest,p),'utf8')));
 assert.ok(base.includes('JscRuntime.installBatch('));
 assert.ok(!base.includes('JscRuntime already defined'),'compiler output must not embed loader');
 assert.ok(all.includes(loader),'assembler must reuse independent loader');
 assert.ok(all.includes('id:"core"') && all.includes('id:"app"') && all.includes('id:"optional"'),
  'assembled bundle must contain the full declared module graph');
 // Developer mode: load the standalone runtime, then initial registrations,
 // and only later download/execute optional registrations and a patch.
 {
  const {context,tap,listeners}=makeContext();
  vm.runInContext(loader,context);vm.runInContext(base,context);
  const rt=context.JscRuntime;
  assert.deepEqual([rt.state().registered,rt.state().active,rt.revision('optional')],[2,0,0]);
  assert.match(rt.require('app').greeting,/compilati da jsc/);
  assert.equal(rt.state().active,2);
  vm.runInContext(optional,context);
  assert.equal(rt.revision('optional'),1);
  assert.equal(rt.state().active,2,'optional must not execute on registration');
  assert.equal(rt.require('optional').version,'v1');
  tap.click();assert.equal(context.workflowMetrics.taps,1);
  assert.equal(listeners.size,1);
  vm.runInContext(patch,context);
  assert.equal(listeners.size,0,'v1 listener must be removed on patch');
  assert.equal(context.workflowMetrics.disposals,1);
  assert.equal(rt.require('optional').version,'v2');
  tap.click();assert.equal(context.workflowMetrics.taps,2);
  assert.equal(context.workflowMetrics.last,'v2');
  assert.equal(listeners.size,1);
  assert.equal(rt.state().registered,3);
 }
 // Release mode: only the single assembled module distribution is needed;
 // optional definition exists immediately but evaluation is deferred until require.
 {
  const {context,listeners}=makeContext();
  vm.runInContext(all,context);
  const rt=context.JscRuntime;
  assert.equal(rt.state().registered,3);
  assert.equal(rt.state().active,0);
  assert.equal(listeners.size,0);
  assert.equal(rt.require('app').greeting,'Moduli classici compilati da jsc');
  assert.equal(rt.state().active,2);
  assert.equal(rt.require('optional').version,'v1');
  assert.equal(listeners.size,1);
 }
 console.log('PASS WORKFLOW CLI: separate classic compiler/runtime, optional registration loaded on demand, live v1->v2 cleanup, one-file assembled module distribution with deferred evaluation');
}finally{await rm(dest,{recursive:true,force:true});}
