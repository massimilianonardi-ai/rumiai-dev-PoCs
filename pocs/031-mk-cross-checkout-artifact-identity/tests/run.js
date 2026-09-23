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

function writeProject(root, name, config, source = 'SAME\n') {
  const project = path.join(root, name);
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'input.txt'), source);
  fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(config, null, 2) + '\n');
  return project;
}

function statePath(targetRoot) {
  const result = run(path.join(targetRoot, 'm'), [
    path.join(targetRoot, 'bin', 'sys', 'state-path'),
    'user', 'sys', 'mk', 'cache'
  ], {env: {...process.env, m_ROOT: targetRoot}});
  assert(result.status === 0, `cannot resolve mk cache root: ${result.stderr}`);
  return result.stdout.trim();
}

function key(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 031: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
const candidate = path.resolve(__dirname, '..', 'candidate-engine.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc031-'));
const cacheRoot = statePath(targetRoot);
const sharedRoot = path.join(cacheRoot, 'shared-artifacts');
const projectCacheRoots = [];

function candidateRun(project, args) {
  return run(process.execPath, [candidate, '--project', project, ...args], {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
}

function projectCache(project) {
  const value = path.join(cacheRoot, 'projects', key(fs.realpathSync(project)));
  projectCacheRoots.push(value);
  return value;
}

function traceLines(project) {
  const file = path.join(project, 'trace');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

function basicConfig(commandBody, operationName = 'build') {
  return {
    version: 2,
    goals: {build: [operationName]},
    operations: {
      [operationName]: {
        inputs: {source: {path: 'src/input.txt'}},
        incremental: {},
        outputs: {artifact: {path: 'out/artifact'}},
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', commandBody]
        }
      }
    }
  };
}

try {
  fs.rmSync(sharedRoot, {recursive: true, force: true});

  const sameBody = 'mkdir -p out; cp src/input.txt out/artifact; chmod 755 out/artifact; printf run\\n >> trace';
  const config = basicConfig(sameBody);

  const a = writeProject(root, 'A', config);
  const b = writeProject(root, 'B', config);
  fs.rmSync(projectCache(a), {recursive: true, force: true});
  fs.rmSync(projectCache(b), {recursive: true, force: true});

  let result = candidateRun(a, ['build']);
  assert(result.status === 0, `checkout A build failed: ${result.stderr}`);
  assert(traceLines(a).length === 1, 'checkout A did not execute exactly once');
  assert(fs.existsSync(sharedRoot), 'checkout A did not seed shared artifact storage');

  const bPlan = path.join(root, 'b.plan.json');
  result = candidateRun(b, ['--plan', 'build']);
  assert(result.status === 0, `checkout B plan failed: ${result.stderr}`);
  fs.writeFileSync(bPlan, result.stdout);
  assert(!fs.existsSync(path.join(b, 'out', 'artifact')), 'plan restored B output');
  assert(!fs.existsSync(projectCache(b)), 'plan created B-local freshness metadata');
  const parsed = JSON.parse(result.stdout);
  assert(parsed.operations.find(v => v.name === 'build').state === 'ready', 'B plan did not remain ready before materialization');

  result = candidateRun(b, ['build']);
  assert(result.status === 0, `checkout B shared restoration failed: ${result.stderr}`);
  assert(traceLines(b).length === 0, 'checkout B action executed instead of shared restoration');
  assert(fs.readFileSync(path.join(b, 'out', 'artifact'), 'utf8') === 'SAME\n', 'checkout B bytes not restored');
  assert((fs.statSync(path.join(b, 'out', 'artifact')).mode & 0o777) === 0o755, 'checkout B restored mode is wrong');
  assert(fs.existsSync(projectCache(b)), 'shared restoration did not establish B-local freshness evidence');

  result = candidateRun(b, ['--plan', 'build']);
  assert(result.status === 0, 'B post-restore plan failed');
  assert(JSON.parse(result.stdout).operations.find(v => v.name === 'build').state === 'up-to-date', 'B did not become locally up-to-date after restore');

  const changedDefinition = basicConfig('mkdir -p out; printf marker >/dev/null; cp src/input.txt out/artifact; chmod 755 out/artifact; printf run\\n >> trace');
  const c = writeProject(root, 'C', changedDefinition);
  fs.rmSync(projectCache(c), {recursive: true, force: true});
  result = candidateRun(c, ['build']);
  assert(result.status === 0, `changed-definition build failed: ${result.stderr}`);
  assert(traceLines(c).length === 1, 'different operation definition falsely reused shared artifact');

  const constantConfig = basicConfig('mkdir -p out; printf SAME\\n > out/artifact; chmod 755 out/artifact; printf run\\n >> trace');
  const d = writeProject(root, 'D', constantConfig, 'DIFFERENT-INPUT\n');
  fs.rmSync(projectCache(d), {recursive: true, force: true});
  result = candidateRun(d, ['build']);
  assert(result.status === 0, `different-input build failed: ${result.stderr}`);
  assert(traceLines(d).length === 1, 'different input identity falsely reused byte-compatible artifact');

  const otherName = writeProject(root, 'E', basicConfig(sameBody, 'other'));
  fs.rmSync(projectCache(otherName), {recursive: true, force: true});
  result = candidateRun(otherName, ['build']);
  assert(result.status === 0, `different-operation-name build failed: ${result.stderr}`);
  assert(traceLines(otherName).length === 1, 'different operation name unexpectedly shared artifact identity');

  // Corrupt the shared artifact seeded by a fresh canonical-equivalent checkout,
  // then prove a new checkout conservatively executes and refreshes it.
  const seed = writeProject(root, 'Seed', config);
  fs.rmSync(projectCache(seed), {recursive: true, force: true});
  result = candidateRun(seed, ['build']);
  assert(result.status === 0, 'corruption seed build failed');
  // Its fingerprint is one directory in sharedRoot; find the newest matching store
  // by locating a manifest whose operation is build and output snapshot matches SAME.
  let corruptStore = null;
  for (const name of fs.readdirSync(sharedRoot)) {
    const manifestPath = path.join(sharedRoot, name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.operation === 'build' && manifest.outputs.artifact && manifest.outputs.artifact.sha256 === key('SAME\n')) {
      corruptStore = path.join(sharedRoot, name);
    }
  }
  assert(corruptStore !== null, 'cannot locate shared store to corrupt');
  const payloadFiles = fs.readdirSync(path.join(corruptStore, 'payload'));
  assert(payloadFiles.length === 1, 'unexpected shared payload shape');
  fs.writeFileSync(path.join(corruptStore, 'payload', payloadFiles[0]), 'CORRUPT\n');

  const afterCorrupt = writeProject(root, 'AfterCorrupt', config);
  fs.rmSync(projectCache(afterCorrupt), {recursive: true, force: true});
  result = candidateRun(afterCorrupt, ['build']);
  assert(result.status === 0, `corrupt shared fallback failed: ${result.stderr}`);
  assert(traceLines(afterCorrupt).length === 1, 'corrupt shared artifact did not cause conservative execution');
  assert(fs.readFileSync(path.join(afterCorrupt, 'out', 'artifact'), 'utf8') === 'SAME\n', 'fallback execution output wrong');

  // Provider-derived member: identical checkout restores without executing mapped action.
  const providerConfig = {
    version: 2,
    goals: {build: ['compile']},
    collections: {sources: {type: 'files', root: 'src', include: ['input.txt']}},
    providers: {
      compile: {
        type: 'map-process',
        collection: 'sources',
        outputs: {artifact: {path: 'out/${item}.out'}},
        incremental: {},
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'mkdir -p "$(dirname "$2")"; cp "$1" "$2"; printf run\\n >> provider.trace', 'sh', '${item}', 'out/${item}.out']
        }
      }
    }
  };
  const p1 = writeProject(root, 'P1', providerConfig);
  const p2 = writeProject(root, 'P2', providerConfig);
  fs.rmSync(projectCache(p1), {recursive: true, force: true});
  fs.rmSync(projectCache(p2), {recursive: true, force: true});
  result = candidateRun(p1, ['build']);
  assert(result.status === 0 && traceLines(p1).length === 0, 'provider trace helper used wrong file');
  const p1Trace = path.join(p1, 'provider.trace');
  assert(fs.existsSync(p1Trace) && fs.readFileSync(p1Trace, 'utf8').trim().split('\n').length === 1, 'provider seed did not execute one member');
  result = candidateRun(p2, ['build']);
  assert(result.status === 0, `provider cross-checkout restoration failed: ${result.stderr}`);
  assert(!fs.existsSync(path.join(p2, 'provider.trace')), 'provider member action executed instead of shared restore');
  assert(fs.readFileSync(path.join(p2, 'out', 'src', 'input.txt.out'), 'utf8') === 'SAME\n', 'provider artifact not restored');

  process.stdout.write('PASS PoC 031 cross-checkout shared artifact identity\n');
  process.stdout.write('OBSERVED freshness-metadata=project-scoped\n');
  process.stdout.write('OBSERVED artifact-bytes=fingerprint-shared-local\n');
  process.stdout.write('OBSERVED remote-transport=not-required\n');
} catch (error) {
  process.stderr.write(`FAIL PoC 031: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  for (const projectCacheRoot of projectCacheRoots) fs.rmSync(projectCacheRoot, {recursive: true, force: true});
  fs.rmSync(sharedRoot, {recursive: true, force: true});
  fs.rmSync(root, {recursive: true, force: true});
}
