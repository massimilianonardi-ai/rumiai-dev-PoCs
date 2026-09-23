'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

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

function main() {
  const request = parseArgs(process.argv.slice(2));
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  if (typeof target !== 'string' || target.length === 0) fail('RUMIAI_POC_RUMIAI_OS is required', 2);

  const targetRoot = fs.realpathSync(target);
  const root = fs.realpathSync(path.resolve(request.project));
  process.env.m_ROOT = targetRoot;

  const mk = loadInstrumentedMk(targetRoot);
  const visits = [];

  function resolve(projectRoot, goals, profile, chain) {
    if (chain.includes(projectRoot)) {
      fail(`project dependency cycle: ${chain.concat([projectRoot]).join(' -> ')}`);
    }
    visits.push({project: projectRoot, goals: goals.slice(), profile});

    const config = mk._loadProjectConfig(path.join(projectRoot, 'mk.json'));
    const model = mk._selectModel(config, profile);
    mk._validateReferences(model);
    if (model.version !== 2) fail('PoC 024 requires version-2 projects');

    const runtime = mk._newV2Runtime();
    const local = mk._resolveV2(projectRoot, model, goals, runtime);
    const localPlan = mk._publicPlan(local, []);
    const localDigest = mk._sha256({
      schema: 1,
      project: projectRoot,
      profile,
      goals: goals.slice(),
      model,
      plan: localPlan,
      operationInputSnapshots: sortedObject(runtime.operationInputSnapshots),
      incrementalFingerprints: sortedObject(runtime.incrementalFingerprints)
    });

    const dependencies = [];
    for (const dependency of mk._activeDependencies(projectRoot, model, goals)) {
      const child = resolve(
        dependency.project,
        dependency.goals,
        dependency.profile,
        chain.concat([projectRoot])
      );
      dependencies.push({
        name: dependency.name,
        project: dependency.project,
        goals: dependency.goals.slice(),
        profile: dependency.profile,
        digest: child.digest
      });
    }

    const digest = mk._sha256({
      schema: 1,
      local: localDigest,
      dependencies
    });

    return {digest, dependencies};
  }

  const result = resolve(root, request.goals, request.profile, []);
  process.stdout.write(`${JSON.stringify({digest: result.digest, dependencies: result.dependencies, visits}, null, 2)}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`recursive-trigger: ${error && error.message ? error.message : 'unexpected failure'}\n`);
  process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
}
