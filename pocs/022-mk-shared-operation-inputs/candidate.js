'use strict';

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validName(value) {
  return typeof value === 'string' && /^(?:[a-z0-9]|[a-z0-9][a-z0-9._-]*[a-z0-9])$/.test(value);
}

function normalizeInput(value, context) {
  if (!isObject(value)) fail(`${context} must be an object`);
  const present = ['path', 'collection', 'output'].filter(key => value[key] !== undefined);
  if (present.length !== 1) fail(`${context} must select exactly one source`);

  if (present[0] === 'path') {
    if (Object.keys(value).length !== 1 || typeof value.path !== 'string' || value.path.length === 0) {
      fail(`${context}: invalid path input`);
    }
    return {type: 'path', path: value.path};
  }

  if (present[0] === 'collection') {
    if (Object.keys(value).length !== 1 || !validName(value.collection)) {
      fail(`${context}: invalid collection input`);
    }
    return {type: 'collection', collection: value.collection};
  }

  if (Object.keys(value).length !== 1 || !isObject(value.output)) {
    fail(`${context}: invalid output input`);
  }
  const keys = Object.keys(value.output).sort();
  if (keys.length !== 2 || keys[0] !== 'name' || keys[1] !== 'operation' ||
      !validName(value.output.operation) || !validName(value.output.name)) {
    fail(`${context}: invalid output input`);
  }
  return {type: 'output', operation: value.output.operation, name: value.output.name};
}

function normalizeInputMap(value, context) {
  if (value === undefined) return {};
  if (!isObject(value)) fail(`${context} must be an object`);
  const result = {};
  for (const name of Object.keys(value)) {
    if (!validName(name)) fail(`${context}: invalid input name: ${name}`);
    result[name] = normalizeInput(value[name], `${context}: input ${name}`);
  }
  return result;
}

function normalizeOperation(value) {
  if (!isObject(value)) fail('operation must be an object');

  const topInputs = normalizeInputMap(value.inputs, 'operation inputs');

  let incrementalEnabled = false;
  let legacyInputs = {};
  if (value.incremental !== undefined) {
    if (!isObject(value.incremental)) fail('operation incremental must be an object');
    const keys = Object.keys(value.incremental);
    if (keys.some(key => key !== 'inputs')) fail('operation incremental has unsupported member');
    incrementalEnabled = true;
    legacyInputs = normalizeInputMap(value.incremental.inputs, 'operation incremental inputs');
  }

  if (Object.keys(topInputs).length > 0 && Object.keys(legacyInputs).length > 0) {
    fail('operation must not declare both inputs and incremental.inputs');
  }

  const inputs = Object.keys(topInputs).length > 0 ? topInputs : legacyInputs;
  const dataDependencies = [];
  for (const input of Object.values(inputs)) {
    if (input.type === 'output') dataDependencies.push({type: 'operation', name: input.operation});
    else if (input.type === 'collection') dataDependencies.push({type: 'collection', name: input.collection});
  }

  return {
    inputs,
    incremental: {enabled: incrementalEnabled},
    dataDependencies
  };
}

function duplicatedWatchIdentity(value) {
  if (!isObject(value)) fail('operation must be an object');
  const incremental = value.incremental && isObject(value.incremental)
    ? normalizeInputMap(value.incremental.inputs, 'incremental inputs')
    : {};
  const watch = value.watch && isObject(value.watch)
    ? normalizeInputMap(value.watch.inputs, 'watch inputs')
    : {};

  const duplicates = [];
  for (const name of Object.keys(incremental)) {
    if (watch[name] !== undefined &&
        JSON.stringify(incremental[name]) === JSON.stringify(watch[name])) {
      duplicates.push(name);
    }
  }
  return duplicates.sort();
}

module.exports = {normalizeOperation, duplicatedWatchIdentity};
