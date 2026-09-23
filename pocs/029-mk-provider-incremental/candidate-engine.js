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

  const allowedOld = "_assertAllowedKeys(provider, new Set(['type', 'collection', 'prerequisites', 'requirements', 'action']), `${context}: provider ${name}`);";
  const allowedNew = "_assertAllowedKeys(provider, new Set(['type', 'collection', 'prerequisites', 'requirements', 'inputs', 'outputs', 'incremental', 'action']), `${context}: provider ${name}`);";
  if (!source.includes(allowedOld)) fail('unexpected provider allowed-key boundary');
  source = source.replace(allowedOld, allowedNew);

  const resultOld = [
    "    result[name] = {",
    "      type: 'map-process',",
    "      collection: provider.collection,",
    "      prerequisites: _normalizeNameArray(provider.prerequisites, \`${context}: provider ${name} prerequisites\`),",
    "      requirements: _normalizeNameArray(provider.requirements, \`${context}: provider ${name} requirements\`),",
    "      action: _normalizeProcessAction(provider.action, \`${context}: provider ${name}\`, true)",
    "    };"
  ].join('\n');

  const resultNew = [
    "    const inputs = _normalizeOperationInputs(provider.inputs, \`${context}: provider ${name}\`);",
    "    const outputs = _normalizeOutputs(provider.outputs, \`${context}: provider ${name}\`);",
    "    let incremental = null;",
    "    if (provider.incremental !== undefined) {",
    "      if (!_isObject(provider.incremental)) {",
    "        _error(\`${context}: provider ${name}: incremental must be an object\`);",
    "      }",
    "      _assertAllowedKeys(provider.incremental, new Set(), \`${context}: provider ${name}: incremental\`);",
    "      if (Object.keys(outputs).length === 0) {",
    "        _error(\`${context}: provider ${name}: incremental requires at least one declared output\`);",
    "      }",
    "      incremental = {};",
    "    }",
    "    result[name] = {",
    "      type: 'map-process',",
    "      collection: provider.collection,",
    "      prerequisites: _normalizeNameArray(provider.prerequisites, \`${context}: provider ${name} prerequisites\`),",
    "      requirements: _normalizeNameArray(provider.requirements, \`${context}: provider ${name} requirements\`),",
    "      inputs,",
    "      outputs,",
    "      incremental,",
    "      action: _normalizeProcessAction(provider.action, \`${context}: provider ${name}\`, true)",
    "    };"
  ].join('\n');
  if (!source.includes(resultOld)) fail('unexpected provider normalization boundary');
  source = source.replace(resultOld, resultNew);

  const deriveOld = [
    "  return {",
    "    name: \`${providerName}-${token}\`,",
    "    definition: {prerequisites: provider.prerequisites.slice(), requirements: provider.requirements.slice(), action: substituteAction, when: null, inputs: {}, outputs: {}, failure: 'stop', incremental: null},",
    "    derived: {provider: providerName, item}",
    "  };"
  ].join('\n');

  const deriveNew = [
    "  const inputs = {'$item': {type: 'path', path: item}};",
    "  for (const [name, input] of Object.entries(provider.inputs)) {",
    "    if (input.type === 'path') inputs[name] = {type: 'path', path: _substituteItem(input.path, item)};",
    "    else if (input.type === 'collection') inputs[name] = {type: 'collection', collection: input.collection};",
    "    else inputs[name] = {type: 'output', operation: input.operation, name: input.name};",
    "  }",
    "  const outputs = Object.fromEntries(",
    "    Object.entries(provider.outputs).map(([name, output]) => [name, {path: _substituteItem(output.path, item)}])",
    "  );",
    "  const incremental = provider.incremental === null ? null : {inputs};",
    "  return {",
    "    name: \`${providerName}-${token}\`,",
    "    definition: {",
    "      prerequisites: provider.prerequisites.slice(),",
    "      requirements: provider.requirements.slice(),",
    "      action: substituteAction,",
    "      when: null,",
    "      inputs,",
    "      outputs,",
    "      failure: 'stop',",
    "      incremental",
    "    },",
    "    derived: {provider: providerName, item}",
    "  };"
  ].join('\n');
  if (!source.includes(deriveOld)) fail('unexpected provider derivation boundary');
  source = source.replace(deriveOld, deriveNew);

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
