'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {normalizeOperation, duplicatedWatchIdentity} = require(path.resolve(__dirname, '..', 'candidate.js'));

const legacy = normalizeOperation({
  incremental: {
    inputs: {
      source: {path: 'src/input.txt'},
      generated: {output: {operation: 'generate', name: 'artifact'}},
      headers: {collection: 'headers'}
    }
  }
});

const shared = normalizeOperation({
  inputs: {
    source: {path: 'src/input.txt'},
    generated: {output: {operation: 'generate', name: 'artifact'}},
    headers: {collection: 'headers'}
  },
  incremental: {}
});

assert.deepEqual(shared, legacy, 'legacy and shared incremental forms must normalize identically');
assert.equal(shared.incremental.enabled, true);
assert.deepEqual(shared.dataDependencies, [
  {type: 'operation', name: 'generate'},
  {type: 'collection', name: 'headers'}
]);

const watchOnly = normalizeOperation({
  inputs: {
    source: {path: 'opaque.txt'},
    generated: {output: {operation: 'prepare', name: 'file'}}
  }
});
assert.equal(watchOnly.incremental.enabled, false, 'first-class inputs must not imply incremental reuse');
assert.deepEqual(watchOnly.inputs, {
  source: {type: 'path', path: 'opaque.txt'},
  generated: {type: 'output', operation: 'prepare', name: 'file'}
});
assert.deepEqual(watchOnly.dataDependencies, [{type: 'operation', name: 'prepare'}]);

const collectionOnly = normalizeOperation({
  inputs: {
    sources: {collection: 'sources'}
  }
});
assert.deepEqual(collectionOnly.dataDependencies, [{type: 'collection', name: 'sources'}]);

assert.throws(
  () => normalizeOperation({
    inputs: {source: {path: 'a'}},
    incremental: {inputs: {source: {path: 'a'}}}
  }),
  /must not declare both inputs and incremental\.inputs/
);

const emptyLegacy = normalizeOperation({incremental: {inputs: {}}});
assert.equal(emptyLegacy.incremental.enabled, true);
assert.deepEqual(emptyLegacy.inputs, {});

const duplicates = duplicatedWatchIdentity({
  incremental: {
    inputs: {
      source: {path: 'src/input.txt'},
      config: {path: 'build.conf'}
    }
  },
  watch: {
    inputs: {
      source: {path: 'src/input.txt'},
      config: {path: 'build.conf'}
    }
  }
});
assert.deepEqual(duplicates, ['config', 'source'], 'separate watch.inputs duplicates common input identity');

process.stdout.write('PASS PoC 022 shared operation input identity\n');
process.stdout.write('RESULT shared-input-map=smaller-than-separate-watch-inputs\n');
