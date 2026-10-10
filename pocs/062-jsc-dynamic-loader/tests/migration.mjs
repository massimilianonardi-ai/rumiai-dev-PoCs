// PoC: explicit application migration is distinct from managed module replacement.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(await readFile(resolve(import.meta.dirname, '../src/loader.js'), 'utf8'), context);
const runtime = context.JscRuntime;
let disposals = 0;
runtime.install('document', [], (_r, module) => {
  let count = 0;
  module.exports = {
    increment: () => ++count,
    snapshot: () => ({ schema: 1, clicks: count })
  };
  module.onDispose(() => disposals++);
});
const retained = runtime.require('document');
retained.increment(); retained.increment(); retained.increment();
const snapshot = retained.snapshot();
assert.equal(snapshot.clicks, 3);
const oldRevision = runtime.revision('document');
function prepareState(source) {
  if (source?.schema !== 1 || !Number.isSafeInteger(source.clicks) || source.clicks < 0) {
    throw new Error('incompatible persisted document state: full reload or user intervention required');
  }
  return { schema: 2, count: source.clicks };
}
assert.throws(() => prepareState({schema:99, clicks:4}), /incompatible persisted/);
assert.equal(disposals, 0);
assert.equal(runtime.require('document'), retained);
assert.equal(runtime.revision('document'), oldRevision);
const restored = prepareState(snapshot);
runtime.installBatch([{id:'document', deps:[], factory(_r,module) {
  let count = restored.count;
  module.exports = { increment: () => ++count, snapshot: () => ({schema:2,count}) };
}}], {expectedRevisions:{document:oldRevision}});
assert.equal(disposals, 1);
assert.equal(runtime.require('document').increment(), 4);
assert.equal(retained.snapshot().schema, 1, 'held legacy exports remain stale');
assert.equal(retained.increment(), 4, 'legacy exported closure is still callable');
assert.notEqual(retained, runtime.require('document'));
assert.throws(() => runtime.installBatch([{id:'document',deps:[],factory(){}}],{expectedRevisions:{document:oldRevision}}),/stale/);
assert.equal(runtime.require('document').snapshot().count, 4);
// A valid definition can still fail during initialization: there is no state rollback.
runtime.installBatch([{id:'document',deps:[],factory(){throw Error('new version init failed');}}]);
assert.throws(() => runtime.require('document'), /new version init failed/);
assert.equal(runtime.state().active, 0);
console.log('PASS: explicit v1->v2 state migration, incompatible-state guard, retained stale handles, stale revision, initialization failure requires recovery');
