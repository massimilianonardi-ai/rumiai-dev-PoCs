'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const TEMPORARY_CONFIG_STATUS = 10;

class TemporaryConfigError extends Error {}

function fail(message, status = 1) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function parseArgs(argv) {
  const request = {project: null, profile: null, goals: []};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      if (++i >= argv.length) fail('--project requires a value', 2);
      request.project = argv[i];
    } else if (arg === '--profile') {
      if (++i >= argv.length) fail('--profile requires a value', 2);
      request.profile = argv[i];
    } else if (arg.startsWith('-')) {
      fail(`unsupported option: ${arg}`, 2);
    } else {
      request.goals.push(arg);
    }
  }
  if (request.project === null) fail('--project is required', 2);
  if (request.goals.length === 0) fail('at least one goal is required', 2);
  return request;
}

function loadInstrumentedMk(targetRoot) {
  const filename = path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js');
  const source = fs.readFileSync(filename, 'utf8');
  const marker = 'module.exports = {mkMain};';
  if (!source.includes(marker)) fail('unexpected mk.lib.js export boundary');
  const instrumented = source.replace(
    marker,
    `${marker}
module.exports.__poc = {
  _loadProjectConfig,
  _selectModel,
  _validateReferences,
  _resolveV2,
  _publicPlan,
  _activeDependencies,
  _newV2Runtime,
  _sha256
};`
  );
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(instrumented, filename);
  return mod.exports.__poc;
}

function sortedObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))
  );
}

function loadModel(mk, projectRoot, profile) {
  try {
    const config = mk._loadProjectConfig(path.join(projectRoot, 'mk.json'));
    const model = mk._selectModel(config, profile);
    mk._validateReferences(model);
    return model;
  } catch (error) {
    throw new TemporaryConfigError(error && error.message ? error.message : 'invalid project configuration');
  }
}

function main() {
  const request = parseArgs(process.argv.slice(2));
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  if (typeof target !== 'string' || target.length === 0) fail('RUMIAI_POC_RUMIAI_OS is required', 2);

  const fatalFile = process.env.RUMIAI_POC_TRIGGER_FATAL_FILE;
  if (fatalFile && fs.existsSync(fatalFile)) fail('forced fatal trigger resolver failure');

  const targetRoot = fs.realpathSync(target);
  const root = fs.realpathSync(path.resolve(request.project));
  process.env.m_ROOT = targetRoot;
  const mk = loadInstrumentedMk(targetRoot);

  function resolve(projectRoot, goals, profile, chain) {
    if (chain.includes(projectRoot)) fail(`project dependency cycle: ${chain.concat([projectRoot]).join(' -> ')}`);

    const model = loadModel(mk, projectRoot, profile);
    if (model.version !== 2) throw new TemporaryConfigError('watch trigger PoC requires version-2 project');

    const runtime = mk._newV2Runtime();
    const local = mk._resolveV2(projectRoot, model, goals, runtime);
    const localDigest = mk._sha256({
      schema: 1,
      project: projectRoot,
      profile,
      goals: goals.slice(),
      model,
      plan: mk._publicPlan(local, []),
      operationInputSnapshots: sortedObject(runtime.operationInputSnapshots),
      incrementalFingerprints: sortedObject(runtime.incrementalFingerprints)
    });

    const dependencies = [];
    for (const dependency of mk._activeDependencies(projectRoot, model, goals)) {
      let child;
      try {
        child = resolve(dependency.project, dependency.goals, dependency.profile, chain.concat([projectRoot]));
      } catch (error) {
        if (error instanceof TemporaryConfigError) throw error;
        throw error;
      }
      dependencies.push({
        name: dependency.name,
        project: dependency.project,
        goals: dependency.goals.slice(),
        profile: dependency.profile,
        digest: child
      });
    }

    return mk._sha256({schema: 1, local: localDigest, dependencies});
  }

  process.stdout.write(`${resolve(root, request.goals, request.profile, [])}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof TemporaryConfigError) {
    process.stderr.write(`trigger-snapshot: configuration unavailable: ${error.message}\n`);
    process.exitCode = TEMPORARY_CONFIG_STATUS;
  } else {
    process.stderr.write(`trigger-snapshot: ${error && error.message ? error.message : 'unexpected failure'}\n`);
    process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
  }
}
