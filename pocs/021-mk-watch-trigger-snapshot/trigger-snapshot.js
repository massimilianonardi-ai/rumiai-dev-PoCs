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
  _sha256
};`
  );

  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(instrumented, filename);
  return mod.exports.__poc;
}

function main() {
  const request = parseArgs(process.argv.slice(2));
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  if (typeof target !== 'string' || target.length === 0) {
    fail('RUMIAI_POC_RUMIAI_OS is required', 2);
  }

  const targetRoot = fs.realpathSync(target);
  const projectRoot = fs.realpathSync(path.resolve(request.project));
  const configPath = path.join(projectRoot, 'mk.json');
  process.env.m_ROOT = targetRoot;

  const mk = loadInstrumentedMk(targetRoot);
  const config = mk._loadProjectConfig(configPath);
  const model = mk._selectModel(config, request.profile);
  mk._validateReferences(model);

  const runtime = {
    results: {},
    skipped: new Set(),
    collectionState: {},
    providerMembers: {},
    providerState: {}
  };

  const plan = mk._resolveV2(projectRoot, model, request.goals, runtime);
  const publicPlan = mk._publicPlan(plan, []);
  const fingerprints = Object.fromEntries(
    Object.entries(runtime.incrementalFingerprints || {}).sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))
  );

  const snapshot = {
    schema: 1,
    project: projectRoot,
    profile: request.profile,
    goals: request.goals.slice(),
    model,
    plan: publicPlan,
    incrementalFingerprints: fingerprints
  };

  process.stdout.write(`${mk._sha256(snapshot)}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`trigger-snapshot: ${error && error.message ? error.message : 'unexpected failure'}\n`);
  process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
}
