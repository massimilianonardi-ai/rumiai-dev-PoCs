// The compiler and loader are separate units; distribution assembly is optional.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,copyFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'..');
const tmp=await mkdtemp(join(tmpdir(),'jsc-separate-'));
try {
  const compiled=join(tmp,'compiled.js'),assembled=join(tmp,'bundle.js');
  const args=[join(root,'example/modules.json')];
  const run=(file,out)=>spawnSync(process.execPath,[join(root,'src',file),...args,out],{encoding:'utf8'});
  const c=run('jsc.mjs',compiled);
  assert.equal(c.status,0,c.stderr);
  const source=await readFile(compiled,'utf8');
  const loader=await readFile(join(root,'src/loader.js'),'utf8');
  assert.ok(source.includes('JscRuntime.installBatch('),'compiler must emit registrations');
  assert.ok(!source.includes('JscRuntime already defined'),'compiler must not embed a loader');
  assert.ok(!source.includes('const definitions = new Map()'),'compiler must not own the registry');
  const context=vm.createContext({});
  assert.throws(()=>vm.runInContext(source,context),/JscRuntime|undefined/);
  vm.runInContext(loader,context);
  context.JscRuntime.install('handmade',[],(_r,m)=>{m.exports.value='independent';});
  assert.equal(context.JscRuntime.require('handmade').value,'independent');
  vm.runInContext(source,context);
  assert.equal(context.JscRuntime.require('application').run(),1);
  const d=run('assemble.mjs',assembled);
  assert.equal(d.status,0,d.stderr);
  const bundle=await readFile(assembled,'utf8');
  assert.ok(bundle.includes(loader),'packaging must use the same independent runtime');
  assert.ok(bundle.includes(source),'packaging must preserve compiled code');
  const standalone=vm.createContext({});
  vm.runInContext(bundle,standalone);
  assert.equal(standalone.JscRuntime.require('application').run(),1);
  // Paths containing spaces must not break file:// URLs used to locate the compiler.
  const nested=join(tmp,'tools with spaces');
  await mkdir(nested);
  for(const file of ['jsc.mjs','assemble.mjs','loader.js'])
    await copyFile(join(root,'src',file),join(nested,file));
  const byPath=join(tmp,'spaced bundle.js');
  const spaceResult=spawnSync(process.execPath,[join(nested,'assemble.mjs'),...args,byPath],{encoding:'utf8'});
  assert.equal(spaceResult.status,0,spaceResult.stderr);
  const spaceContext=vm.createContext({});
  vm.runInContext(await readFile(byPath,'utf8'),spaceContext);
  assert.equal(spaceContext.JscRuntime.require('application').run(),1);
  console.log('PASS: compiler-only output, independent loader, manual definitions, one-file assembly and whitespace-safe tool paths');
} finally {await rm(tmp,{recursive:true,force:true});}
