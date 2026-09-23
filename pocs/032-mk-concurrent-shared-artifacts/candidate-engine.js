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
    'RUMIAI_POC_ARTIFACT_FAIL_AFTER_STAGE',
    'RUMIAI_POC_ARTIFACT_AFTER_PUBLISH_MARKER',
    'RUMIAI_POC_ARTIFACT_AFTER_PUBLISH_WAIT',
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
    `'use strict';\nconst __pocSharedArtifactControl = ${JSON.stringify(controls)};`
  );

  source = replaceFunction(source, '_artifactStorePath', `
function _artifactStorePath(projectRoot, operationName, fingerprint) {
  const cacheRoot = _mkCacheRoot();
  if (cacheRoot === null) return null;
  return path.join(cacheRoot, 'shared-artifacts', fingerprint);
}

function _pocArtifactToken() {
  return process.pid + '-' + crypto.randomBytes(12).toString('hex');
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

function _sharedArtifactCurrentPath(root) {
  return path.join(root, 'current');
}

function _sharedArtifactCandidateNameValid(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}(?:-[a-z0-9-]+)?$/.test(value);
}

function _sharedArtifactCandidatePath(root, candidate) {
  return path.join(root, 'candidates', candidate);
}

function _sharedArtifactReadCurrent(root) {
  try {
    const current = _sharedArtifactCurrentPath(root);
    const stat = fs.lstatSync(current);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const candidate = fs.readFileSync(current, 'utf8').trim();
    if (!_sharedArtifactCandidateNameValid(candidate)) return null;
    return candidate;
  } catch (error) {
    return null;
  }
}

function _sharedArtifactSelected(root, operationName, fingerprint) {
  const candidate = _sharedArtifactReadCurrent(root);
  if (candidate === null) return null;
  const candidatePath = _sharedArtifactCandidatePath(root, candidate);
  const manifest = _artifactManifestRead(candidatePath);
  if (manifest === null || manifest.operation !== operationName ||
      manifest.fingerprint !== fingerprint ||
      !_artifactStoreVerified(candidatePath, operationName, fingerprint, manifest.outputs)) {
    return null;
  }
  return {candidate, path: candidatePath, manifest};
}

function _sharedArtifactSelect(root, candidate) {
  const current = _sharedArtifactCurrentPath(root);
  const temporary = path.join(root, '.current-' + _pocArtifactToken());
  try {
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    fs.writeFileSync(temporary, candidate + '\\n', {mode: 0o600});
    fs.renameSync(temporary, current);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {}
  }
}
`);

  source = replaceFunction(source, '_storeArtifacts', `
function _storeArtifacts(projectRoot, operationName, fingerprint, operation, outputs) {
  const root = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (root === null) return false;

  const token = _pocArtifactToken();
  const candidates = path.join(root, 'candidates');
  let staging = path.join(root, '.staging-' + token);

  try {
    fs.mkdirSync(candidates, {recursive: true, mode: 0o700});
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
      __pocSharedArtifactControl.RUMIAI_POC_ARTIFACT_STAGE_MARKER,
      __pocSharedArtifactControl.RUMIAI_POC_ARTIFACT_STAGE_WAIT
    );

    if (__pocSharedArtifactControl.RUMIAI_POC_ARTIFACT_FAIL_AFTER_STAGE === '1') {
      throw new Error('forced publisher failure after staging');
    }

    const baseCandidate = _sha256({
      schema: 1,
      operation: operationName,
      fingerprint,
      outputs
    });
    const basePath = _sharedArtifactCandidatePath(root, baseCandidate);
    let chosen = null;

    try {
      fs.renameSync(staging, basePath);
      staging = null;
      chosen = baseCandidate;
    } catch (error) {
      if (_artifactStoreVerified(basePath, operationName, fingerprint, outputs)) {
        chosen = baseCandidate;
      } else {
        const selected = _sharedArtifactSelected(root, operationName, fingerprint);
        if (selected !== null) {
          chosen = selected.candidate;
        } else {
          const recovery = baseCandidate + '-' + token;
          const recoveryPath = _sharedArtifactCandidatePath(root, recovery);
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

    const chosenPath = _sharedArtifactCandidatePath(root, chosen);
    const chosenManifest = _artifactManifestRead(chosenPath);
    if (chosenManifest === null ||
        !_artifactStoreVerified(chosenPath, operationName, fingerprint, chosenManifest.outputs)) {
      throw new Error('chosen artifact candidate is not valid');
    }

    _sharedArtifactSelect(root, chosen);

    _pocArtifactPause(
      __pocSharedArtifactControl.RUMIAI_POC_ARTIFACT_AFTER_PUBLISH_MARKER,
      __pocSharedArtifactControl.RUMIAI_POC_ARTIFACT_AFTER_PUBLISH_WAIT
    );

    return true;
  } catch (error) {
    if (staging !== null) {
      try { fs.rmSync(staging, {recursive: true, force: true}); } catch (cleanupError) {}
    }
    return false;
  }
}
`);

  source = replaceFunction(source, '_restoreArtifacts', `
function _restoreArtifacts(projectRoot, operationName, fingerprint, operation) {
  const root = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (root === null) return false;

  const selected = _sharedArtifactSelected(root, operationName, fingerprint);
  if (selected === null) return false;

  const manifest = selected.manifest;
  const outputNames = Object.keys(operation.outputs).sort(_byteCompare);
  if (_stableJson(outputNames) !== _stableJson(Object.keys(manifest.outputs).sort(_byteCompare))) {
    return false;
  }

  _pocArtifactPause(
    __pocSharedArtifactControl.RUMIAI_POC_ARTIFACT_RESTORE_MARKER,
    __pocSharedArtifactControl.RUMIAI_POC_ARTIFACT_RESTORE_WAIT
  );

  const staged = [];
  const token = _pocArtifactToken();
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
    return true;
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
