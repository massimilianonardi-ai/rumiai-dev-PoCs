// Node-only GC experiment: registry storage after repeated updates; NOT proof for a browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

if (typeof global.gc !== 'function') throw Error('run: node --expose-gc tests/memory.mjs');
const loader = await readFile(resolve(import.meta.dirname, '../src/loader.js'),'utf8');
const context = vm.createContext({});
vm.runInContext(loader,context);
const api = context.JscRuntime;
const readings = [];
function churn(n) {
  for (let i=0;i<n;i++) {
    api.install('swap',[],function(_r,module) {
      const payload=new Array(1024).fill(i); // roughly 8 KiB per live instance
      module.exports.sum=()=>payload[0];
      module.onDispose(()=>payload.fill(null));
    });
    assert.equal(api.require('swap').sum(),i);
    assert.equal(api.state().registered,1);
    assert.equal(api.state().active,1);
  }
  api.invalidate('swap');
  global.gc(); global.gc();
  readings.push(process.memoryUsage().heapUsed);
}
churn(1000);churn(2000);churn(2000);churn(2000);
const growth=readings.at(-1)-readings[1];
console.log('Node GC post-window heap MiB:',readings.map(n=>(n/1048576).toFixed(2)).join(', '));
console.log('Growth vs second window MiB:',(growth/1048576).toFixed(2));
assert.ok(growth < 8*1048576,'potential unbounded retained memory; investigate with heap snapshots');
console.log('PASS: experimental Node GC plateau check (not browser heap, not a lifetime guarantee)');
