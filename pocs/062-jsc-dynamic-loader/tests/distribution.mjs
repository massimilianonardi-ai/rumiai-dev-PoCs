// Consumer boundary: actually pack, install offline in a fresh external directory,
// execute installed CLI binaries, consume separate loader asset and assemble one file.
// No imports from the PoC source checkout after packaging.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'..');
const scratch=await mkdtemp(join(tmpdir(),'jsc-external-consumer-'));
const packages=join(scratch,'packages'),consumer=join(scratch,'outside checkout with spaces');
function command(exe,args,cwd=consumer){
 const result=spawnSync(exe,args,{cwd,encoding:'utf8',timeout:90000,env:{...process.env,npm_config_update_notifier:'false'}});
 return result;
}
function ok(result,label){assert.equal(result.status,0,label+' failed:\n'+result.stdout+'\n'+result.stderr);}
async function manifest(file,modules){
 await writeFile(file,JSON.stringify({version:1,modules},null,2));
}
try{
 await mkdir(packages,{recursive:true});await mkdir(consumer,{recursive:true});
 ok(command(process.execPath,[join(root,'distribution/build.mjs'),packages],scratch),'build packages');
 const names=await readdir(packages);
 assert.deepEqual(names.sort(),[
  'rumiai-poc-dynamic-loader-0.0.0-poc.1.tgz',
  'rumiai-poc-jsc-0.0.0-poc.1.tgz'
 ]);
 await writeFile(join(consumer,'package.json'),JSON.stringify({name:'independent-consumer-fixture',version:'1.0.0',private:true},null,2));
 ok(command('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',
  join(packages,names[0]),join(packages,names[1])]),'offline installation');
 const compilerPackage=join(consumer,'node_modules/rumiai-poc-jsc');
 const loaderPackage=join(consumer,'node_modules/rumiai-poc-dynamic-loader');
 const packageJ=JSON.parse(await readFile(join(compilerPackage,'package.json')));
 const packageL=JSON.parse(await readFile(join(loaderPackage,'package.json')));
 assert.equal(packageJ.version,'0.0.0-poc.1');
 assert.equal(packageL.version,'0.0.0-poc.1');
 assert.equal(packageJ.private,true);assert.equal(packageL.private,true);
 assert.deepEqual((await readdir(compilerPackage)).sort(),['README.md','bin','package.json']);
 assert.deepEqual((await readdir(loaderPackage)).sort(),['README.md','loader.js','package.json']);
 const jsc=join(consumer,'node_modules/.bin/jsc');
 const assemble=join(consumer,'node_modules/.bin/jsc-assemble');
 const loader=join(loaderPackage,'loader.js');
 ok(command(jsc,['--help']),'installed compiler help');
 const sourceV1=join(consumer,'core.js'),sourceV2=join(consumer,'core-v2.js');
 const manifestV1=join(consumer,'base.json'),manifestV2=join(consumer,'patch.json');
 const compiled=join(consumer,'compiled.js'),patch=join(consumer,'patch.js'),bundle=join(consumer,'bundle.js');
 await writeFile(sourceV1,"module.exports.version='v1'; module.onDispose(()=>globalThis.metrics.stops.push('v1'));\n");
 await writeFile(sourceV2,"module.exports.version='v2'; module.onDispose(()=>globalThis.metrics.stops.push('v2'));\n");
 await manifest(manifestV1,[{id:'core',file:'core.js',deps:[]}]);
 await manifest(manifestV2,[{id:'core',file:'core-v2.js',deps:[]}]);
 ok(command(jsc,[manifestV1,compiled]),'external classic compilation');
 const compiledText=await readFile(compiled,'utf8');
 assert.match(compiledText,/JscRuntime\.installBatch/);
 assert.doesNotMatch(compiledText,/JscRuntime already defined|const definitions = new Map/);
 assert.ok((await stat(compiled)).size>0);
 // ESM must fail without corrupting the previous good compiled script.
 const previous=await readFile(compiled);
 await writeFile(sourceV2,"export const forbidden = 1;\n");
 const failed=command(jsc,[manifestV2,compiled]);
 assert.notEqual(failed.status,0);assert.match(failed.stderr,/invalid classic module source/);
 assert.deepEqual(await readFile(compiled),previous);
 await writeFile(sourceV2,"module.exports.version='v2'; module.onDispose(()=>globalThis.metrics.stops.push('v2'));\n");
 ok(command(jsc,[manifestV2,patch]),'external patch compilation');
 const loaderText=await readFile(loader,'utf8');
 const context=vm.createContext({metrics:{stops:[]}});
 vm.runInContext(loaderText,context);
 context.JscRuntime.install('manual',[],(_r,m)=>{m.exports.works=true;});
 assert.equal(context.JscRuntime.require('manual').works,true);
 vm.runInContext(compiledText,context);
 assert.equal(context.JscRuntime.state().registered,2);
 assert.equal(context.JscRuntime.state().active,1);
 const old=context.JscRuntime.require('core');
 assert.equal(old.version,'v1');
 vm.runInContext(await readFile(patch,'utf8'),context);
 assert.equal(context.metrics.stops.join(','),'v1');
 assert.equal(old.version,'v1','captured exports are not live bindings');
 assert.equal(context.JscRuntime.require('core').version,'v2');
 assert.equal(context.JscRuntime.revision('core'),2);
 // The assembler is distributed with the compiler, but it can only embed
 // the separate loader when the consumer explicitly supplies its asset.
 ok(command(assemble,[manifestV1,bundle,loader]),'installed assembler with independent loader');
 const assembled=await readFile(bundle,'utf8');
 assert.ok(assembled.includes(loaderText),'assembled output must embed the externally installed loader');
 const released=vm.createContext({});
 vm.runInContext(assembled,released);
 assert.equal(released.JscRuntime.state().registered,1);
 assert.equal(released.JscRuntime.state().active,0);
 assert.equal(released.JscRuntime.require('core').version,'v1');
 assert.equal(released.JscRuntime.state().active,1);
 // Bad loader path does not clobber an existing valid assembly.
 const validBundle=await readFile(bundle);
 const invalid=command(assemble,[manifestV1,bundle,join(consumer,'missing-loader.js')]);
 assert.notEqual(invalid.status,0);
 assert.deepEqual(await readFile(bundle),validBundle);
 console.log('PASS INDEPENDENT DISTRIBUTION: two private versioned npm tarballs, fully offline installation outside PoC, installed jsc CLI + loader script, manual registrations, v1-v2 onDispose patch, rejected ESM retaining prior output, optional one-file assembly with external loader');
}finally{await rm(scratch,{recursive:true,force:true});}
