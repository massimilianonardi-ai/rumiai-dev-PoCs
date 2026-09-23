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

function childResult(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', chunk => { stdout += chunk; });
    if (child.stderr) child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve({status, signal, stdout, stderr}));
  });
}

function spawnCandidate(candidate, targetRoot, project, controls = {}) {
  return childProcess.spawn(process.execPath, [candidate, '--project', project, 'build'], {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot, ...controls},
    stdio: ['ignore', 'pipe', 'pipe']
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

function writeProject(root, name, config, source) {
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

function resetShared(sharedRoot) {
  fs.rmSync(sharedRoot, {recursive: true, force: true});
}

function fingerprintRoots(sharedRoot) {
  if (!fs.existsSync(sharedRoot)) return [];
  return fs.readdirSync(sharedRoot)
    .filter(name => /^[a-f0-9]{64}$/.test(name))
    .map(name => path.join(sharedRoot, name));
}

function onlyFingerprintRoot(sharedRoot) {
  const roots = fingerprintRoots(sharedRoot);
  assert(roots.length === 1, `expected one fingerprint root, found ${roots.length}`);
  return roots[0];
}

function candidateNames(root) {
  const dir = path.join(root, 'candidates');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /^[a-f0-9]{64}(?:-[a-z0-9-]+)?$/.test(name)).sort();
}

function current(root) {
  const file = path.join(root, 'current');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim();
}

function setCurrent(root, candidate) {
  const tmp = path.join(root, '.test-current-' + process.pid + '-' + Date.now());
  fs.writeFileSync(tmp, candidate + '\n');
  fs.renameSync(tmp, path.join(root, 'current'));
}

function duplicateCandidate(root, source, suffix) {
  const copy = source + '-' + suffix;
  fs.cpSync(path.join(root, 'candidates', source), path.join(root, 'candidates', copy), {recursive: true});
  return copy;
}

function maintenance(maintenanceScript, mode, root, env = {}) {
  const result = run(process.execPath, [maintenanceScript, mode, root], {
    env: {...process.env, ...env}
  });
  assert(result.status === 0, `maintenance ${mode} failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function findRootWithPrefix(sharedRoot, prefix) {
  for (const root of fingerprintRoots(sharedRoot)) {
    if (fs.readdirSync(root).some(name => name.startsWith(prefix))) return root;
  }
  return null;
}

async function scenarioSweepWriterAndReader(root, candidate, maintenanceScript, targetRoot, cacheRoot, sharedRoot) {
  resetShared(sharedRoot);
  const config = basicConfig("mkdir -p out; cp src/input.txt out/artifact; printf 'run\\n' >> trace");
  const seed = writeProject(root, 'seed', config, 'SAME\n');
  fs.rmSync(projectCache(cacheRoot, seed), {recursive: true, force: true});
  let result = run(process.execPath, [candidate, '--project', seed, 'build'], {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(result.status === 0, `seed publication failed: ${result.stderr}`);

  const fingerprintRoot = onlyFingerprintRoot(sharedRoot);
  const base = current(fingerprintRoot);
  assert(base !== null, 'seed publication did not select a candidate');
  const duplicate = duplicateCandidate(fingerprintRoot, base, 'dup');
  setCurrent(fingerprintRoot, duplicate);

  const swept = maintenance(maintenanceScript, 'sweep', fingerprintRoot);
  assert(swept.state === 'ok', `unexpected sweep state: ${swept.state}`);
  assert(!fs.existsSync(path.join(fingerprintRoot, 'candidates', base)), 'unselected candidate was not reclaimed');
  assert(fs.existsSync(path.join(fingerprintRoot, 'candidates', duplicate)), 'selected candidate was reclaimed');
  assert(current(fingerprintRoot) === duplicate, 'sweep changed selected candidate');

  fs.cpSync(path.join(fingerprintRoot, 'candidates', duplicate), path.join(fingerprintRoot, 'candidates', base), {recursive: true});
  fs.unlinkSync(path.join(fingerprintRoot, 'current'));

  const publisher = writeProject(root, 'publisher-pin', config, 'SAME\n');
  fs.rmSync(projectCache(cacheRoot, publisher), {recursive: true, force: true});
  const pinMarker = path.join(root, 'pin-ready');
  const pinRelease = path.join(root, 'pin-release');
  const publishing = spawnCandidate(candidate, targetRoot, publisher, {
    RUMIAI_POC_ARTIFACT_PIN_MARKER: pinMarker,
    RUMIAI_POC_ARTIFACT_PIN_WAIT: pinRelease
  });
  const publishingResult = childResult(publishing);
  await waitFor(() => fs.existsSync(pinMarker), 'publisher did not hold publication pin');

  const blocked = maintenance(maintenanceScript, 'sweep', fingerprintRoot);
  assert(blocked.state === 'blocked-publication', 'maintenance ignored active publication pin');
  assert(fs.existsSync(path.join(fingerprintRoot, 'candidates', base)), 'maintenance reclaimed pinned candidate');

  fs.writeFileSync(pinRelease, 'release\n');
  const completed = await publishingResult;
  assert(completed.status === 0, `publisher failed after pin release: ${completed.stderr}`);
  assert(current(fingerprintRoot) === base, 'publisher did not select deterministic base candidate');

  const reader = writeProject(root, 'reader-race', config, 'SAME\n');
  fs.rmSync(projectCache(cacheRoot, reader), {recursive: true, force: true});
  fs.rmSync(path.join(reader, 'out'), {recursive: true, force: true});
  const restoreMarker = path.join(root, 'restore-ready');
  const restoreRelease = path.join(root, 'restore-release');
  const reading = spawnCandidate(candidate, targetRoot, reader, {
    RUMIAI_POC_ARTIFACT_RESTORE_MARKER: restoreMarker,
    RUMIAI_POC_ARTIFACT_RESTORE_WAIT: restoreRelease
  });
  const readingResult = childResult(reading);
  await waitFor(() => fs.existsSync(restoreMarker), 'reader did not capture selected candidate');

  setCurrent(fingerprintRoot, duplicate);
  const readerSweep = maintenance(maintenanceScript, 'sweep', fingerprintRoot);
  assert(readerSweep.state === 'ok', 'reader-race sweep did not complete');
  assert(!fs.existsSync(path.join(fingerprintRoot, 'candidates', base)), 'reader-held unselected candidate was not quarantined/reclaimed');
  assert(fs.existsSync(path.join(fingerprintRoot, 'candidates', duplicate)), 'reader-race sweep removed current candidate');

  fs.writeFileSync(restoreRelease, 'release\n');
  const readerCompleted = await readingResult;
  assert(readerCompleted.status === 0, `reader fallback lifecycle failed: ${readerCompleted.stderr}`);
  assert(fs.readFileSync(path.join(reader, 'out', 'artifact'), 'utf8') === 'SAME\n', 'reader fallback produced wrong output');
  assert(traceLines(reader).length === 1, 'reader did not conservatively execute after reclaimed source candidate');
  assert(!fs.readdirSync(path.join(reader, 'out')).some(name => name.includes('.mk-restore-')), 'reader left partial restore temporaries');
}

async function scenarioAttemptResidue(root, candidate, maintenanceScript, targetRoot, cacheRoot, sharedRoot) {
  resetShared(sharedRoot);
  const config = basicConfig("mkdir -p out; cp src/input.txt out/artifact; printf 'run\\n' >> trace");

  const live = writeProject(root, 'live-stage', config, 'LIVE-STAGE\n');
  fs.rmSync(projectCache(cacheRoot, live), {recursive: true, force: true});
  const liveMarker = path.join(root, 'live-stage-ready');
  const liveRelease = path.join(root, 'live-stage-release');
  const liveChild = spawnCandidate(candidate, targetRoot, live, {
    RUMIAI_POC_ARTIFACT_STAGE_MARKER: liveMarker,
    RUMIAI_POC_ARTIFACT_STAGE_WAIT: liveRelease
  });
  const liveResult = childResult(liveChild);
  await waitFor(() => fs.existsSync(liveMarker), 'live writer did not reach staging pause');
  const liveRoot = findRootWithPrefix(sharedRoot, '.staging-');
  assert(liveRoot !== null, 'live staging directory not found');
  const liveStaging = fs.readdirSync(liveRoot).find(name => name.startsWith('.staging-'));
  maintenance(maintenanceScript, 'sweep', liveRoot);
  assert(fs.existsSync(path.join(liveRoot, liveStaging)), 'maintenance removed live writer staging');
  fs.writeFileSync(liveRelease, 'release\n');
  const liveDone = await liveResult;
  assert(liveDone.status === 0, `live staging writer failed: ${liveDone.stderr}`);
  assert(!fs.existsSync(path.join(liveRoot, liveStaging)), 'normal writer did not clean its staging');

  const abandoned = writeProject(root, 'abandoned-stage', config, 'ABANDONED-STAGE\n');
  fs.rmSync(projectCache(cacheRoot, abandoned), {recursive: true, force: true});
  const abandonedMarker = path.join(root, 'abandoned-stage-ready');
  const abandonedWait = path.join(root, 'abandoned-stage-wait');
  const abandonedChild = spawnCandidate(candidate, targetRoot, abandoned, {
    RUMIAI_POC_ARTIFACT_STAGE_MARKER: abandonedMarker,
    RUMIAI_POC_ARTIFACT_STAGE_WAIT: abandonedWait
  });
  const abandonedResult = childResult(abandonedChild);
  await waitFor(() => fs.existsSync(abandonedMarker), 'abandoned writer did not reach staging pause');
  const abandonedRoot = findRootWithPrefix(sharedRoot, '.staging-');
  assert(abandonedRoot !== null, 'abandoned staging root not found');
  abandonedChild.kill('SIGKILL');
  await abandonedResult;
  const abandonedName = fs.readdirSync(abandonedRoot).find(name => name.startsWith('.staging-'));
  assert(abandonedName, 'killed writer did not leave staging residue');
  maintenance(maintenanceScript, 'sweep', abandonedRoot);
  assert(fs.existsSync(path.join(abandonedRoot, abandonedName)), 'maintenance guessed abandoned staging liveness and removed it');

  const currentTemp = writeProject(root, 'selector-temp', config, 'SELECTOR-TEMP\n');
  fs.rmSync(projectCache(cacheRoot, currentTemp), {recursive: true, force: true});
  const currentMarker = path.join(root, 'selector-current-ready');
  const currentWait = path.join(root, 'selector-current-wait');
  const currentChild = spawnCandidate(candidate, targetRoot, currentTemp, {
    RUMIAI_POC_ARTIFACT_CURRENT_MARKER: currentMarker,
    RUMIAI_POC_ARTIFACT_CURRENT_WAIT: currentWait
  });
  const currentResult = childResult(currentChild);
  await waitFor(() => fs.existsSync(currentMarker), 'publisher did not reach selector temporary pause');
  const currentRoot = findRootWithPrefix(sharedRoot, '.current-');
  assert(currentRoot !== null, 'selector temporary root not found');
  const tempName = fs.readdirSync(currentRoot).find(name => name.startsWith('.current-'));
  const blocked = maintenance(maintenanceScript, 'sweep', currentRoot);
  assert(blocked.state === 'blocked-publication', 'maintenance did not respect active selector publication pin');
  assert(fs.existsSync(path.join(currentRoot, tempName)), 'maintenance removed live selector temporary');

  currentChild.kill('SIGKILL');
  await currentResult;
  const pinsDir = path.join(currentRoot, '.publication-pins');
  assert(fs.existsSync(pinsDir) && fs.readdirSync(pinsDir).length > 0, 'killed publisher did not leave conservative stale pin');
  const staleBlocked = maintenance(maintenanceScript, 'sweep', currentRoot);
  assert(staleBlocked.state === 'blocked-publication', 'maintenance reclaimed through a stale crash pin');
  assert(fs.existsSync(path.join(currentRoot, tempName)), 'maintenance removed selector crash residue');
}

async function scenarioEvictionAndMaintenanceCrash(root, candidate, maintenanceScript, targetRoot, cacheRoot, sharedRoot) {
  resetShared(sharedRoot);
  const config = basicConfig("mkdir -p out; cp src/input.txt out/artifact; printf 'run\\n' >> trace");
  const project = writeProject(root, 'evict', config, 'EVICT\n');
  fs.rmSync(projectCache(cacheRoot, project), {recursive: true, force: true});
  let result = run(process.execPath, [candidate, '--project', project, 'build'], {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(result.status === 0, `eviction seed failed: ${result.stderr}`);
  assert(traceLines(project).length === 1, 'eviction seed did not execute');
  const fingerprintRoot = onlyFingerprintRoot(sharedRoot);

  const selectedBefore = current(fingerprintRoot);
  maintenance(maintenanceScript, 'sweep', fingerprintRoot);
  assert(current(fingerprintRoot) === selectedBefore, 'ordinary sweep reclaimed selected candidate');
  assert(fs.existsSync(path.join(fingerprintRoot, 'candidates', selectedBefore)), 'selected candidate disappeared during sweep');

  fs.rmSync(path.join(project, 'out'), {recursive: true, force: true});
  const freshness = projectCache(cacheRoot, project);
  assert(fs.existsSync(freshness), 'project freshness metadata missing before eviction');
  const evicted = maintenance(maintenanceScript, 'evict', fingerprintRoot);
  assert(evicted.state === 'ok', 'fingerprint eviction did not complete');
  assert(current(fingerprintRoot) === null, 'eviction left current selector');
  assert(candidateNames(fingerprintRoot).length === 0, 'eviction left artifact candidates');
  assert(fs.existsSync(freshness), 'eviction incorrectly removed project-scoped freshness metadata');

  result = run(process.execPath, [candidate, '--project', project, 'build'], {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(result.status === 0, `post-eviction fallback failed: ${result.stderr}`);
  assert(traceLines(project).length === 2, 'reclaimed artifact bytes did not degrade to conservative execution miss');
  assert(fs.readFileSync(path.join(project, 'out', 'artifact'), 'utf8') === 'EVICT\n', 'post-eviction execution produced wrong output');

  const maintenanceMarker = path.join(root, 'maintenance-active');
  const maintenanceWait = path.join(root, 'maintenance-wait');
  const maintenanceChild = childProcess.spawn(process.execPath, [maintenanceScript, 'sweep', fingerprintRoot], {
    env: {
      ...process.env,
      RUMIAI_POC_MAINTENANCE_MARKER: maintenanceMarker,
      RUMIAI_POC_MAINTENANCE_WAIT: maintenanceWait
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const maintenanceResult = childResult(maintenanceChild);
  await waitFor(() => fs.existsSync(maintenanceMarker), 'maintenance did not enter crash window');
  assert(fs.existsSync(path.join(fingerprintRoot, '.maintenance')), 'maintenance marker not visible during active pass');
  maintenanceChild.kill('SIGKILL');
  await maintenanceResult;
  assert(fs.existsSync(path.join(fingerprintRoot, '.maintenance')), 'maintenance crash did not leave conservative marker');
  const blocked = maintenance(maintenanceScript, 'sweep', fingerprintRoot);
  assert(blocked.state === 'blocked-maintenance', 'stale maintenance marker was not treated conservatively');
}

(async () => {
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  if (!target) throw new Error('RUMIAI_POC_RUMIAI_OS is required');

  const targetRoot = fs.realpathSync(target);
  const candidate = path.resolve(__dirname, '..', 'candidate-engine.js');
  const maintenanceScript = path.resolve(__dirname, '..', 'maintenance.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc033-'));
  const cacheRoot = statePath(targetRoot);
  const sharedRoot = path.join(cacheRoot, 'shared-artifacts');

  try {
    await scenarioSweepWriterAndReader(root, candidate, maintenanceScript, targetRoot, cacheRoot, sharedRoot);
    await scenarioAttemptResidue(root, candidate, maintenanceScript, targetRoot, cacheRoot, sharedRoot);
    await scenarioEvictionAndMaintenanceCrash(root, candidate, maintenanceScript, targetRoot, cacheRoot, sharedRoot);

    process.stdout.write('PASS PoC 033 shared artifact reclamation safety\n');
    process.stdout.write('OBSERVED reader-lease=not-required-with-quarantine+transactional-restore\n');
    process.stdout.write('OBSERVED writer-maintenance-gate=filesystem-pin+maintenance-marker-safe\n');
    process.stdout.write('OBSERVED crash-residue=conservative-retention-or-block\n');
    process.stdout.write('OBSERVED promotion-blocker=crash-liveness-needs-kernel-released-coordination\n');
  } finally {
    fs.rmSync(sharedRoot, {recursive: true, force: true});
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => {
  process.stderr.write(`FAIL PoC 033: ${error.message}\n`);
  process.exitCode = 1;
});
