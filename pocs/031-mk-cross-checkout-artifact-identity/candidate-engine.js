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

  source = replaceFunction(source, '_artifactStorePath', `
function _artifactStorePath(projectRoot, operationName, fingerprint) {
  const cacheRoot = _mkCacheRoot();
  if (cacheRoot === null) return null;
  return path.join(cacheRoot, 'shared-artifacts', fingerprint);
}
`);

  source = replaceFunction(source, '_restoreArtifacts', `
function _restoreArtifacts(projectRoot, operationName, fingerprint, operation) {
  const storePath = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (storePath === null) return false;
  const manifest = _artifactManifestRead(storePath);
  if (manifest === null || manifest.operation !== operationName ||
      manifest.fingerprint !== fingerprint ||
      !_artifactStoreVerified(storePath, operationName, fingerprint, manifest.outputs)) {
    return false;
  }

  const outputNames = Object.keys(operation.outputs).sort(_byteCompare);
  if (_stableJson(outputNames) !== _stableJson(Object.keys(manifest.outputs).sort(_byteCompare))) {
    return false;
  }

  const staged = [];
  try {
    let index = 0;
    for (const name of outputNames) {
      const declared = operation.outputs[name].path;
      const destination = path.isAbsolute(declared) ? declared : path.resolve(projectRoot, declared);
      const temporary = destination + '.mk-restore-' + process.pid + '-' + index;
      index += 1;
      fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
      fs.rmSync(temporary, {recursive: true, force: true});
      _copyArtifactPath(_artifactPayloadPath(storePath, name), temporary);
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
