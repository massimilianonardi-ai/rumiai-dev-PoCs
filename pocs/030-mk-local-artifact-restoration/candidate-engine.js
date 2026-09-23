'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

function fail(message, status = 1) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function loadCandidate(targetRoot) {
  const filename = path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js');
  let source = fs.readFileSync(filename, 'utf8');

  const marker = 'function _outputSnapshots(projectRoot, operation) {';
  if (!source.includes(marker)) fail('unexpected output snapshot boundary');

  const helpers = `
function _artifactStorePath(projectRoot, operationName, fingerprint) {
  const cacheRoot = _mkCacheRoot();
  if (cacheRoot === null) return null;
  return path.join(
    cacheRoot,
    'projects',
    _sha256(projectRoot),
    'artifacts',
    _sha256(operationName),
    fingerprint
  );
}

function _artifactPayloadPath(storePath, outputName) {
  return path.join(storePath, 'payload', _sha256(outputName));
}

function _copyArtifactPath(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
    throw new Error('unsupported artifact filesystem object');
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, _modeBits(stat));
    return;
  }
  fs.mkdirSync(destination, {recursive: true, mode: _modeBits(stat)});
  fs.chmodSync(destination, _modeBits(stat));
  for (const name of fs.readdirSync(source).sort(_byteCompare)) {
    _copyArtifactPath(path.join(source, name), path.join(destination, name));
  }
}

function _artifactManifestRead(storePath) {
  try {
    const manifestPath = path.join(storePath, 'manifest.json');
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!_isObject(value) || value.schema !== 1 || typeof value.operation !== 'string' ||
        typeof value.fingerprint !== 'string' || !_isObject(value.outputs)) return null;
    return value;
  } catch (error) {
    return null;
  }
}

function _artifactStoreVerified(storePath, operationName, fingerprint, outputs) {
  const manifest = _artifactManifestRead(storePath);
  if (manifest === null || manifest.operation !== operationName ||
      manifest.fingerprint !== fingerprint ||
      _stableJson(manifest.outputs) !== _stableJson(outputs)) return false;
  try {
    for (const name of Object.keys(outputs).sort(_byteCompare)) {
      const expected = outputs[name];
      if (expected === null || expected.exists !== true) return false;
      const actual = _snapshotAbsolutePath(_artifactPayloadPath(storePath, name), expected.identity);
      if (!actual.cacheable || actual.snapshot === null ||
          _stableJson(actual.snapshot) !== _stableJson(expected)) return false;
    }
  } catch (error) {
    return false;
  }
  return true;
}

function _storeArtifacts(projectRoot, operationName, fingerprint, operation, outputs) {
  const storePath = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (storePath === null) return false;
  const parent = path.dirname(storePath);
  const temporary = \`${storePath}.tmp-${process.pid}\`;
  try {
    fs.mkdirSync(parent, {recursive: true, mode: 0o700});
    fs.rmSync(temporary, {recursive: true, force: true});
    fs.mkdirSync(path.join(temporary, 'payload'), {recursive: true, mode: 0o700});
    for (const name of Object.keys(operation.outputs).sort(_byteCompare)) {
      const declared = operation.outputs[name].path;
      const source = path.isAbsolute(declared) ? declared : path.resolve(projectRoot, declared);
      _copyArtifactPath(source, _artifactPayloadPath(temporary, name));
      const expected = outputs[name];
      const copied = _snapshotAbsolutePath(_artifactPayloadPath(temporary, name), expected.identity);
      if (!copied.cacheable || copied.snapshot === null ||
          _stableJson(copied.snapshot) !== _stableJson(expected)) throw new Error('artifact verification failed');
    }
    fs.writeFileSync(
      path.join(temporary, 'manifest.json'),
      \`${JSON.stringify({schema: 1, operation: operationName, fingerprint, outputs}, null, 2)}\\n\`,
      {mode: 0o600}
    );
    if (!_artifactStoreVerified(temporary, operationName, fingerprint, outputs)) {
      throw new Error('artifact store verification failed');
    }
    fs.rmSync(storePath, {recursive: true, force: true});
    fs.renameSync(temporary, storePath);
    return true;
  } catch (error) {
    try { fs.rmSync(temporary, {recursive: true, force: true}); } catch (cleanupError) {}
    return false;
  }
}

function _restoreArtifacts(projectRoot, operationName, fingerprint, operation) {
  const record = _readFreshnessRecord(projectRoot, operationName);
  if (record === null || record.fingerprint !== fingerprint) return false;
  const storePath = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (storePath === null || !_artifactStoreVerified(storePath, operationName, fingerprint, record.outputs)) {
    return false;
  }

  const staged = [];
  try {
    let index = 0;
    for (const name of Object.keys(operation.outputs).sort(_byteCompare)) {
      const declared = operation.outputs[name].path;
      const destination = path.isAbsolute(declared) ? declared : path.resolve(projectRoot, declared);
      const temporary = \`${destination}.mk-restore-${process.pid}-${index}\`;
      index += 1;
      fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
      fs.rmSync(temporary, {recursive: true, force: true});
      _copyArtifactPath(_artifactPayloadPath(storePath, name), temporary);
      const expected = record.outputs[name];
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
    return final.cacheable && final.complete &&
      _stableJson(final.outputs) === _stableJson(record.outputs);
  } catch (error) {
    for (const entry of staged) {
      try { fs.rmSync(entry.temporary, {recursive: true, force: true}); } catch (cleanupError) {}
    }
    return false;
  }
}

`;

  source = source.replace(marker, helpers + marker);

  const executeOld = `    if (operation.incremental !== null) {
      _deleteFreshnessRecord(projectRoot, ready.name);
    }
    const result = _executeAction(projectRoot, baseEnvironment, ready.name, operation.action);`;
  const executeNew = `    if (operation.incremental !== null) {
      if (typeof fingerprint === 'string' && !runtime.resultRequired.has(ready.name) &&
          _restoreArtifacts(projectRoot, ready.name, fingerprint, operation)) {
        continue;
      }
      _deleteFreshnessRecord(projectRoot, ready.name);
    }
    const result = _executeAction(projectRoot, baseEnvironment, ready.name, operation.action);`;
  if (!source.includes(executeOld)) fail('unexpected incremental execution boundary');
  source = source.replace(executeOld, executeNew);

  const recordOld = `      if (outputs.cacheable && outputs.complete) {
        _writeFreshnessRecord(projectRoot, ready.name, fingerprint, outputs.outputs);
      }`;
  const recordNew = `      if (outputs.cacheable && outputs.complete) {
        _storeArtifacts(projectRoot, ready.name, fingerprint, operation, outputs.outputs);
        _writeFreshnessRecord(projectRoot, ready.name, fingerprint, outputs.outputs);
      }`;
  if (!source.includes(recordOld)) fail('unexpected freshness write boundary');
  source = source.replace(recordOld, recordNew);

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
