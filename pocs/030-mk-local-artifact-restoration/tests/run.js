'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {encoding: 'utf8', ...options});
  if (result.error) throw result.error;
  return result;
}

function lines(file) {
  if (!fs.existsSync(file)) return [];
  const value = fs.readFileSync(file, 'utf8').trim();
  return value === '' ? [] : value.split('\n').filter(Boolean);
}

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 030: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
const candidate = path.resolve(__dirname, '..', 'candidate-engine.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc030-'));
const project = path.join(root, 'project');
let cacheProject = null;

function candidateRun(projectRoot, args) {
  return run(process.execPath, [candidate, '--project', projectRoot, ...args], {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
}

function statePath() {
  const result = run(path.join(targetRoot, 'm'), [
    path.join(targetRoot, 'bin', 'sys', 'state-path'),
    'user', 'sys', 'mk', 'cache'
  ], {env: {...process.env, m_ROOT: targetRoot}});
  assert(result.status === 0, `cannot resolve mk cache root: ${result.stderr}`);
  return result.stdout.trim();
}

try {
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'file.txt'), 'FILE-ONE\n');
  fs.writeFileSync(path.join(project, 'src', 'tree.txt'), 'TREE-ONE\n');
  fs.writeFileSync(path.join(project, 'src', 'multi.txt'), 'MULTI-ONE\n');
  fs.writeFileSync(path.join(project, 'src', 'producer.txt'), 'PRODUCER-ONE\n');
  fs.writeFileSync(path.join(project, 'src', 'provider-a.txt'), 'PROVIDER-A\n');
  fs.writeFileSync(path.join(project, 'src', 'provider-b.txt'), 'PROVIDER-B\n');

  const config = {
    version: 2,
    goals: {
      file: ['file'],
      tree: ['tree'],
      multi: ['multi'],
      chain: ['consumer'],
      provider: ['compile'],
      observed: ['observe']
    },
    collections: {
      providerSources: {
        type: 'files',
        root: 'src',
        include: ['provider-a.txt', 'provider-b.txt']
      }
    },
    providers: {
      compile: {
        type: 'map-process',
        collection: 'providerSources',
        outputs: {artifact: {path: 'out/${item}.out'}},
        incremental: {},
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'mkdir -p "$(dirname "$2")"; cp "$1" "$2"; printf "%s\\n" "$1" >> provider.trace', 'p', '${item}', 'out/${item}.out']
        }
      }
    },
    operations: {
      file: {
        inputs: {source: {path: 'src/file.txt'}},
        incremental: {},
        outputs: {artifact: {path: 'out/file.out'}},
        action: {type: 'process', command: 'sh', args: ['-c', 'mkdir -p out; cp src/file.txt out/file.out; printf run >> file.trace']}
      },
      tree: {
        inputs: {source: {path: 'src/tree.txt'}},
        incremental: {},
        outputs: {artifact: {path: 'out/tree'}},
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'mkdir -p out/tree/sub; cp src/tree.txt out/tree/value; cp src/tree.txt out/tree/sub/tool; chmod 755 out/tree/sub/tool; printf run >> tree.trace']
        }
      },
      multi: {
        inputs: {source: {path: 'src/multi.txt'}},
        incremental: {},
        outputs: {
          first: {path: 'out/multi-a'},
          second: {path: 'out/multi-dir'}
        },
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'mkdir -p out/multi-dir; cp src/multi.txt out/multi-a; cp src/multi.txt out/multi-dir/b; printf run >> multi.trace']
        }
      },
      producer: {
        inputs: {source: {path: 'src/producer.txt'}},
        incremental: {},
        outputs: {artifact: {path: 'out/producer.out'}},
        action: {type: 'process', command: 'sh', args: ['-c', 'mkdir -p out; cp src/producer.txt out/producer.out; printf run >> producer.trace']}
      },
      consumer: {
        inputs: {generated: {output: {operation: 'producer', name: 'artifact'}}},
        incremental: {},
        outputs: {artifact: {path: 'out/consumer.out'}},
        action: {type: 'process', command: 'sh', args: ['-c', 'cp out/producer.out out/consumer.out; printf run >> consumer.trace']}
      },
      observe: {
        when: {op: 'eq', left: {result: {operation: 'file', field: 'status'}}, right: 0},
        action: {type: 'process', command: 'sh', args: ['-c', 'printf observed > observed.out']}
      }
    }
  };
  fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(config, null, 2) + '\n');

  const projectCanonical = fs.realpathSync(project);
  const projectKey = crypto.createHash('sha256').update(projectCanonical).digest('hex');
  cacheProject = path.join(statePath(), 'projects', projectKey);
  fs.rmSync(cacheProject, {recursive: true, force: true});

  let result = candidateRun(project, ['file']);
  assert(result.status === 0, `initial file build failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'file.trace'), 'utf8') === 'run', 'file action did not execute once');

  fs.unlinkSync(path.join(project, 'out', 'file.out'));
  result = candidateRun(project, ['--plan', 'file']);
  assert(result.status === 0, `missing-output plan failed: ${result.stderr}`);
  assert(!fs.existsSync(path.join(project, 'out', 'file.out')), '--plan restored artifact and mutated project');
  const plan = JSON.parse(result.stdout);
  assert(plan.operations.find(value => value.name === 'file').state === 'ready', 'missing output plan unexpectedly claimed up-to-date');

  result = candidateRun(project, ['file']);
  assert(result.status === 0, `file restore failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'out', 'file.out'), 'utf8') === 'FILE-ONE\n', 'file bytes were not restored');
  assert(fs.readFileSync(path.join(project, 'file.trace'), 'utf8') === 'run', 'file restoration re-executed action');

  fs.writeFileSync(path.join(project, 'out', 'file.out'), 'TAMPERED\n');
  result = candidateRun(project, ['file']);
  assert(result.status === 0, `tampered file restore failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'out', 'file.out'), 'utf8') === 'FILE-ONE\n', 'tampered file was not restored from cache');
  assert(fs.readFileSync(path.join(project, 'file.trace'), 'utf8') === 'run', 'tampered output caused action instead of restore');

  result = candidateRun(project, ['tree']);
  assert(result.status === 0, `initial tree build failed: ${result.stderr}`);
  fs.rmSync(path.join(project, 'out', 'tree'), {recursive: true, force: true});
  result = candidateRun(project, ['tree']);
  assert(result.status === 0, `tree restore failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'out', 'tree', 'sub', 'tool'), 'utf8') === 'TREE-ONE\n', 'nested directory artifact was not restored');
  assert((fs.statSync(path.join(project, 'out', 'tree', 'sub', 'tool')).mode & 0o777) === 0o755, 'restored file mode is wrong');
  assert(fs.readFileSync(path.join(project, 'tree.trace'), 'utf8') === 'run', 'tree restore re-executed action');

  result = candidateRun(project, ['multi']);
  assert(result.status === 0, `initial multi-output build failed: ${result.stderr}`);
  fs.rmSync(path.join(project, 'out', 'multi-a'), {force: true});
  fs.rmSync(path.join(project, 'out', 'multi-dir'), {recursive: true, force: true});
  result = candidateRun(project, ['multi']);
  assert(result.status === 0, `multi-output restore failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'out', 'multi-a'), 'utf8') === 'MULTI-ONE\n', 'first output not restored');
  assert(fs.readFileSync(path.join(project, 'out', 'multi-dir', 'b'), 'utf8') === 'MULTI-ONE\n', 'second output not restored');
  assert(fs.readFileSync(path.join(project, 'multi.trace'), 'utf8') === 'run', 'multi-output restore re-executed action');

  result = candidateRun(project, ['chain']);
  assert(result.status === 0, `initial chain build failed: ${result.stderr}`);
  const producerRuns = fs.readFileSync(path.join(project, 'producer.trace'), 'utf8');
  const consumerRuns = fs.readFileSync(path.join(project, 'consumer.trace'), 'utf8');
  fs.unlinkSync(path.join(project, 'out', 'producer.out'));
  result = candidateRun(project, ['chain']);
  assert(result.status === 0, `producer restore chain failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'producer.trace'), 'utf8') === producerRuns, 'restored producer re-executed');
  assert(fs.readFileSync(path.join(project, 'consumer.trace'), 'utf8') === consumerRuns, 'unchanged output-input consumer re-executed');
  assert(fs.readFileSync(path.join(project, 'out', 'producer.out'), 'utf8') === 'PRODUCER-ONE\n', 'producer output not restored');

  result = candidateRun(project, ['provider']);
  assert(result.status === 0, `initial provider build failed: ${result.stderr}`);
  const providerBefore = lines(path.join(project, 'provider.trace'));
  assert(providerBefore.length === 2, 'provider did not run both members initially');
  fs.unlinkSync(path.join(project, 'out', 'src', 'provider-a.txt.out'));
  result = candidateRun(project, ['provider']);
  assert(result.status === 0, `provider member restore failed: ${result.stderr}`);
  assert(lines(path.join(project, 'provider.trace')).length === 2, 'provider member restore re-executed derived action');
  assert(fs.readFileSync(path.join(project, 'out', 'src', 'provider-a.txt.out'), 'utf8') === 'PROVIDER-A\n', 'provider member artifact not restored');

  const artifactRoot = path.join(cacheProject, 'artifacts');
  const operationHash = crypto.createHash('sha256').update('file').digest('hex');
  const versions = fs.readdirSync(path.join(artifactRoot, operationHash));
  assert(versions.length >= 1, 'file artifact store not found');
  const store = path.join(artifactRoot, operationHash, versions[versions.length - 1]);
  const payloadNames = fs.readdirSync(path.join(store, 'payload'));
  assert(payloadNames.length === 1, 'file artifact payload not found');
  fs.writeFileSync(path.join(store, 'payload', payloadNames[0]), 'CORRUPT\n');
  fs.unlinkSync(path.join(project, 'out', 'file.out'));
  result = candidateRun(project, ['file']);
  assert(result.status === 0, `corrupt-store fallback failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'file.trace'), 'utf8') === 'runrun', 'corrupt store did not conservatively execute action');
  fs.unlinkSync(path.join(project, 'out', 'file.out'));
  result = candidateRun(project, ['file']);
  assert(result.status === 0, `post-repair file restoration failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'file.trace'), 'utf8') === 'runrun', 'repaired artifact store was not reusable');

  fs.unlinkSync(path.join(project, 'out', 'file.out'));
  result = candidateRun(project, ['observed']);
  assert(result.status === 0, `result-observed build failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(project, 'file.trace'), 'utf8') === 'runrunrun', 'result observation incorrectly allowed restoration-only reuse');
  assert(fs.existsSync(path.join(project, 'observed.out')), 'result-observing operation did not execute');

  const moved = path.join(root, 'moved');
  fs.mkdirSync(path.join(moved, 'src'), {recursive: true});
  fs.copyFileSync(path.join(project, 'src', 'file.txt'), path.join(moved, 'src', 'file.txt'));
  fs.writeFileSync(path.join(moved, 'mk.json'), JSON.stringify({
    version: 2,
    goals: {file: ['file']},
    operations: {file: config.operations.file}
  }, null, 2) + '\n');
  result = candidateRun(moved, ['file']);
  assert(result.status === 0, `moved checkout build failed: ${result.stderr}`);
  assert(fs.readFileSync(path.join(moved, 'file.trace'), 'utf8') === 'run', 'moved checkout unexpectedly reused original project artifact cache');

  process.stdout.write('PASS PoC 030 mk local artifact restoration\n');
  process.stdout.write('OBSERVED artifact-cache=local-user-nonauthoritative\n');
  process.stdout.write('OBSERVED restoration=execution-path-only\n');
  process.stdout.write('OBSERVED moved-project=cache-miss\n');
} catch (error) {
  process.stderr.write(`FAIL PoC 030: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (cacheProject !== null) fs.rmSync(cacheProject, {recursive: true, force: true});
  fs.rmSync(root, {recursive: true, force: true});
}
