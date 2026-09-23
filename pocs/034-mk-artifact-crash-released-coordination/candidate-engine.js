'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

function fail(message, status = 1) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function replaceFunction(source, name, replacement) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) fail(`missing function boundary: ${name}`);
  const next = source.indexOf('\nfunction ', start + 10);
  if (next < 0) fail(`cannot locate end of function: ${name}`);
  return source.slice(0, start) + replacement.trim() + '\n\n' + source.slice(next + 1);
}

function loadCandidate(targetRoot) {
  const filename = path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js');
  let source = fs.readFileSync(filename, 'utf8');

  const controlNames = [
    'RUMIAI_POC_ARTIFACT_STAGE_MARKER',
    'RUMIAI_POC_ARTIFACT_STAGE_WAIT',
    'RUMIAI_POC_ARTIFACT_PIN_MARKER',
    'RUMIAI_POC_ARTIFACT_PIN_WAIT',
    'RUMIAI_POC_ARTIFACT_CURRENT_MARKER',
    'RUMIAI_POC_ARTIFACT_CURRENT_WAIT',
    'RUMIAI_POC_ARTIFACT_RESTORE_MARKER',
    'RUMIAI_POC_ARTIFACT_RESTORE_WAIT'
  ];
  const controls = {};
  for (const name of controlNames) {
    controls[name] = process.env[name] || null;
    delete process.env[name];
  }

  source = source.replace(
    "'use strict';",
    `'use strict';\nconst __pocArtifactLeaseControl = ${JSON.stringify(controls)};`
  );

  source = replaceFunction(source, '_artifactStorePath', `
function _artifactStorePath(projectRoot, operationName, fingerprint) {
  const cacheRoot = _mkCacheRoot();
  if (cacheRoot === null) return null;
  return path.join(cacheRoot, 'shared-artifacts', fingerprint);
}

function _pocArtifactPause(marker, waitFile) {
  if (marker !== null) {
    fs.mkdirSync(path.dirname(marker), {recursive: true, mode: 0o700});
    fs.writeFileSync(marker, 'ready\\n', {mode: 0o600});
  }
  if (waitFile === null) return;
  const start = Date.now();
  while (!fs.existsSync(waitFile)) {
    if (Date.now() - start > 15000) throw new Error('PoC artifact synchronization timeout');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

function _pocArtifactLeaseDirectory(root, kind) {
  return path.join(root, '.' + kind + '-leases');
}

function _pocArtifactLeaseAcquire(directory, token) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const temporary = path.join(directory, '.prep-' + token);
  const published = path.join(directory, token);
  let fd = null;
  try {
    const result = childProcess.spawnSync('mkfifo', [temporary], {encoding: 'utf8'});
    if (result.error || result.status !== 0) {
      throw new Error('cannot create POSIX FIFO activity token');
    }
    fs.chmodSync(temporary, 0o600);
    fd = fs.openSync(temporary, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    fs.renameSync(temporary, published);
    return {path: published, token, fd};
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (closeError) {}
    }
    try { fs.unlinkSync(temporary); } catch (unlinkError) {}
    try { fs.unlinkSync(published); } catch (unlinkError) {}
    throw error;
  }
}

function _pocArtifactLeaseRelease(lease) {
  if (lease === null) return;
  try { fs.unlinkSync(lease.path); } catch (error) {}
  try { fs.closeSync(lease.fd); } catch (error) {}
}

function _pocArtifactLeaseState(leasePath) {
  try {
    const stat = fs.lstatSync(leasePath);
    if (!stat.isFIFO()) return 'unknown';
    const fd = fs.openSync(leasePath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    fs.closeSync(fd);
    return 'live';
  } catch (error) {
    if (error && error.code === 'ENOENT') return 'missing';
    if (error && error.code === 'ENXIO') return 'stale';
    return 'unknown';
  }
}

function _pocArtifactLiveLeases(directory) {
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    return [];
  }
  const live = [];
  for (const name of names) {
    const leasePath = path.join(directory, name);
    if (name.startsWith('.prep-')) {
      try { fs.unlinkSync(leasePath); } catch (error) {}
      continue;
    }
    const state = _pocArtifactLeaseState(leasePath);
    if (state === 'stale') {
      try { fs.unlinkSync(leasePath); } catch (error) {}
      continue;
    }
    if (state === 'live' || state === 'unknown') live.push(leasePath);
  }
  return live;
}

function _pocArtifactPublicationSelect(root, candidate, operationName, fingerprint) {
  const token = _artifactAttemptToken();
  const lease = _pocArtifactLeaseAcquire(_pocArtifactLeaseDirectory(root, 'publication'), token);
  try {
    if (_pocArtifactLiveLeases(_pocArtifactLeaseDirectory(root, 'maintenance')).length > 0) {
      return false;
    }

    const candidatePath = _artifactCandidatePath(root, candidate);
    const manifest = _artifactManifestRead(candidatePath);
    if (manifest === null || manifest.operation !== operationName ||
        manifest.fingerprint !== fingerprint ||
        !_artifactStoreVerified(candidatePath, operationName, fingerprint, manifest.outputs)) {
      return false;
    }

    _pocArtifactPause(
      __pocArtifactLeaseControl.RUMIAI_POC_ARTIFACT_PIN_MARKER,
      __pocArtifactLeaseControl.RUMIAI_POC_ARTIFACT_PIN_WAIT
    );

    if (_pocArtifactLiveLeases(_pocArtifactLeaseDirectory(root, 'maintenance')).length > 0) {
      return false;
    }
    return _artifactSelect(root, candidate, token);
  } finally {
    _pocArtifactLeaseRelease(lease);
  }
}
`);

  source = replaceFunction(source, '_artifactSelect', `
function _artifactSelect(root, candidate, token = _artifactAttemptToken()) {
  const current = _artifactCurrentPath(root);
  const temporary = path.join(root, '.current-' + token);
  try {
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    fs.writeFileSync(temporary, candidate + '\\n', {mode: 0o600});
    _pocArtifactPause(
      __pocArtifactLeaseControl.RUMIAI_POC_ARTIFACT_CURRENT_MARKER,
      __pocArtifactLeaseControl.RUMIAI_POC_ARTIFACT_CURRENT_WAIT
    );
    fs.renameSync(temporary, current);
    return true;
  } catch (error) {
    return false;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {}
  }
}
`);

  source = replaceFunction(source, '_storeArtifacts', `
function _storeArtifacts(projectRoot, operationName, fingerprint, operation, outputs) {
  const root = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (root === null) return false;

  const token = _artifactAttemptToken();
  const candidates = path.join(root, 'candidates');
  let staging = path.join(root, '.staging-' + token);
  let attemptLease = null;

  try {
    fs.mkdirSync(candidates, {recursive: true, mode: 0o700});
    attemptLease = _pocArtifactLeaseAcquire(_pocArtifactLeaseDirectory(root, 'attempt'), token);
    fs.rmSync(staging, {recursive: true, force: true});
    fs.mkdirSync(path.join(staging, 'payload'), {recursive: true, mode: 0o700});

    for (const name of Object.keys(operation.outputs).sort(_byteCompare)) {
      const declared = operation.outputs[name].path;
      const sourcePath = path.isAbsolute(declared) ? declared : path.resolve(projectRoot, declared);
      _copyArtifactPath(sourcePath, _artifactPayloadPath(staging, name));
      const expected = outputs[name];
      const copied = _snapshotAbsolutePath(_artifactPayloadPath(staging, name), expected.identity);
      if (!copied.cacheable || copied.snapshot === null ||
          _stableJson(copied.snapshot) !== _stableJson(expected)) {
        throw new Error('artifact verification failed');
      }
    }

    fs.writeFileSync(
      path.join(staging, 'manifest.json'),
      JSON.stringify({schema: 1, operation: operationName, fingerprint, outputs}, null, 2),
      {mode: 0o600}
    );

    if (!_artifactStoreVerified(staging, operationName, fingerprint, outputs)) {
      throw new Error('artifact staging verification failed');
    }

    _pocArtifactPause(
      __pocArtifactLeaseControl.RUMIAI_POC_ARTIFACT_STAGE_MARKER,
      __pocArtifactLeaseControl.RUMIAI_POC_ARTIFACT_STAGE_WAIT
    );

    const baseCandidate = _sha256({
      schema: 1,
      operation: operationName,
      fingerprint,
      outputs
    });
    const basePath = _artifactCandidatePath(root, baseCandidate);
    let chosen = null;

    try {
      fs.renameSync(staging, basePath);
      staging = null;
      chosen = baseCandidate;
    } catch (error) {
      if (_artifactStoreVerified(basePath, operationName, fingerprint, outputs)) {
        chosen = baseCandidate;
      } else {
        const selected = _artifactSelected(root, operationName, fingerprint);
        if (selected !== null) {
          chosen = selected.candidate;
        } else {
          const recovery = baseCandidate + '-' + token;
          const recoveryPath = _artifactCandidatePath(root, recovery);
          fs.renameSync(staging, recoveryPath);
          staging = null;
          chosen = recovery;
        }
      }
    }

    if (staging !== null) {
      fs.rmSync(staging, {recursive: true, force: true});
      staging = null;
    }
    _pocArtifactLeaseRelease(attemptLease);
    attemptLease = null;

    return _pocArtifactPublicationSelect(root, chosen, operationName, fingerprint);
  } catch (error) {
    if (staging !== null) {
      try { fs.rmSync(staging, {recursive: true, force: true}); } catch (cleanupError) {}
    }
    _pocArtifactLeaseRelease(attemptLease);
    return false;
  }
}
`);

  source = replaceFunction(source, '_restoreArtifacts', `
function _restoreArtifacts(projectRoot, operationName, fingerprint, operation) {
  const root = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (root === null) return false;

  const selected = _artifactSelected(root, operationName, fingerprint);
  if (selected === null) return false;

  const manifest = selected.manifest;
  const outputNames = Object.keys(operation.outputs).sort(_byteCompare);
  if (_stableJson(outputNames) !== _stableJson(Object.keys(manifest.outputs).sort(_byteCompare))) {
    return false;
  }

  _pocArtifactPause(
    __pocArtifactLeaseControl.RUMIAI_POC_ARTIFACT_RESTORE_MARKER,
    __pocArtifactLeaseControl.RUMIAI_POC_ARTIFACT_RESTORE_WAIT
  );

  const staged = [];
  const token = _artifactAttemptToken();
  try {
    let index = 0;
    for (const name of outputNames) {
      const declared = operation.outputs[name].path;
      const destination = path.isAbsolute(declared) ? declared : path.resolve(projectRoot, declared);
      const temporary = destination + '.mk-restore-' + token + '-' + index;
      index += 1;
      fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
      fs.rmSync(temporary, {recursive: true, force: true});
      _copyArtifactPath(_artifactPayloadPath(selected.path, name), temporary);
      const expected = manifest.outputs[name];
      const restored = _snapshotAbsolutePath(temporary, expected.identity);
      if (!restored.cacheable || restored.snapshot === null ||
          _stableJson(restored.snapshot) !== _stableJson(expected)) {
        throw new Error('staged restoration verification failed');
      }
      staged.push({destination, temporary});
    }

    for (const entry of staged) {
      fs.rmSync(entry.destination, {recursive: true, force: true});
      fs.renameSync(entry.temporary, entry.destination);
    }

    const final = _outputSnapshots(projectRoot, operation);
    if (!final.cacheable || !final.complete ||
        _stableJson(final.outputs) !== _stableJson(manifest.outputs)) {
      return false;
    }

    _writeFreshnessRecord(projectRoot, operationName, fingerprint, manifest.outputs);
    const record = _readFreshnessRecord(projectRoot, operationName);
    return record !== null && record.fingerprint === fingerprint &&
      _stableJson(record.outputs) === _stableJson(manifest.outputs);
  } catch (error) {
    for (const entry of staged) {
      try { fs.rmSync(entry.temporary, {recursive: true, force: true}); } catch (cleanupError) {}
    }
    return false;
  }
}
`);

  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(source, filename);
  return mod.exports;
}

async function main() {
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  if (typeof target !== 'string' || target.length === 0) fail('RUMIAI_POC_RUMIAI_OS is required', 2);
  const targetRoot = fs.realpathSync(target);
  process.env.m_ROOT = targetRoot;
  const mk = loadCandidate(targetRoot);
  return await Promise.resolve(mk.mkMain(process.argv.slice(2)));
}

main().then(
  status => { process.exitCode = status; },
  error => {
    process.stderr.write(`candidate-mk: ${error && error.message ? error.message : 'unexpected failure'}\n`);
    process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
  }
);
