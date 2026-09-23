'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, message, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {encoding: 'utf8', ...options});
  if (result.error) throw result.error;
  return result;
}

function spawnCandidate(candidate, targetRoot, project, controls = {}) {
  return childProcess.spawn(process.execPath, [candidate, '--project', project, 'build'], {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot, ...controls},
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function childResult(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve({status, signal, stdout, stderr}));
  });
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

function projectCache(cacheRoot, project) {
  return path.join(cacheRoot, 'projects', key(fs.realpathSync(project)));
}

function writeProject(root, name, config, source = 'SAME\n') {
  const project = path.join(root, name);
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'input.txt'), source);
  fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(config, null, 2) + '\n');
  return project;
}

function traceLines(project) {
  const file = path.join(project, 'trace');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

function basicConfig(commandBody) {
  return {
    version: 2,
    goals: {build: ['build']},
    operations: {
      build: {
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

function resetShared(sharedRoot) {
  fs.rmSync(sharedRoot, {recursive: true, force: true});
}

function fingerprintRoots(sharedRoot) {
  if (!fs.existsSync(sharedRoot)) return [];
  return fs.readdirSync(sharedRoot)
    .filter(name => /^[a-f0-9]{64}$/.test(name))
    .map(name => path.join(sharedRoot, name));
}

function currentCandidate(sharedRoot) {
  const roots = fingerprintRoots(sharedRoot);
  assert(roots.length === 1, `expected one fingerprint root, found ${roots.length}`);
  const root = roots[0];
  const currentPath = path.join(root, 'current');
  assert(fs.existsSync(currentPath), 'shared fingerprint has no current selector');
  const candidate = fs.readFileSync(currentPath, 'utf8').trim();
  assert(/^[a-f0-9]{64}(?:-[a-z0-9-]+)?$/.test(candidate), 'invalid current candidate id');
  const candidatePath = path.join(root, 'candidates', candidate);
  assert(fs.existsSync(candidatePath), 'selected candidate directory is missing');
  const manifest = JSON.parse(fs.readFileSync(path.join(candidatePath, 'manifest.json'), 'utf8'));
  const payloadNames = fs.readdirSync(path.join(candidatePath, 'payload'));
  assert(payloadNames.length === 1, 'unexpected payload count');
  return {
    root,
    candidate,
    candidatePath,
    manifest,
    payloadPath: path.join(candidatePath, 'payload', payloadNames[0])
  };
}

function assertNoAttemptTemps(root) {
  const names = fs.existsSync(root) ? fs.readdirSync(root) : [];
  assert(!names.some(name => name.startsWith('.staging-') || name.startsWith('.current-')),
    `attempt temporary state leaked: ${names.join(',')}`);
}

function candidateCount(root) {
  const dir = path.join(root, 'candidates');
  return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
}

async function scenarioEquivalentWriters(root, candidate, targetRoot, cacheRoot, sharedRoot) {
  resetShared(sharedRoot);
  const barrier = path.join(root, 'publish-release');
  const command = `touch action-ready; while [ ! -f "${barrier}" ]; do sleep 0.02; done; mkdir -p out; cp src/input.txt out/artifact; chmod 755 out/artifact; printf run\\n >> trace`;
  const config = basicConfig(command);
  const a = writeProject(root, 'race-a', config, 'RACE\n');
  const b = writeProject(root, 'race-b', config, 'RACE\n');
  fs.rmSync(projectCache(cacheRoot, a), {recursive: true, force: true});
  fs.rmSync(projectCache(cacheRoot, b), {recursive: true, force: true});

  const ca = spawnCandidate(candidate, targetRoot, a);
  const cb = spawnCandidate(candidate, targetRoot, b);
  const ra = childResult(ca);
  const rb = childResult(cb);

  await waitFor(() => fs.existsSync(path.join(a, 'action-ready')) && fs.existsSync(path.join(b, 'action-ready')),
    'equivalent publishers did not both reach action barrier');
  fs.writeFileSync(barrier, 'release\n');

  const [aResult, bResult] = await Promise.all([ra, rb]);
  assert(aResult.status === 0 && aResult.signal === null, `publisher A failed: ${aResult.stderr}`);
  assert(bResult.status === 0 && bResult.signal === null, `publisher B failed: ${bResult.stderr}`);
  assert(traceLines(a).length === 1 && traceLines(b).length === 1, 'equivalent writers did not both execute');
  assert(fs.existsSync(projectCache(cacheRoot, a)) && fs.existsSync(projectCache(cacheRoot, b)),
    'publisher freshness metadata is not project scoped');

  const selected = currentCandidate(sharedRoot);
  assert(fs.readFileSync(selected.payloadPath, 'utf8') === 'RACE\n', 'selected concurrent payload is incomplete');
  assert(candidateCount(selected.root) === 1, 'equivalent writers did not converge on one deterministic candidate');
  assertNoAttemptTemps(selected.root);
}

async function scenarioSlowLoser(root, candidate, targetRoot, cacheRoot, sharedRoot) {
  resetShared(sharedRoot);
  const barrier = path.join(root, 'slow-action-release');
  const stageMarker = path.join(root, 'slow-stage-ready');
  const stageRelease = path.join(root, 'slow-stage-release');
  const command = `touch action-ready; while [ ! -f "${barrier}" ]; do sleep 0.02; done; mkdir -p out; cp src/input.txt out/artifact; printf run\\n >> trace`;
  const config = basicConfig(command);
  const slow = writeProject(root, 'slow-writer', config, 'SLOW\n');
  const fast = writeProject(root, 'fast-writer', config, 'SLOW\n');
  fs.rmSync(projectCache(cacheRoot, slow), {recursive: true, force: true});
  fs.rmSync(projectCache(cacheRoot, fast), {recursive: true, force: true});

  const slowChild = spawnCandidate(candidate, targetRoot, slow, {
    RUMIAI_POC_ARTIFACT_STAGE_MARKER: stageMarker,
    RUMIAI_POC_ARTIFACT_STAGE_WAIT: stageRelease
  });
  const fastChild = spawnCandidate(candidate, targetRoot, fast);
  const slowResultPromise = childResult(slowChild);
  const fastResultPromise = childResult(fastChild);

  await waitFor(() => fs.existsSync(path.join(slow, 'action-ready')) && fs.existsSync(path.join(fast, 'action-ready')),
    'slow/fast publishers did not both reach action barrier');
  fs.writeFileSync(barrier, 'release\n');
  await waitFor(() => fs.existsSync(stageMarker), 'slow publisher did not pause after verified staging');

  const fastResult = await fastResultPromise;
  assert(fastResult.status === 0, `fast publisher failed: ${fastResult.stderr}`);
  assert(slowChild.exitCode === null, 'slow publisher exited before staging pause was released');

  const during = currentCandidate(sharedRoot);
  assert(fs.readFileSync(during.payloadPath, 'utf8') === 'SLOW\n',
    'winner publication was not complete while loser remained staged');
  assert(candidateCount(during.root) === 1, 'winner exposed unexpected candidate count');

  fs.writeFileSync(stageRelease, 'release\n');
  const slowResult = await slowResultPromise;
  assert(slowResult.status === 0, `slow publisher failed after release: ${slowResult.stderr}`);

  const final = currentCandidate(sharedRoot);
  assert(final.candidate === during.candidate, 'slow loser replaced equivalent winner candidate identity');
  assert(candidateCount(final.root) === 1, 'slow loser left a duplicate committed candidate');
  assertNoAttemptTemps(final.root);
}

async function scenarioFailedStaging(root, candidate, targetRoot, cacheRoot, sharedRoot) {
  resetShared(sharedRoot);
  const config = basicConfig('mkdir -p out; cp src/input.txt out/artifact; printf run\\n >> trace');
  const failed = writeProject(root, 'failed-stage', config, 'FAILSAFE\n');
  fs.rmSync(projectCache(cacheRoot, failed), {recursive: true, force: true});

  const result = run(process.execPath, [candidate, '--project', failed, 'build'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RUMIAI_POC_RUMIAI_OS: targetRoot,
      RUMIAI_POC_ARTIFACT_FAIL_AFTER_STAGE: '1'
    }
  });
  assert(result.status === 0, `non-authoritative staging failure failed lifecycle: ${result.stderr}`);
  assert(traceLines(failed).length === 1, 'failed staging scenario action did not execute');
  assert(fs.existsSync(projectCache(cacheRoot, failed)), 'failed artifact publication lost local freshness evidence');

  const roots = fingerprintRoots(sharedRoot);
  assert(roots.length === 1, 'failed staging did not create expected fingerprint namespace');
  assert(!fs.existsSync(path.join(roots[0], 'current')), 'failed staging exposed a current selector');
  assert(candidateCount(roots[0]) === 0, 'failed staging exposed a committed candidate');
  assertNoAttemptTemps(roots[0]);

  const recovery = writeProject(root, 'after-failed-stage', config, 'FAILSAFE\n');
  fs.rmSync(projectCache(cacheRoot, recovery), {recursive: true, force: true});
  const recovered = run(process.execPath, [candidate, '--project', recovery, 'build'], {
    encoding: 'utf8',
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(recovered.status === 0, `publication after failed staging failed: ${recovered.stderr}`);
  assert(traceLines(recovery).length === 1, 'later publisher incorrectly restored from failed staging');
  const selected = currentCandidate(sharedRoot);
  assert(fs.readFileSync(selected.payloadPath, 'utf8') === 'FAILSAFE\n', 'later publisher produced invalid artifact');
  assertNoAttemptTemps(selected.root);
  return {config, selected};
}

async function scenarioConcurrentRestores(root, candidate, targetRoot, cacheRoot, sharedRoot, config, expectedCandidate) {
  const r1 = writeProject(root, 'restore-one', config, 'FAILSAFE\n');
  const r2 = writeProject(root, 'restore-two', config, 'FAILSAFE\n');
  fs.rmSync(projectCache(cacheRoot, r1), {recursive: true, force: true});
  fs.rmSync(projectCache(cacheRoot, r2), {recursive: true, force: true});

  const release = path.join(root, 'restore-release');
  const marker1 = path.join(root, 'restore-one-ready');
  const marker2 = path.join(root, 'restore-two-ready');

  const c1 = spawnCandidate(candidate, targetRoot, r1, {
    RUMIAI_POC_ARTIFACT_RESTORE_MARKER: marker1,
    RUMIAI_POC_ARTIFACT_RESTORE_WAIT: release
  });
  const c2 = spawnCandidate(candidate, targetRoot, r2, {
    RUMIAI_POC_ARTIFACT_RESTORE_MARKER: marker2,
    RUMIAI_POC_ARTIFACT_RESTORE_WAIT: release
  });
  const p1 = childResult(c1);
  const p2 = childResult(c2);

  await waitFor(() => fs.existsSync(marker1) && fs.existsSync(marker2),
    'simultaneous restorers did not both capture verified candidate');
  assert(traceLines(r1).length === 0 && traceLines(r2).length === 0,
    'restore action executed before release');
  fs.writeFileSync(release, 'release\n');

  const [one, two] = await Promise.all([p1, p2]);
  assert(one.status === 0 && two.status === 0, `simultaneous restore failed: ${one.stderr} ${two.stderr}`);
  assert(traceLines(r1).length === 0 && traceLines(r2).length === 0,
    'simultaneous restore executed an action');
  assert(fs.readFileSync(path.join(r1, 'out', 'artifact'), 'utf8') === 'FAILSAFE\n', 'restore-one bytes wrong');
  assert(fs.readFileSync(path.join(r2, 'out', 'artifact'), 'utf8') === 'FAILSAFE\n', 'restore-two bytes wrong');
  assert(fs.existsSync(projectCache(cacheRoot, r1)) && fs.existsSync(projectCache(cacheRoot, r2)),
    'receiving checkout freshness metadata was not written project-locally');

  const selected = currentCandidate(sharedRoot);
  assert(selected.candidate === expectedCandidate, 'concurrent restores mutated shared selector');
  assert(candidateCount(selected.root) === 1, 'concurrent restores mutated candidate set');
  assertNoAttemptTemps(selected.root);
}

async function scenarioCorruptRefresh(root, candidate, targetRoot, cacheRoot, sharedRoot, config) {
  const before = currentCandidate(sharedRoot);
  fs.writeFileSync(before.payloadPath, 'CORRUPT\n');

  const publisher = writeProject(root, 'corrupt-refresh-publisher', config, 'FAILSAFE\n');
  fs.rmSync(projectCache(cacheRoot, publisher), {recursive: true, force: true});
  const publishedMarker = path.join(root, 'refresh-published');
  const publishRelease = path.join(root, 'refresh-release');

  const child = spawnCandidate(candidate, targetRoot, publisher, {
    RUMIAI_POC_ARTIFACT_AFTER_PUBLISH_MARKER: publishedMarker,
    RUMIAI_POC_ARTIFACT_AFTER_PUBLISH_WAIT: publishRelease
  });
  const publisherResultPromise = childResult(child);

  await waitFor(() => fs.existsSync(publishedMarker), 'refresh publisher did not atomically select recovery candidate');
  assert(child.exitCode === null, 'refresh publisher exited before post-publish pause');

  const refreshed = currentCandidate(sharedRoot);
  assert(refreshed.candidate !== before.candidate, 'corrupt candidate was replaced in place instead of recovered immutably');
  assert(fs.existsSync(before.candidatePath), 'refresh deleted corrupt candidate that a reader could still hold');
  assert(fs.readFileSync(refreshed.payloadPath, 'utf8') === 'FAILSAFE\n', 'recovery candidate is incomplete');
  assert(candidateCount(refreshed.root) >= 2, 'recovery candidate was not published alongside corrupt immutable candidate');

  const reader = writeProject(root, 'restore-during-refresh', config, 'FAILSAFE\n');
  fs.rmSync(projectCache(cacheRoot, reader), {recursive: true, force: true});
  const restored = run(process.execPath, [candidate, '--project', reader, 'build'], {
    encoding: 'utf8',
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(restored.status === 0, `restore during refresh failed: ${restored.stderr}`);
  assert(traceLines(reader).length === 0, 'reader executed instead of restoring newly selected recovery candidate');
  assert(fs.readFileSync(path.join(reader, 'out', 'artifact'), 'utf8') === 'FAILSAFE\n',
    'reader saw incomplete recovery artifact');
  assert(fs.existsSync(projectCache(cacheRoot, reader)), 'reader did not write project-local freshness metadata');

  fs.writeFileSync(publishRelease, 'release\n');
  const publisherResult = await publisherResultPromise;
  assert(publisherResult.status === 0, `refresh publisher failed after release: ${publisherResult.stderr}`);

  const final = currentCandidate(sharedRoot);
  assert(fs.readFileSync(final.payloadPath, 'utf8') === 'FAILSAFE\n', 'final selected recovery artifact is unreadable');
  assert(fs.existsSync(before.candidatePath), 'publisher cleanup removed older committed candidate');
  assertNoAttemptTemps(final.root);
}

(async () => {
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  if (!target) throw new Error('RUMIAI_POC_RUMIAI_OS is required');

  const targetRoot = fs.realpathSync(target);
  const candidate = path.resolve(__dirname, '..', 'candidate-engine.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc032-'));
  const cacheRoot = statePath(targetRoot);
  const sharedRoot = path.join(cacheRoot, 'shared-artifacts');

  try {
    await scenarioEquivalentWriters(root, candidate, targetRoot, cacheRoot, sharedRoot);
    await scenarioSlowLoser(root, candidate, targetRoot, cacheRoot, sharedRoot);
    const seeded = await scenarioFailedStaging(root, candidate, targetRoot, cacheRoot, sharedRoot);
    await scenarioConcurrentRestores(root, candidate, targetRoot, cacheRoot, sharedRoot, seeded.config, seeded.selected.candidate);
    await scenarioCorruptRefresh(root, candidate, targetRoot, cacheRoot, sharedRoot, seeded.config);

    process.stdout.write('PASS PoC 032 concurrent shared artifact publication/restoration\n');
    process.stdout.write('OBSERVED publication=immutable-candidate+atomic-selector\n');
    process.stdout.write('OBSERVED equivalent-writers=idempotent-no-global-lock\n');
    process.stdout.write('OBSERVED corrupt-refresh=no-delete-of-committed-candidate\n');
    process.stdout.write('OBSERVED freshness-metadata=project-scoped\n');
  } finally {
    fs.rmSync(sharedRoot, {recursive: true, force: true});
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => {
  process.stderr.write(`FAIL PoC 032: ${error.message}\n`);
  process.exitCode = 1;
});
