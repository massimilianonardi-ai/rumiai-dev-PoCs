// Repeatable, deliberately synthetic nontrivial workload for the *same* classic module graph.
// Measures raw/gzip/Brotli transfer bytes and VM evaluation samples, not real network latency,
// browser memory, a representative production application, or comparative toolchain quality.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'..');
const dir=await mkdtemp(join(tmpdir(),'jsc-workload-'));
const count=24,selected=[0,7,19];
function dataFor(index){
 let state=(index+1)*0x9e3779b1>>>0;
 const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
 let s='';
 for(let i=0;i<16384;i++){
  state^=state<<13;state^=state>>>17;state^=state<<5;
  s+=alphabet[(state>>>0)%alphabet.length];
 }
 return s;
}
const files=new Map();
for(let i=0;i<count;i++){
 const id='feature'+i,body=dataFor(i);
 files.set(id,{id,file:id+'.js',deps:[]});
 await writeFile(join(dir,id+'.js'),'const source='+JSON.stringify(body)+';module.exports={id:'+JSON.stringify(id)+',length:source.length,first:source[0]};');
}
await writeFile(join(dir,'entry.js'),"module.exports={name:'entry',ready:true};");
const entry={id:'entry',file:'entry.js',deps:[]},runtime=await readFile(join(root,'src/loader.js'));
async function compile(name,ids,assembled=false){
 const manifest=join(dir,name+'.json'),output=join(dir,name+'.output.js');
 await writeFile(manifest,JSON.stringify({version:1,modules:ids}));
 const result=spawnSync(process.execPath,[join(root,'src',assembled?'assemble.mjs':'jsc.mjs'),manifest,output],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return readFile(output);
}
function sizes(buf){return {raw:buf.length,gzip:gzipSync(buf).length,brotli:brotliCompressSync(buf).length};}
function total(buffers,key){return buffers.reduce((sum,bytes)=>sum+sizes(bytes)[key],0);}
const sorted=[...files.values()];
try{
 const compiledEntry=await compile('entry-only',[entry]);
 const combined=await compile('all-modules',[entry,...sorted],true);
 const requested=[];
 for(const i of selected)requested.push(await compile('requested-'+i,[files.get('feature'+i)]));
 const initialSeparate=[runtime,compiledEntry],usageSeparate=[...initialSeparate,...requested];
 const distribution={
  moduleCount:1+count,optionalCount:count,usedOptionalCount:selected.length,
  initialSeparate:{raw:total(initialSeparate,'raw'),gzip:total(initialSeparate,'gzip'),brotli:total(initialSeparate,'brotli'),requests:2},
  afterThreeModules:{raw:total(usageSeparate,'raw'),gzip:total(usageSeparate,'gzip'),brotli:total(usageSeparate,'brotli'),requests:2+selected.length},
  combined:{...sizes(combined),requests:1}
 };
 // The runtime is independently authored; jsc doesn't copy its source into the compiler output.
 assert.ok(!compiledEntry.includes(runtime));
 assert.ok(combined.includes(runtime));
 assert.ok(distribution.initialSeparate.gzip<distribution.combined.gzip/2,
  'synthetic optional-heavy fixture should demonstrate initial network-byte saving');
 assert.ok(distribution.afterThreeModules.gzip<distribution.combined.gzip,
  'using a small fraction of optional modules should avoid transferring all of them');
 function sample(scripts){
  const context=vm.createContext({});
  const start=performance.now();
  for(const source of scripts)vm.runInContext(source.toString('utf8'),context,{timeout:5000});
  const registeredAt=performance.now();
  assert.equal(context.JscRuntime.require('entry').name,'entry');
  for(const i of selected){
   const result=context.JscRuntime.require('feature'+i);
   assert.equal(result.length,16384);assert.equal(result.id,'feature'+i);
  }
  const executedAt=performance.now();
  assert.equal(context.JscRuntime.state().active,1+selected.length);
  return {registrationMs:Math.round((registeredAt-start)*100)/100,
    activationMs:Math.round((executedAt-registeredAt)*100)/100};
 }
 const splitSamples=[],singleSamples=[];
 for(let i=0;i<5;i++){
  splitSamples.push(sample(usageSeparate));singleSamples.push(sample([combined]));
 }
 const median=(values)=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
 distribution.vmRegistrationMedianMs={separate:median(splitSamples.map(x=>x.registrationMs)),combined:median(singleSamples.map(x=>x.registrationMs))};
 distribution.vmActivationMedianMs={separate:median(splitSamples.map(x=>x.activationMs)),combined:median(singleSamples.map(x=>x.activationMs))};
 console.log('PASS WORKLOAD: 24 optional classic modules, only 3 used, explicit bytes and VM sampling; '+JSON.stringify(distribution));
}finally{
 await rm(dir,{recursive:true,force:true});
}
