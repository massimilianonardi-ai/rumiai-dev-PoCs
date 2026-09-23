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
  _resolveExecutableIdentity,
  _snapshotPath,
  _outputSnapshots,
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

function snapshotInput(mk, projectRoot, runtime, operations, input) {
  if (input.type === 'path') {
    return {type: 'path', evidence: mk._snapshotPath(projectRoot, input.path)};
  }
  if (input.type === 'collection') {
    const state = runtime.collectionState[input.collection];
    if (!state || state.state !== 'resolved') {
      return {type: 'collection', collection: input.collection, state: 'pending'};
    }
    return {
      type: 'collection',
      collection: input.collection,
      state: 'resolved',
      members: state.items.map(item => mk._snapshotPath(projectRoot, item))
    };
  }
  const producer = operations[input.operation];
  if (!producer || !producer.outputs || !producer.outputs[input.name]) {
    fail(`resolved output input references unavailable producer output: ${input.operation}.${input.name}`);
  }
  return {
    type: 'output',
    operation: input.operation,
    name: input.name,
    evidence: mk._snapshotPath(projectRoot, producer.outputs[input.name].path)
  };
}

function localDigest(mk, projectRoot, goals, profile, model) {
  const runtime = mk._newV2Runtime();
  const plan = mk._resolveV2(projectRoot, model, goals, runtime);
  const publicPlan = mk._publicPlan(plan, []);
  const operations = plan._operations;
  const actionEvidence = {};
  const inputEvidence = {};
  const incrementalOutputs = {};

  for (const entry of publicPlan.operations) {
    const operation = operations[entry.name];
    if (!operation) fail(`missing resolved operation definition: ${entry.name}`);
    if (entry.state === 'skipped') continue;

    if (operation.action !== null) {
      const executable = mk._resolveExecutableIdentity(projectRoot, model, operation.action);
      actionEvidence[entry.name] = {
        cacheable: executable.cacheable,
        identity: executable.identity,
        environment: executable.environment
      };
    }

    const inputs = {};
    for (const inputName of Object.keys(operation.inputs).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
      inputs[inputName] = snapshotInput(mk, projectRoot, runtime, operations, operation.inputs[inputName]);
    }
    if (Object.keys(inputs).length > 0) inputEvidence[entry.name] = inputs;

    if (operation.incremental !== null) {
      incrementalOutputs[entry.name] = mk._outputSnapshots(projectRoot, operation);
    }
  }

  const collectionEvidence = {};
  for (const collection of publicPlan.collections) {
    if (collection.state !== 'resolved') {
      collectionEvidence[collection.name] = {state: 'pending', waitingFor: collection.waitingFor.slice()};
    } else {
      collectionEvidence[collection.name] = {
        state: 'resolved',
        members: collection.items.map(item => mk._snapshotPath(projectRoot, item))
      };
    }
  }

  return mk._sha256({
    schema: 1,
    project: projectRoot,
    profile,
    goals: goals.slice(),
    model,
    plan: publicPlan,
    collections: collectionEvidence,
    inputs: sortedObject(inputEvidence),
    actions: sortedObject(actionEvidence),
    incrementalOutputs: sortedObject(incrementalOutputs),
    incrementalFingerprints: sortedObject(runtime.incrementalFingerprints)
  });
}

function main() {
  const request = parseArgs(process.argv.slice(2));
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  if (typeof target !== 'string' || target.length === 0) fail('RUMIAI_POC_RUMIAI_OS is required', 2);
  if (process.env.RUMIAI_POC_TRIGGER_FATAL_FILE &&
      fs.existsSync(process.env.RUMIAI_POC_TRIGGER_FATAL_FILE)) {
    fail('forced fatal trigger resolver failure');
  }

  const targetRoot = fs.realpathSync(target);
  const root = fs.realpathSync(path.resolve(request.project));
  process.env.m_ROOT = targetRoot;
  const mk = loadInstrumentedMk(targetRoot);

  function resolve(projectRoot, goals, profile, chain) {
    if (chain.includes(projectRoot)) {
      fail(`project dependency cycle: ${chain.concat([projectRoot]).join(' -> ')}`);
    }

    const model = loadModel(mk, projectRoot, profile);
    if (model.version !== 2) fail('watch requires project configuration version 2');

    const local = localDigest(mk, projectRoot, goals, profile, model);
    const dependencies = [];
    for (const dependency of mk._activeDependencies(projectRoot, model, goals)) {
      const digest = resolve(
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
        digest
      });
    }
    return mk._sha256({schema: 1, local, dependencies});
  }

  process.stdout.write(`${resolve(root, request.goals, request.profile, [])}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof TemporaryConfigError) {
    process.stderr.write(`watch-trigger: configuration unavailable: ${error.message}\n`);
    process.exitCode = TEMPORARY_CONFIG_STATUS;
  } else {
    process.stderr.write(`watch-trigger: ${error && error.message ? error.message : 'unexpected failure'}\n`);
    process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
  }
}
