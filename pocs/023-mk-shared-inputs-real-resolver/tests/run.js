'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {loadCandidate} = require(path.resolve(__dirname, '..', 'candidate-engine.js'));

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 023: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
process.env.m_ROOT = targetRoot;

function statePath() {
  const result = childProcess.spawnSync(path.join(targetRoot, 'm'), [
    path.join(targetRoot, 'bin', 'sys', 'state-path'),
    'user', 'sys', 'mk', 'cache'
  ], {encoding: 'utf8', env: process.env});
  assert.equal(result.status, 0, `cannot resolve mk cache root: ${result.stderr}`);
  return result.stdout.trim();
}

function cacheProject(project) {
  const canonical = fs.realpathSync(project);
  const key = crypto.createHash('sha256').update(canonical).digest('hex');
  return path.join(statePath(), 'projects', key);
}

const engine = loadCandidate(targetRoot);
const {mkMain} = engine;
const mk = engine.__poc;

function resolve(project, goals) {
  const projectRoot = fs.realpathSync(project);
  const config = mk._loadProjectConfig(path.join(projectRoot, 'mk.json'));
  const model = mk._selectModel(config, null);
  mk._validateReferences(model);
  const runtime = {
    results: {},
    skipped: new Set(),
    collectionState: {},
    providerMembers: {},
    providerState: {}
  };
  const plan = mk._resolveV2(projectRoot, model, goals, runtime);
  return {model, runtime, plan: mk._publicPlan(plan, [])};
}

function execute(project, goals) {
  const status = mkMain(['--project', project, ...goals]);
  assert.equal(status, 0, `candidate mk execution failed for ${goals.join(',')}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc023-'));
const caches = [];

try {
  const legacy = path.join(root, 'legacy');
  const shared = path.join(root, 'shared');
  for (const project of [legacy, shared]) {
    fs.mkdirSync(path.join(project, 'src'), {recursive: true});
    fs.writeFileSync(path.join(project, 'src', 'input.txt'), 'alpha\n');
  }

  const operationBody = {
    action: {
      type: 'process',
      command: 'sh',
      args: ['-c', 'mkdir -p out; cp src/input.txt out/artifact']
    },
    outputs: {
      artifact: {path: 'out/artifact'}
    }
  };

  fs.writeFileSync(path.join(legacy, 'mk.json'), JSON.stringify({
    version: 2,
    goals: {build: ['compile']},
    operations: {
      compile: {
        incremental: {inputs: {source: {path: 'src/input.txt'}}},
        ...operationBody
      }
    }
  }));

  fs.writeFileSync(path.join(shared, 'mk.json'), JSON.stringify({
    version: 2,
    goals: {build: ['compile']},
    operations: {
      compile: {
        inputs: {source: {path: 'src/input.txt'}},
        incremental: {},
        ...operationBody
      }
    }
  }));

  caches.push(cacheProject(legacy), cacheProject(shared));
  for (const cache of caches) fs.rmSync(cache, {recursive: true, force: true});

  const legacyInitial = resolve(legacy, ['build']);
  const sharedInitial = resolve(shared, ['build']);
  assert.deepEqual(
    legacyInitial.model.operations.compile,
    sharedInitial.model.operations.compile,
    'legacy and shared forms did not normalize to identical real operation model'
  );
  assert.equal(
    legacyInitial.runtime.incrementalFingerprints.compile,
    sharedInitial.runtime.incrementalFingerprints.compile,
    'legacy and shared forms did not produce the same real incremental fingerprint'
  );

  execute(legacy, ['build']);
  execute(shared, ['build']);
  assert.equal(resolve(legacy, ['build']).plan.operations.find(x => x.name === 'compile').state, 'up-to-date');
  assert.equal(resolve(shared, ['build']).plan.operations.find(x => x.name === 'compile').state, 'up-to-date');

  const watchOnly = path.join(root, 'watch-only');
  fs.mkdirSync(watchOnly);
  fs.writeFileSync(path.join(watchOnly, 'opaque.txt'), 'one\n');
  fs.writeFileSync(path.join(watchOnly, 'mk.json'), JSON.stringify({
    version: 2,
    goals: {run: ['copy']},
    operations: {
      copy: {
        inputs: {source: {path: 'opaque.txt'}},
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'cat opaque.txt > out.txt']
        }
      }
    }
  }));

  let state = resolve(watchOnly, ['run']);
  assert.equal(state.plan.operations.find(x => x.name === 'copy').state, 'ready');
  assert.equal(state.runtime.incrementalFingerprints.copy, undefined, 'non-incremental input unexpectedly enabled cache fingerprint');
  const firstInputSnapshot = JSON.stringify(state.runtime.operationInputSnapshots.copy);
  execute(watchOnly, ['run']);
  state = resolve(watchOnly, ['run']);
  assert.equal(state.plan.operations.find(x => x.name === 'copy').state, 'ready', 'non-incremental input operation became up-to-date');
  fs.writeFileSync(path.join(watchOnly, 'opaque.txt'), 'two\n');
  const secondInputSnapshot = JSON.stringify(resolve(watchOnly, ['run']).runtime.operationInputSnapshots.copy);
  assert.notEqual(secondInputSnapshot, firstInputSnapshot, 'non-incremental declared path input remained invisible');

  const data = path.join(root, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'mk.json'), JSON.stringify({
    version: 2,
    goals: {build: ['consume']},
    operations: {
      produce: {
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'printf artifact > produced']
        },
        outputs: {artifact: {path: 'produced'}}
      },
      consume: {
        inputs: {artifact: {output: {operation: 'produce', name: 'artifact'}}},
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'cat produced > consumed']
        }
      }
    }
  }));
  const dataPlan = resolve(data, ['build']).plan.operations;
  assert.equal(dataPlan.find(x => x.name === 'produce').state, 'ready');
  assert.equal(dataPlan.find(x => x.name === 'consume').state, 'blocked');
  execute(data, ['build']);
  assert.equal(fs.readFileSync(path.join(data, 'consumed'), 'utf8'), 'artifact');

  const collection = path.join(root, 'collection');
  fs.mkdirSync(path.join(collection, 'src'), {recursive: true});
  fs.writeFileSync(path.join(collection, 'src', 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(collection, 'mk.json'), JSON.stringify({
    version: 2,
    goals: {build: ['scan']},
    collections: {sources: {type: 'files', root: 'src'}},
    operations: {
      scan: {
        inputs: {sources: {collection: 'sources'}},
        action: {type: 'process', command: 'sh', args: ['-c', 'printf scan > scanned']}
      }
    }
  }));
  const collectionResolved = resolve(collection, ['build']);
  assert.deepEqual(collectionResolved.plan.collections.map(x => x.name), ['sources']);
  assert.ok(collectionResolved.runtime.operationInputSnapshots.scan, 'collection input snapshot was not resolved');

  const ambiguous = path.join(root, 'ambiguous');
  fs.mkdirSync(ambiguous);
  fs.writeFileSync(path.join(ambiguous, 'mk.json'), JSON.stringify({
    version: 2,
    goals: {build: ['x']},
    operations: {
      x: {
        inputs: {a: {path: 'a'}},
        incremental: {inputs: {b: {path: 'b'}}},
        action: {type: 'process', command: 'sh', args: ['-c', 'printf x > out']},
        outputs: {out: {path: 'out'}}
      }
    }
  }));
  assert.equal(mkMain(['--project', ambiguous, '--plan', 'build']), 1, 'ambiguous dual input declaration was accepted');

  process.stdout.write('PASS PoC 023 shared inputs in real mk resolver\n');
  process.stdout.write('RESULT legacy-incremental-inputs=compatible\n');
  process.stdout.write('RESULT nonincremental-declared-input=observable-without-cache-reuse\n');
} catch (error) {
  process.stderr.write(`FAIL PoC 023: ${error.stack || error.message}\n`);
  process.exitCode = 1;
} finally {
  for (const cache of caches) fs.rmSync(cache, {recursive: true, force: true});
  fs.rmSync(root, {recursive: true, force: true});
}
