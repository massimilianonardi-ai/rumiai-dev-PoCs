import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const c=vm.createContext({});
vm.runInContext(await readFile(join(root,'src/loader.js'),'utf8'),c);
const m=c.JscRuntime, disposed=[];
const def=(id,value,deps=[])=>({id,deps,factory(r,module){
  module.exports.value=value+(deps.length?r(deps[0]).value:'');
  module.onDispose(()=>disposed.push(id));
}});
m.installBatch([def('app','app:',['service']),def('service','svc:',['data']),def('data','1')]);
assert.equal(m.state().active,0);
assert.equal(m.require('app').value,'app:svc:1');
for(const patch of [
  [def('data','2'),def('service','x',['missing'])],
  [def('data','2',['app'])],
  [def('data','2'),def('data','3')]
]){
  assert.throws(()=>m.installBatch(patch));
  assert.equal(m.require('app').value,'app:svc:1');
  assert.deepEqual(disposed,[]);
}
assert.throws(()=>m.installBatch([def('data','2')],{expectedRevisions:{data:0}}),/stale module revision/);
assert.equal(m.revision('data'),1);
m.installBatch([def('data','2'),def('service','new:',['data'])],{expectedRevisions:{data:1,service:1}});
assert.deepEqual(disposed,['app','service','data']);
assert.equal(m.state().active,0);
assert.equal(m.require('app').value,'app:new:2');
assert.equal(m.revision('data'),2);
assert.equal(m.revision('service'),2);
m.install('reentry',['data'],(r,module)=>{
  module.exports.value=r('data').value;
  module.onDispose(()=>{
    assert.throws(()=>m.require('app'),/runtime is updating/);
    assert.throws(()=>m.install('data',[],()=>{}),/runtime is updating/);
  });
});
m.require('reentry');
m.installBatch([def('data','3'),def('service','svc:',['data'])]);
assert.equal(m.require('app').value,'app:svc:3');
m.install('fragile',['data'],(r,module)=>{
  module.exports.value=r('data').value;
  module.onDispose(()=>{throw Error('cleanup failed');});
});
m.require('fragile');
const rev=m.revision('data');
assert.throws(()=>m.installBatch([def('data','4')]),/batch definitions committed/);
assert.equal(m.revision('data'),rev+1);
assert.equal(m.state().active,0);
assert.equal(m.require('app').value,'app:svc:4');
// Generated bundles register once, even when the manifest lists consumers first.
const tmp=await mkdtemp(join(tmpdir(),'jsc-batch-'));
try{
  await writeFile(join(tmp,'a.js'),'module.exports.value=require("b").value+1;');
  await writeFile(join(tmp,'b.js'),'module.exports.value=7;');
  await writeFile(join(tmp,'manifest.json'),JSON.stringify({version:1,modules:[
    {id:'a',file:'a.js',deps:['b']},{id:'b',file:'b.js',deps:[]}
  ]}));
  const output=join(tmp,'out.js');
  const build=spawnSync(process.execPath,[join(root,'src/assemble.mjs'),join(tmp,'manifest.json'),output],{encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  const bundle=await readFile(output,'utf8');
  assert.equal((bundle.match(/globalThis\.JscRuntime\.installBatch\(/g)||[]).length,1);
  const ctx=vm.createContext({});
  vm.runInContext(bundle,ctx);
  assert.equal(ctx.JscRuntime.require('a').value,8);
}finally{await rm(tmp,{recursive:true,force:true});}
console.log('PASS: batch preflight and stale rollback, consumer-first disposal, reentrancy lock, explicit cleanup failure boundary, atomic generated bundle');
