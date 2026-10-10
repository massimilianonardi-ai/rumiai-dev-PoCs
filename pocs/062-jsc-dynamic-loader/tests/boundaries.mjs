import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(join(tmpdir(), 'jsc-boundaries-'));
const out = join(tmp, 'bundle.js');
const compiler = join(root, 'src/jsc.mjs');
const build = manifest => spawnSync(process.execPath, [compiler, manifest, out], {encoding:'utf8'});
const fixture = async (source, format, dependencies = []) => {
  await writeFile(join(tmp,'source.js'), source);
  await writeFile(join(tmp,'manifest.json'),JSON.stringify({version:1, modules:[{id:'a',file:'source.js',deps:dependencies,...(format===undefined?{}:{format})}]}));
  return build(join(tmp,'manifest.json'));
};
try {
  let result = await fixture('exports.ok = 1;', 'classic');
  assert.equal(result.status,0,result.stderr);
  const original = await readFile(out,'utf8');
  for (const source of ['export const x = 1;', 'import {x} from "./x.js";', 'const m = import.meta.url;']) {
    result = await fixture(source);
    assert.notEqual(result.status,0,source);
    assert.match(result.stderr,/invalid classic module source.*ES Module import\/export syntax is unsupported/s);
    assert.equal(await readFile(out,'utf8'),original,'failed compile must not replace output');
  }
  result = await fixture('exports.ok = 2;', 'esm');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/jsc only accepts classic modules, not ES Modules/);
  assert.equal(await readFile(out,'utf8'),original);

  await writeFile(join(tmp,'manifest.json'),JSON.stringify({version:1,modules:[
    {id:'a',file:'source.js',deps:['b']}, {id:'b',file:'source.js',deps:['a']}
  ]}));
  result = build(join(tmp,'manifest.json'));
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/circular module dependencies/);

  const loaderCode = await readFile(join(root, 'src/loader.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(loaderCode,context);
  const api = context.JscRuntime;
  api.install('dependency', [], (_r,module) => {module.exports.value=4;});
  let disposed = 0;
  api.install('application',['dependency'], (r,module)=>{
    module.exports.value=r('dependency').value;
    module.onDispose(()=>disposed++);
  });
  assert.equal(api.require('application').value,4);
  const revision = api.revision('dependency');
  assert.throws(()=>api.install('dependency',['missing'],()=>{}),/unavailable dependency/);
  assert.throws(()=>api.install('dependency',['application'],()=>{}),/circular module dependencies/);
  assert.equal(api.revision('dependency'),revision);
  assert.equal(api.require('application').value,4);
  assert.equal(disposed,0,'invalid patch must not dispose old instances');
  assert.equal(api.state().active,2);
  api.install('dependency',[],(_r,module)=>{module.exports.value=5;});
  assert.equal(api.revision('dependency'),revision+1);
  assert.equal(disposed,1);
  assert.equal(api.state().active,0);
  assert.equal(api.require('application').value,5);
  assert.throws(()=>api.remove('dependency'),/registered dependents/);
  assert.equal(api.remove('application'),true);
  assert.equal(api.remove('dependency'),true);
  assert.equal(api.revision('dependency'),0,'removed definitions must release version history');
  assert.equal(api.state().registered,0);
  console.log('PASS: explicit ESM boundary, unchanged prior output on compilation failure, cycle detection, non-destructive invalid replacement, revision and removal');
} finally { await rm(tmp,{recursive:true,force:true}); }
