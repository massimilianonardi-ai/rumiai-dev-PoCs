import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import vm from 'node:vm';

// Direct read-only engine exercise (not a test of the shell wrapper).
const engine = process.argv[2];
if (!engine) throw new Error('Usage: node actual-jsc-probe.mjs <engine-path>');
const dir = mkdtempSync(join(tmpdir(), 'jsc-eval-free-'));
const file = (name, symbols) => ({file:name, symbols});
const node = (name, modules) => ({name, modules});
const tree = modules => ({modules:[node('m', modules)]});
const input = {
  'm/Base.js':'function Base(){ return 10; }',
  'm/srv/data/MyClass.js':'function MyClass(){ return Base()+32; }',
  'm/srv/data/Other.js':'function Other(){ return MyClass(); }',
  'm/srv/Facade.js':'function Facade(){ return data.MyClass()+data.Other()-42; }',
  'm/srv/Extension.js':'function Extension(){ return data.MyClass()+Base(); }',
  'm/srv/data/Revised.js':'function MyClass(){ return 77; }'
};
const first = tree([file('m/Base.js','Base'), node('srv',[
  node('data',[file('m/srv/data/MyClass.js','MyClass'),file('m/srv/data/Other.js','Other')]),
  file('m/srv/Facade.js','Facade')])]);
const second = tree([node('srv',[file('m/srv/Extension.js','Extension')])]);
const third = tree([node('srv',[node('data',[file('m/srv/data/Revised.js','MyClass')])])]);
try {
  for(const [name, contents] of Object.entries(input)){
    const path=join(dir,name);mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path, contents+'\n');
  }
  const sandbox=vm.createContext({});
  const run = manifest => {
    writeFileSync(join(dir,'modules.json'),JSON.stringify(manifest));
    const result=spawnSync(process.execPath,[resolve(engine),dir,'modules.json'],
      {encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);
    vm.runInContext(result.stdout,sandbox);
  };
  run(first);
  assert.equal(sandbox.m.srv.Facade(),42);
  run(second);
  assert.equal(sandbox.m.srv.Extension(),52);
  run(third);
  const value=sandbox.m.srv.data.MyClass();
  console.log(`Actual generator: redefined MyClass() = ${value}; intended = 77`);
  assert.equal(value,42,'this known source revision exhibits old-export behavior');
  console.log('PASS current generator direct-execution observations');
} finally { rmSync(dir,{recursive:true,force:true}); }
