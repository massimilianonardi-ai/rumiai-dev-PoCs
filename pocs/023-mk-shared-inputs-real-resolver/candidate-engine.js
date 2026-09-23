'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one source match, found ${count}`);
  return source.replace(before, after);
}

function loadCandidate(targetRoot) {
  const filename = path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js');
  let source = fs.readFileSync(filename, 'utf8');

  source = replaceOnce(
    source,
`function _normalizeIncremental(value, context) {
  if (value === undefined) {
    return null;
  }
  if (!_isObject(value)) {
    _error(\`${context}: incremental must be an object\`);
  }
  _assertAllowedKeys(value, new Set(['inputs']), \`${context}: incremental\`);
  const rawInputs = value.inputs === undefined ? {} : value.inputs;
  if (!_isObject(rawInputs)) {
    _error(\`${context}: incremental inputs must be an object\`);
  }
  const inputs = {};
  for (const name of Object.keys(rawInputs)) {
    if (!_validName(name)) {
      _error(\`${context}: invalid incremental input name: ${name}\`);
    }
    inputs[name] = _normalizeIncrementalInput(rawInputs[name], \`${context}: incremental input ${name}\`);
  }
  return {inputs};
}
`,
`function _normalizeOperationInputs(value, context) {
  if (value === undefined) return {};
  if (!_isObject(value)) _error(\`${context}: inputs must be an object\`);
  const inputs = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) _error(\`${context}: invalid input name: ${name}\`);
    inputs[name] = _normalizeIncrementalInput(value[name], \`${context}: input ${name}\`);
  }
  return inputs;
}

function _normalizeIncremental(value, context) {
  if (value === undefined) return null;
  if (!_isObject(value)) _error(\`${context}: incremental must be an object\`);
  _assertAllowedKeys(value, new Set(['inputs']), \`${context}: incremental\`);
  return {inputs: _normalizeOperationInputs(value.inputs, \`${context}: incremental\`)};
}
`,
    'normalize input ownership'
  );

  source = replaceOnce(
    source,
    ": new Set(['prerequisites', 'requirements', 'action', 'when', 'outputs', 'failure', 'incremental']);",
    ": new Set(['prerequisites', 'requirements', 'inputs', 'action', 'when', 'outputs', 'failure', 'incremental']);",
    'operation allowed keys'
  );

  source = replaceOnce(
    source,
`    outputs: {},
    failure: 'stop',
    incremental: null
  };
  if (version >= 2) {
    operation.when = value.when === undefined ? null : _normalizeCondition(value.when, \`${context}: when\`);
    operation.outputs = _normalizeOutputs(value.outputs, context);
    operation.incremental = _normalizeIncremental(value.incremental, context);
`,
`    inputs: {},
    outputs: {},
    failure: 'stop',
    incremental: null
  };
  if (version >= 2) {
    operation.when = value.when === undefined ? null : _normalizeCondition(value.when, \`${context}: when\`);
    operation.outputs = _normalizeOutputs(value.outputs, context);
    const directInputs = _normalizeOperationInputs(value.inputs, context);
    operation.incremental = _normalizeIncremental(value.incremental, context);
    const legacyInputs = operation.incremental === null ? {} : operation.incremental.inputs;
    if (Object.keys(directInputs).length > 0 && Object.keys(legacyInputs).length > 0) {
      _error(\`${context}: must not declare both inputs and incremental.inputs\`);
    }
    operation.inputs = Object.keys(directInputs).length > 0 ? directInputs : legacyInputs;
    if (operation.incremental !== null) operation.incremental.inputs = operation.inputs;
`,
    'operation normalized inputs'
  );

  source = replaceOnce(
    source,
`    if (operation.incremental !== null) {
      for (const input of Object.values(operation.incremental.inputs)) {
        if (input.type === 'collection' && model.collections[input.collection] === undefined) {
          _error(\`operation ${operationName} references unknown incremental collection: ${input.collection}\`);
        }
        if (input.type === 'output') {
          const producer = model.operations[input.operation];
          if (producer === undefined || producer.outputs[input.name] === undefined) {
            _error(\`operation ${operationName} references unknown incremental output: ${input.operation}.${input.name}\`);
          }
        }
      }
    }
`,
`    for (const input of Object.values(operation.inputs)) {
      if (input.type === 'collection' && model.collections[input.collection] === undefined) {
        _error(\`operation ${operationName} references unknown input collection: ${input.collection}\`);
      }
      if (input.type === 'output') {
        const producer = model.operations[input.operation];
        if (producer === undefined || producer.outputs[input.name] === undefined) {
          _error(\`operation ${operationName} references unknown input output: ${input.operation}.${input.name}\`);
        }
      }
    }
`,
    'reference validation'
  );

  source = source.replace(
    "runtime.incrementalFingerprints = {};\n  runtime.resultRequired = new Set();",
    "runtime.incrementalFingerprints = {};\n  runtime.operationInputSnapshots = {};\n  runtime.inputReady = new Set();\n  runtime.resultRequired = new Set();"
  );

  source = replaceOnce(
    source,
`      if (operation.incremental !== null) {
        for (const input of Object.values(operation.incremental.inputs)) {
          if (input.type === 'collection') collectCollection(input.collection);
          else if (input.type === 'output') collectOperation(input.operation);
        }
      }
`,
`      for (const input of Object.values(operation.inputs)) {
        if (input.type === 'collection') collectCollection(input.collection);
        else if (input.type === 'output') collectOperation(input.operation);
      }
`,
    'result reachability inputs'
  );

  source = replaceOnce(
    source,
`  function visitIncrementalDependencies(operation) {
    if (operation.incremental === null) return;
    for (const input of Object.values(operation.incremental.inputs)) {
      if (input.type === 'collection') visitCollection(input.collection);
      else if (input.type === 'output') visitOperation(input.operation);
    }
  }

  function incrementalInputs(name, operation) {
    const inputs = {};
    let cacheable = true;
    for (const inputName of Object.keys(operation.incremental.inputs).sort(_byteCompare)) {
      const input = operation.incremental.inputs[inputName];
`,
`  function visitInputDependencies(operation) {
    for (const input of Object.values(operation.inputs)) {
      if (input.type === 'collection') visitCollection(input.collection);
      else if (input.type === 'output') visitOperation(input.operation);
    }
  }

  function operationInputs(name, operation) {
    const inputs = {};
    let cacheable = true;
    for (const inputName of Object.keys(operation.inputs).sort(_byteCompare)) {
      const input = operation.inputs[inputName];
`,
    'resolver shared input helper'
  );

  source = replaceOnce(
    source,
`    return {ready: true, cacheable, inputs};
  }

  function assessIncremental(name, operation) {
    if (operation.incremental === null) return;
    const resolvedInputs = incrementalInputs(name, operation);
    if (!resolvedInputs.ready) return;
    runtime.incrementalReady.add(name);
`,
`    const result = {ready: true, cacheable, inputs};
    runtime.operationInputSnapshots[name] = inputs;
    runtime.inputReady.add(name);
    return result;
  }

  function assessIncremental(name, operation) {
    if (operation.incremental === null) return;
    const resolvedInputs = operationInputs(name, operation);
    if (!resolvedInputs.ready) return;
    runtime.incrementalReady.add(name);
`,
    'shared input snapshots'
  );

  source = replaceOnce(
    source,
`      for (const prerequisite of operation.prerequisites) visitReference(prerequisite);
      visitIncrementalDependencies(operation);
      if (runtime.results[name] === undefined &&
          !runtime.skipped.has(name) &&
          operation.prerequisites.every(ref => _satisfied(runtime, ref)) &&
          requirementsSatisfied(operation.requirements)) {
        assessIncremental(name, operation);
      }
`,
`      for (const prerequisite of operation.prerequisites) visitReference(prerequisite);
      visitInputDependencies(operation);
      if (runtime.results[name] === undefined &&
          !runtime.skipped.has(name) &&
          operation.prerequisites.every(ref => _satisfied(runtime, ref)) &&
          requirementsSatisfied(operation.requirements)) {
        if (operation.incremental !== null) assessIncremental(name, operation);
        else operationInputs(name, operation);
      }
`,
    'visit shared inputs'
  );

  source = replaceOnce(
    source,
`    else if (!operation.prerequisites.every(ref => _satisfied(runtime, ref))) state = 'blocked';
    else if (!requirementsSatisfied(operation.requirements)) state = 'blocked';
    else if (operation.incremental !== null && !runtime.incrementalReady.has(name)) state = 'blocked';
    else state = 'ready';
`,
`    else if (!operation.prerequisites.every(ref => _satisfied(runtime, ref))) state = 'blocked';
    else if (!requirementsSatisfied(operation.requirements)) state = 'blocked';
    else if (Object.keys(operation.inputs).length > 0 && !runtime.inputReady.has(name)) state = 'blocked';
    else if (operation.incremental !== null && !runtime.incrementalReady.has(name)) state = 'blocked';
    else state = 'ready';
`,
    'shared input readiness'
  );

  const marker = 'module.exports = {mkMain};';
  source = replaceOnce(
    source,
    marker,
`${marker}
module.exports.__poc = {
  _loadProjectConfig,
  _selectModel,
  _validateReferences,
  _resolveV2,
  _publicPlan,
  _sha256
};`,
    'poc exports'
  );

  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(source, filename);
  return mod.exports;
}

module.exports = {loadCandidate};
