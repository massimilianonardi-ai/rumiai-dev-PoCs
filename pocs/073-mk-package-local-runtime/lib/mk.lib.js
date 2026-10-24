'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

function _isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function _error(message, status = 1) {
  const error = new Error(message);
  error.mkStatus = status;
  throw error;
}

function _writeError(message) {
  process.stderr.write(`mk: ${message}\n`);
}

function _validName(value) {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value);
}

function _validEnvironmentName(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function _assertAllowedKeys(object, allowed, context) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      _error(`${context}: unsupported member: ${key}`);
    }
  }
}

function _normalizeNameArray(value, context) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    _error(`${context} must be an array`);
  }
  const result = [];
  for (const name of value) {
    if (!_validName(name)) {
      _error(`${context} has invalid name`);
    }
    result.push(name);
  }
  return result;
}

function _normalizeEnvironment(value, context, allowItem = false) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error(`${context}: environment must be an object`);
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (!_validEnvironmentName(key) || typeof value[key] !== 'string') {
      _error(`${context}: invalid environment entry: ${key}`);
    }
    if (!allowItem && value[key].includes('${item}')) {
      _error(`${context}: item substitution is not allowed here`);
    }
    result[key] = value[key];
  }
  return result;
}

function _normalizeGoalMap(value, context) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error(`${context}: goals must be an object`);
  }
  const result = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) {
      _error(`${context}: invalid goal name: ${name}`);
    }
    result[name] = _normalizeNameArray(value[name], `${context}: goal ${name}`);
  }
  return result;
}

function _normalizeProcessAction(value, context, allowItem = false) {
  if (!_isObject(value)) {
    _error(`${context}: action must be an object`);
  }
  _assertAllowedKeys(value, new Set(['type', 'command', 'args', 'cwd', 'env']), `${context}: action`);
  if (value.type !== 'process') {
    _error(`${context}: unsupported action type`);
  }
  if (typeof value.command !== 'string' || value.command.length === 0) {
    _error(`${context}: process command must be a non-empty string`);
  }
  if (!allowItem && value.command.includes('${item}')) {
    _error(`${context}: item substitution is not allowed here`);
  }
  const args = value.args === undefined ? [] : value.args;
  if (!Array.isArray(args)) {
    _error(`${context}: process args must be an array`);
  }
  const normalizedArgs = [];
  for (const argument of args) {
    if (typeof argument !== 'string') {
      _error(`${context}: process arguments must be strings`);
    }
    if (!allowItem && argument.includes('${item}')) {
      _error(`${context}: item substitution is not allowed here`);
    }
    normalizedArgs.push(argument);
  }
  if (value.cwd !== undefined && (typeof value.cwd !== 'string' || value.cwd.length === 0)) {
    _error(`${context}: process cwd must be a non-empty string`);
  }
  if (!allowItem && value.cwd !== undefined && value.cwd.includes('${item}')) {
    _error(`${context}: item substitution is not allowed here`);
  }
  return {
    type: 'process',
    command: value.command,
    args: normalizedArgs,
    cwd: value.cwd,
    env: _normalizeEnvironment(value.env, `${context}: action`, allowItem)
  };
}

function _normalizeOperand(value, context) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return {type: 'literal', value};
  }
  if (!_isObject(value)) {
    _error(`${context}: invalid condition operand`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    _error(`${context}: condition operand must contain exactly one source`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'literal')) {
    const literal = value.literal;
    if (!(literal === null || typeof literal === 'string' || typeof literal === 'number' || typeof literal === 'boolean')) {
      _error(`${context}: invalid literal operand`);
    }
    return {type: 'literal', value: literal};
  }
  if (Object.prototype.hasOwnProperty.call(value, 'result')) {
    const result = value.result;
    if (!_isObject(result)) {
      _error(`${context}: result operand must be an object`);
    }
    _assertAllowedKeys(result, new Set(['operation', 'field']), `${context}: result`);
    if (!_validName(result.operation) || !['status', 'ok', 'signal', 'error'].includes(result.field)) {
      _error(`${context}: invalid result operand`);
    }
    return {type: 'result', operation: result.operation, field: result.field};
  }
  if (Object.prototype.hasOwnProperty.call(value, 'output')) {
    const output = value.output;
    if (!_isObject(output)) {
      _error(`${context}: output operand must be an object`);
    }
    _assertAllowedKeys(output, new Set(['operation', 'name', 'property']), `${context}: output`);
    if (!_validName(output.operation) || !_validName(output.name) || !['exists', 'size'].includes(output.property)) {
      _error(`${context}: invalid output operand`);
    }
    return {type: 'output', operation: output.operation, name: output.name, property: output.property};
  }
  if (Object.prototype.hasOwnProperty.call(value, 'state')) {
    const state = value.state;
    if (!_isObject(state)) {
      _error(`${context}: state operand must be an object`);
    }
    _assertAllowedKeys(state, new Set(['path', 'property']), `${context}: state`);
    if (typeof state.path !== 'string' || state.path.length === 0 || !['exists', 'size'].includes(state.property)) {
      _error(`${context}: invalid state operand`);
    }
    return {type: 'state', path: state.path, property: state.property};
  }
  _error(`${context}: unsupported condition operand`);
}

function _normalizeCondition(value, context) {
  if (!_isObject(value) || typeof value.op !== 'string') {
    _error(`${context}: condition must be an object with op`);
  }
  const compare = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);
  if (compare.has(value.op)) {
    _assertAllowedKeys(value, new Set(['op', 'left', 'right']), context);
    if (value.left === undefined || value.right === undefined) {
      _error(`${context}: ${value.op} requires left and right operands`);
    }
    return {
      op: value.op,
      left: _normalizeOperand(value.left, `${context}: left`),
      right: _normalizeOperand(value.right, `${context}: right`)
    };
  }
  if (value.op === 'truthy') {
    _assertAllowedKeys(value, new Set(['op', 'value']), context);
    if (value.value === undefined) {
      _error(`${context}: truthy requires value`);
    }
    return {op: 'truthy', value: _normalizeOperand(value.value, `${context}: value`)};
  }
  if (value.op === 'not') {
    _assertAllowedKeys(value, new Set(['op', 'condition']), context);
    if (value.condition === undefined) {
      _error(`${context}: not requires condition`);
    }
    return {op: 'not', condition: _normalizeCondition(value.condition, `${context}: condition`)};
  }
  _error(`${context}: unsupported condition op: ${value.op}`);
}

function _normalizeOutputs(value, context) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error(`${context}: outputs must be an object`);
  }
  const result = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) {
      _error(`${context}: invalid output name: ${name}`);
    }
    const output = value[name];
    if (!_isObject(output)) {
      _error(`${context}: output ${name} must be an object`);
    }
    _assertAllowedKeys(output, new Set(['path']), `${context}: output ${name}`);
    if (typeof output.path !== 'string' || output.path.length === 0) {
      _error(`${context}: output ${name} path must be a non-empty string`);
    }
    result[name] = {path: output.path};
  }
  return result;
}

function _normalizeIncrementalInput(value, context) {
  if (!_isObject(value)) {
    _error(`${context}: incremental input must be an object`);
  }
  const present = ['path', 'collection', 'output'].filter(key => value[key] !== undefined);
  if (present.length !== 1) {
    _error(`${context}: incremental input must select exactly one source`);
  }
  if (present[0] === 'path') {
    _assertAllowedKeys(value, new Set(['path']), context);
    if (typeof value.path !== 'string' || value.path.length === 0) {
      _error(`${context}: path must be a non-empty string`);
    }
    return {type: 'path', path: value.path};
  }
  if (present[0] === 'collection') {
    _assertAllowedKeys(value, new Set(['collection']), context);
    if (!_validName(value.collection)) {
      _error(`${context}: collection must be a valid name`);
    }
    return {type: 'collection', collection: value.collection};
  }
  _assertAllowedKeys(value, new Set(['output']), context);
  if (!_isObject(value.output)) {
    _error(`${context}: output must be an object`);
  }
  _assertAllowedKeys(value.output, new Set(['operation', 'name']), `${context}: output`);
  if (!_validName(value.output.operation) || !_validName(value.output.name)) {
    _error(`${context}: output operation/name must be valid names`);
  }
  return {type: 'output', operation: value.output.operation, name: value.output.name};
}

function _normalizeOperationInputs(value, context) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error(`${context}: inputs must be an object`);
  }
  const inputs = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) {
      _error(`${context}: invalid input name: ${name}`);
    }
    inputs[name] = _normalizeIncrementalInput(value[name], `${context}: input ${name}`);
  }
  return inputs;
}

function _normalizeIncremental(value, context) {
  if (value === undefined) {
    return null;
  }
  if (!_isObject(value)) {
    _error(`${context}: incremental must be an object`);
  }
  _assertAllowedKeys(value, new Set(['inputs']), `${context}: incremental`);
  return {inputs: _normalizeOperationInputs(value.inputs, `${context}: incremental`)};
}

function _normalizeOperation(value, context, version) {
  if (!_isObject(value)) {
    _error(`${context} must be an object`);
  }
  const allowed = version === 1
    ? new Set(['prerequisites', 'action'])
    : new Set(['prerequisites', 'requirements', 'inputs', 'action', 'when', 'outputs', 'failure', 'incremental']);
  _assertAllowedKeys(value, allowed, context);
  const operation = {
    prerequisites: _normalizeNameArray(value.prerequisites, `${context} prerequisites`),
    requirements: version >= 2 ? _normalizeNameArray(value.requirements, `${context} requirements`) : [],
    action: value.action === undefined ? null : _normalizeProcessAction(value.action, context),
    when: null,
    inputs: {},
    outputs: {},
    failure: 'stop',
    incremental: null
  };
  if (version >= 2) {
    operation.when = value.when === undefined ? null : _normalizeCondition(value.when, `${context}: when`);
    operation.outputs = _normalizeOutputs(value.outputs, context);
    const directInputs = _normalizeOperationInputs(value.inputs, context);
    operation.incremental = _normalizeIncremental(value.incremental, context);
    const legacyInputs = operation.incremental === null ? {} : operation.incremental.inputs;
    if (Object.keys(directInputs).length > 0 && Object.keys(legacyInputs).length > 0) {
      _error(`${context}: must not declare both inputs and incremental.inputs`);
    }
    operation.inputs = Object.keys(directInputs).length > 0 ? directInputs : legacyInputs;
    if (operation.incremental !== null) {
      operation.incremental.inputs = operation.inputs;
    }
    if (operation.incremental !== null && operation.action === null) {
      _error(`${context}: incremental operation requires a process action`);
    }
    if (operation.incremental !== null && Object.keys(operation.outputs).length === 0) {
      _error(`${context}: incremental operation requires at least one declared output`);
    }
    if (value.failure !== undefined && value.failure !== 'stop' && value.failure !== 'continue') {
      _error(`${context}: failure must be stop or continue`);
    }
    operation.failure = value.failure === undefined ? 'stop' : value.failure;
  }
  return operation;
}

function _normalizeOperationMap(value, context, version) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error(`${context}: operations must be an object`);
  }
  const result = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) {
      _error(`${context}: invalid operation name: ${name}`);
    }
    result[name] = _normalizeOperation(value[name], `${context}: operation ${name}`, version);
  }
  return result;
}

function _normalizeStringArray(value, context) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    _error(`${context} must be an array of strings`);
  }
  return value.slice();
}

function _normalizeCollectionMap(value, context) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error(`${context}: collections must be an object`);
  }
  const result = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) {
      _error(`${context}: invalid collection name: ${name}`);
    }
    const collection = value[name];
    if (!_isObject(collection)) {
      _error(`${context}: collection ${name} must be an object`);
    }
    _assertAllowedKeys(collection, new Set(['type', 'root', 'suffixes', 'include', 'exclude', 'after']), `${context}: collection ${name}`);
    if (collection.type !== 'files') {
      _error(`${context}: collection ${name}: unsupported collection type`);
    }
    if (typeof collection.root !== 'string' || collection.root.length === 0) {
      _error(`${context}: collection ${name}: root must be a non-empty string`);
    }
    const suffixes = _normalizeStringArray(collection.suffixes, `${context}: collection ${name} suffixes`);
    if (suffixes.some(item => item.length === 0)) {
      _error(`${context}: collection ${name}: suffixes must be non-empty strings`);
    }
    result[name] = {
      type: 'files',
      root: collection.root,
      suffixes,
      include: _normalizeStringArray(collection.include, `${context}: collection ${name} include`),
      exclude: _normalizeStringArray(collection.exclude, `${context}: collection ${name} exclude`),
      after: _normalizeNameArray(collection.after, `${context}: collection ${name} after`)
    };
  }
  return result;
}

function _normalizeProviderMap(value, context) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error(`${context}: providers must be an object`);
  }
  const result = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) {
      _error(`${context}: invalid provider name: ${name}`);
    }
    const provider = value[name];
    if (!_isObject(provider)) {
      _error(`${context}: provider ${name} must be an object`);
    }
    _assertAllowedKeys(provider, new Set(['type', 'collection', 'prerequisites', 'requirements', 'inputs', 'outputs', 'incremental', 'action']), `${context}: provider ${name}`);
    if (provider.type !== 'map-process' || !_validName(provider.collection)) {
      _error(`${context}: provider ${name}: invalid map-process provider`);
    }
    const inputs = _normalizeOperationInputs(provider.inputs, `${context}: provider ${name}`);
    const outputs = _normalizeOutputs(provider.outputs, `${context}: provider ${name}`);
    let incremental = null;
    if (provider.incremental !== undefined) {
      if (!_isObject(provider.incremental)) {
        _error(`${context}: provider ${name}: incremental must be an object`);
      }
      _assertAllowedKeys(provider.incremental, new Set(), `${context}: provider ${name}: incremental`);
      if (Object.keys(outputs).length === 0) {
        _error(`${context}: provider ${name}: incremental requires at least one declared output`);
      }
      incremental = {};
    }
    result[name] = {
      type: 'map-process',
      collection: provider.collection,
      prerequisites: _normalizeNameArray(provider.prerequisites, `${context}: provider ${name} prerequisites`),
      requirements: _normalizeNameArray(provider.requirements, `${context}: provider ${name} requirements`),
      inputs,
      outputs,
      incremental,
      action: _normalizeProcessAction(provider.action, `${context}: provider ${name}`, true)
    };
  }
  return result;
}

function _normalizeRequirementMap(value, context) {
  if (value === undefined) return {};
  if (!_isObject(value)) _error(`${context}: requirements must be an object`);
  const result = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) _error(`${context}: invalid requirement name: ${name}`);
    const requirement = value[name];
    if (!_isObject(requirement)) _error(`${context}: requirement ${name} must be an object`);
    _assertAllowedKeys(requirement, new Set(['type', 'facility', 'constraints']), `${context}: requirement ${name}`);
    if (requirement.type !== 'facility') _error(`${context}: requirement ${name}: unsupported type`);
    if (typeof requirement.facility !== 'string' || !/^[a-z][a-z0-9-]*$/.test(requirement.facility)) {
      _error(`${context}: requirement ${name}: invalid facility`);
    }
    if (!Array.isArray(requirement.constraints) || requirement.constraints.length === 0 ||
        requirement.constraints.some(value => typeof value !== 'string' || value.length === 0)) {
      _error(`${context}: requirement ${name}: constraints must be a non-empty string array`);
    }
    result[name] = {type: 'facility', facility: requirement.facility, constraints: requirement.constraints.slice()};
  }
  return result;
}

function _normalizeDependencyMap(value, context) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error(`${context}: dependencies must be an object`);
  }
  const result = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) {
      _error(`${context}: invalid dependency name: ${name}`);
    }
    const dependency = value[name];
    if (!_isObject(dependency)) {
      _error(`${context}: dependency ${name} must be an object`);
    }
    _assertAllowedKeys(dependency, new Set(['project', 'goals', 'profile']), `${context}: dependency ${name}`);
    if (typeof dependency.project !== 'string' || dependency.project.length === 0) {
      _error(`${context}: dependency ${name}: project must be a non-empty string`);
    }
    if (!_isObject(dependency.goals)) {
      _error(`${context}: dependency ${name}: goals must be an object`);
    }
    const goals = {};
    for (const parentGoal of Object.keys(dependency.goals)) {
      if (!_validName(parentGoal)) {
        _error(`${context}: dependency ${name}: invalid parent goal name: ${parentGoal}`);
      }
      goals[parentGoal] = _normalizeNameArray(dependency.goals[parentGoal], `${context}: dependency ${name}: goal ${parentGoal}`);
    }
    if (dependency.profile !== undefined && !_validName(dependency.profile)) {
      _error(`${context}: dependency ${name}: invalid profile name`);
    }
    result[name] = {
      project: dependency.project,
      goals,
      profile: dependency.profile === undefined ? null : dependency.profile
    };
  }
  return result;
}

function _normalizeProfiles(value, version) {
  if (value === undefined) {
    return {};
  }
  if (!_isObject(value)) {
    _error('project: profiles must be an object');
  }
  const result = {};
  for (const name of Object.keys(value)) {
    if (!_validName(name)) {
      _error(`project: invalid profile name: ${name}`);
    }
    const profile = value[name];
    if (!_isObject(profile)) {
      _error(`project: profile ${name} must be an object`);
    }
    const allowed = version === 1
      ? new Set(['environment', 'goals', 'operations'])
      : new Set(['environment', 'goals', 'operations', 'collections', 'providers', 'dependencies', 'requirements']);
    _assertAllowedKeys(profile, allowed, `project: profile ${name}`);
    result[name] = {
      environment: _normalizeEnvironment(profile.environment, `project: profile ${name}`),
      goals: _normalizeGoalMap(profile.goals, `project: profile ${name}`),
      operations: _normalizeOperationMap(profile.operations, `project: profile ${name}`, version),
      collections: version >= 2 ? _normalizeCollectionMap(profile.collections, `project: profile ${name}`) : {},
      providers: version >= 2 ? _normalizeProviderMap(profile.providers, `project: profile ${name}`) : {},
      dependencies: version >= 2 ? _normalizeDependencyMap(profile.dependencies, `project: profile ${name}`) : {},
      requirements: version >= 2 ? _normalizeRequirementMap(profile.requirements, `project: profile ${name}`) : {}
    };
  }
  return result;
}

function _loadProjectConfig(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    _error(`cannot read project configuration: ${configPath}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    _error(`invalid JSON project configuration: ${configPath}`);
  }
  if (!_isObject(raw)) {
    _error('project configuration must be a JSON object');
  }
  if (raw.version !== 1 && raw.version !== 2) {
    _error('project configuration version must be 1 or 2');
  }
  const version = raw.version;
  const allowed = version === 1
    ? new Set(['version', 'environment', 'goals', 'operations', 'profiles'])
    : new Set(['version', 'environment', 'goals', 'operations', 'profiles', 'collections', 'providers', 'dependencies', 'requirements']);
  _assertAllowedKeys(raw, allowed, 'project');
  return {
    version,
    environment: _normalizeEnvironment(raw.environment, 'project'),
    goals: _normalizeGoalMap(raw.goals, 'project'),
    operations: _normalizeOperationMap(raw.operations, 'project', version),
    collections: version >= 2 ? _normalizeCollectionMap(raw.collections, 'project') : {},
    providers: version >= 2 ? _normalizeProviderMap(raw.providers, 'project') : {},
    dependencies: version >= 2 ? _normalizeDependencyMap(raw.dependencies, 'project') : {},
    requirements: version >= 2 ? _normalizeRequirementMap(raw.requirements, 'project') : {},
    profiles: _normalizeProfiles(raw.profiles, version)
  };
}

function _selectModel(config, profileName) {
  const model = {
    version: config.version,
    environment: Object.assign({}, config.environment),
    goals: Object.assign({}, config.goals),
    operations: Object.assign({}, config.operations),
    collections: Object.assign({}, config.collections),
    providers: Object.assign({}, config.providers),
    dependencies: Object.assign({}, config.dependencies),
    requirements: Object.assign({}, config.requirements)
  };
  if (profileName === null) {
    return model;
  }
  if (!_validName(profileName)) {
    _error(`invalid profile name: ${profileName}`, 2);
  }
  const profile = config.profiles[profileName];
  if (profile === undefined) {
    _error(`unknown profile: ${profileName}`);
  }
  Object.assign(model.environment, profile.environment);
  Object.assign(model.goals, profile.goals);
  Object.assign(model.operations, profile.operations);
  Object.assign(model.collections, profile.collections);
  Object.assign(model.providers, profile.providers);
  Object.assign(model.dependencies, profile.dependencies);
  Object.assign(model.requirements, profile.requirements);
  return model;
}

function _conditionOperationReferences(condition, result) {
  if (condition === null) {
    return;
  }
  function operand(value) {
    if (value.type === 'result' || value.type === 'output') {
      result.add(value.operation);
    }
  }
  if (condition.op === 'not') {
    _conditionOperationReferences(condition.condition, result);
  } else if (condition.op === 'truthy') {
    operand(condition.value);
  } else {
    operand(condition.left);
    operand(condition.right);
  }
}

function _conditionResultReferences(condition, result) {
  if (condition === null) {
    return;
  }
  function operand(value) {
    if (value.type === 'result') {
      result.add(value.operation);
    }
  }
  if (condition.op === 'not') {
    _conditionResultReferences(condition.condition, result);
  } else if (condition.op === 'truthy') {
    operand(condition.value);
  } else {
    operand(condition.left);
    operand(condition.right);
  }
}

function _validateReferences(model) {
  for (const name of Object.keys(model.providers)) {
    if (model.operations[name] !== undefined) _error(`operation/provider name collision: ${name}`);
  }
  const hasReference = name => model.operations[name] !== undefined || model.providers[name] !== undefined;
  for (const goalName of Object.keys(model.goals)) {
    for (const root of model.goals[goalName]) {
      if (!hasReference(root)) {
        _error(`goal ${goalName} references unknown operation/provider: ${root}`);
      }
    }
  }
  for (const operationName of Object.keys(model.operations)) {
    const operation = model.operations[operationName];
    for (const prerequisite of operation.prerequisites) {
      if (!hasReference(prerequisite)) {
        _error(`operation ${operationName} references unknown prerequisite: ${prerequisite}`);
      }
    }
    for (const requirement of operation.requirements) {
      if (model.requirements[requirement] === undefined) {
        _error(`operation ${operationName} references unknown requirement: ${requirement}`);
      }
    }
    for (const input of Object.values(operation.inputs)) {
      if (input.type === 'collection' && model.collections[input.collection] === undefined) {
        _error(`operation ${operationName} references unknown input collection: ${input.collection}`);
      }
      if (input.type === 'output') {
        const producer = model.operations[input.operation];
        if (producer === undefined || producer.outputs[input.name] === undefined) {
          _error(`operation ${operationName} references unknown input output: ${input.operation}.${input.name}`);
        }
      }
    }
    const observed = new Set();
    _conditionOperationReferences(operation.when, observed);
    for (const name of observed) {
      const target = model.operations[name];
      if (target === undefined) {
        _error(`operation ${operationName} condition references unknown operation: ${name}`);
      }
      if (operation.when !== null) {
        // output-name validation happens below after walking the condition tree
      }
    }
  }
  for (const providerName of Object.keys(model.providers)) {
    const provider = model.providers[providerName];
    if (model.collections[provider.collection] === undefined) {
      _error(`provider ${providerName} references unknown collection: ${provider.collection}`);
    }
    for (const prerequisite of provider.prerequisites) {
      if (!hasReference(prerequisite)) {
        _error(`provider ${providerName} references unknown prerequisite: ${prerequisite}`);
      }
    }
    for (const requirement of provider.requirements) {
      if (model.requirements[requirement] === undefined) {
        _error(`provider ${providerName} references unknown requirement: ${requirement}`);
      }
    }
    for (const input of Object.values(provider.inputs)) {
      if (input.type === 'collection' && model.collections[input.collection] === undefined) {
        _error(`provider ${providerName} references unknown input collection: ${input.collection}`);
      }
      if (input.type === 'output') {
        const producer = model.operations[input.operation];
        if (producer === undefined || producer.outputs[input.name] === undefined) {
          _error(`provider ${providerName} references unknown input output: ${input.operation}.${input.name}`);
        }
      }
    }
  }
  for (const collectionName of Object.keys(model.collections)) {
    for (const after of model.collections[collectionName].after) {
      if (!hasReference(after)) {
        _error(`collection ${collectionName} references unknown after dependency: ${after}`);
      }
    }
  }
  for (const dependencyName of Object.keys(model.dependencies)) {
    const dependency = model.dependencies[dependencyName];
    for (const parentGoal of Object.keys(dependency.goals)) {
      if (model.goals[parentGoal] === undefined) {
        _error(`dependency ${dependencyName} maps unknown parent goal: ${parentGoal}`);
      }
    }
  }

  function validateConditionOutputs(condition, owner) {
    if (condition === null) return;
    function checkOperand(operand) {
      if (operand.type === 'output') {
        const target = model.operations[operand.operation];
        if (target === undefined || target.outputs[operand.name] === undefined) {
          _error(`operation ${owner} condition references unknown output: ${operand.operation}.${operand.name}`);
        }
      }
    }
    if (condition.op === 'not') validateConditionOutputs(condition.condition, owner);
    else if (condition.op === 'truthy') checkOperand(condition.value);
    else { checkOperand(condition.left); checkOperand(condition.right); }
  }
  for (const name of Object.keys(model.operations)) {
    validateConditionOutputs(model.operations[name].when, name);
  }
}

function _parseCli(argv) {
  const request = {project: null, profile: null, watch: false, plan: false, listGoals: false, showGoal: null, goals: []};
  let options = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (options && argument === '--') { options = false; continue; }
    if (options && argument === '--project') {
      index += 1; if (index >= argv.length) _error('--project requires a pathname', 2);
      request.project = argv[index]; continue;
    }
    if (options && argument === '--profile') {
      index += 1; if (index >= argv.length) _error('--profile requires a profile name', 2);
      request.profile = argv[index]; continue;
    }
    if (options && argument === '--watch') {
      if (request.watch) _error('--watch may be specified only once', 2);
      request.watch = true; continue;
    }
    if (options && argument === '--plan') { request.plan = true; continue; }
    if (options && argument === '--goals') { request.listGoals = true; continue; }
    if (options && argument === '--show-goal') {
      index += 1; if (index >= argv.length) _error('--show-goal requires a goal name', 2);
      request.showGoal = argv[index]; continue;
    }
    if (options && argument.startsWith('-')) _error(`unknown option: ${argument}`, 2);
    request.goals.push(argument);
  }
  if (request.profile !== null && !_validName(request.profile)) _error(`invalid profile name: ${request.profile}`, 2);
  if (request.showGoal !== null && !_validName(request.showGoal)) _error(`invalid goal name: ${request.showGoal}`, 2);
  for (const goal of request.goals) if (!_validName(goal)) _error(`invalid goal name: ${goal}`, 2);
  const introspectionCount = (request.listGoals ? 1 : 0) + (request.showGoal !== null ? 1 : 0);
  if (introspectionCount > 1 || (introspectionCount > 0 && request.plan)) _error('incompatible introspection/execution options', 2);
  if (request.watch && (request.plan || introspectionCount > 0)) _error('--watch is incompatible with planning/introspection options', 2);
  if (introspectionCount > 0 && request.goals.length > 0) _error('goal operands are not accepted with --goals or --show-goal', 2);
  if (introspectionCount === 0 && request.goals.length === 0) _error('at least one goal is required', 2);
  return request;
}

function _discoverProject(explicitPath) {
  if (explicitPath !== null) {
    let root;
    try {
      root = fs.realpathSync(path.resolve(process.cwd(), explicitPath));
      if (!fs.statSync(root).isDirectory()) _error(`project path is not a directory: ${explicitPath}`);
    } catch (error) {
      if (error.mkStatus !== undefined) throw error;
      _error(`invalid project path: ${explicitPath}`);
    }
    const configPath = path.join(root, 'mk.json');
    try {
      if (!fs.statSync(configPath).isFile()) _error(`project configuration is not a regular file: ${configPath}`);
    } catch (error) {
      if (error.mkStatus !== undefined) throw error;
      _error(`project configuration not found: ${configPath}`);
    }
    return {root, configPath};
  }
  let current;
  try { current = fs.realpathSync(process.cwd()); } catch (error) { _error('cannot resolve current working directory'); }
  while (true) {
    const configPath = path.join(current, 'mk.json');
    try { if (fs.statSync(configPath).isFile()) return {root: current, configPath}; }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') _error(`cannot inspect project configuration: ${configPath}`); }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  _error('project configuration mk.json not found');
}

function _planV1(model, requestedGoals) {
  _validateReferences(model);
  const state = {}, stack = [], plan = [];
  function visit(operationName) {
    const currentState = state[operationName] || 0;
    if (currentState === 2) return;
    if (currentState === 1) _error(`operation prerequisite cycle: ${stack.concat([operationName]).join(' -> ')}`);
    state[operationName] = 1; stack.push(operationName);
    const operation = model.operations[operationName];
    for (const prerequisite of operation.prerequisites) visit(prerequisite);
    stack.pop(); state[operationName] = 2; plan.push(operationName);
  }
  for (const goalName of requestedGoals) {
    const roots = model.goals[goalName]; if (roots === undefined) _error(`unknown goal: ${goalName}`);
    for (const root of roots) visit(root);
  }
  return plan;
}

function _callerEnvironment() {
  const environment = Object.assign({}, process.env);
  if (environment.m_MK_CALLER_PATH !== undefined) environment.PATH = environment.m_MK_CALLER_PATH;
  if (environment.m_MK_CALLER_HOME_DEFINED === '1') environment.HOME = environment.m_MK_CALLER_HOME || '';
  else if (environment.m_MK_CALLER_HOME_DEFINED === '0') delete environment.HOME;
  delete environment.m_MK_CALLER_PATH; delete environment.m_MK_CALLER_HOME; delete environment.m_MK_CALLER_HOME_DEFINED;
  delete environment.m_MK_DEPENDENCY_CHAIN;
  delete environment.m_MK_WATCH_TRIGGER;
  return environment;
}

function _canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(_canonicalValue);
  }
  if (_isObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort(_byteCompare)) {
      result[key] = _canonicalValue(value[key]);
    }
    return result;
  }
  return value;
}

function _stableJson(value) {
  return JSON.stringify(_canonicalValue(value));
}

function _sha256(value) {
  const hash = crypto.createHash('sha256');
  hash.update(typeof value === 'string' ? value : _stableJson(value));
  return hash.digest('hex');
}

function _hashFile(pathname) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(pathname, 'r');
  const buffer = Buffer.allocUnsafe(65536);
  try {
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function _modeBits(stat) {
  return stat.mode & 0o777;
}

function _snapshotAbsolutePath(absolute, identity) {
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return {cacheable: true, snapshot: {identity, exists: false}};
    }
    return {cacheable: false, snapshot: null};
  }
  if (stat.isSymbolicLink()) {
    return {cacheable: false, snapshot: null};
  }
  if (stat.isFile()) {
    return {
      cacheable: true,
      snapshot: {
        identity,
        exists: true,
        type: 'file',
        mode: _modeBits(stat),
        size: stat.size,
        sha256: _hashFile(absolute)
      }
    };
  }
  if (!stat.isDirectory()) {
    return {cacheable: false, snapshot: null};
  }
  const entries = [];
  let cacheable = true;
  function walk(directory, relative) {
    let names;
    try {
      names = fs.readdirSync(directory).sort(_byteCompare);
    } catch (error) {
      cacheable = false;
      return;
    }
    for (const name of names) {
      const child = path.join(directory, name);
      const childRelative = relative.length === 0 ? name : `${relative}/${name}`;
      let childStat;
      try {
        childStat = fs.lstatSync(child);
      } catch (error) {
        cacheable = false;
        continue;
      }
      if (childStat.isSymbolicLink() || (!childStat.isDirectory() && !childStat.isFile())) {
        cacheable = false;
        continue;
      }
      if (childStat.isDirectory()) {
        entries.push({path: childRelative, type: 'directory', mode: _modeBits(childStat)});
        walk(child, childRelative);
      } else {
        try {
          entries.push({
            path: childRelative,
            type: 'file',
            mode: _modeBits(childStat),
            size: childStat.size,
            sha256: _hashFile(child)
          });
        } catch (error) {
          cacheable = false;
        }
      }
    }
  }
  walk(absolute, '');
  return cacheable
    ? {cacheable: true, snapshot: {identity, exists: true, type: 'directory', mode: _modeBits(stat), entries}}
    : {cacheable: false, snapshot: null};
}

function _snapshotPath(projectRoot, pathname) {
  const absolute = path.isAbsolute(pathname) ? pathname : path.resolve(projectRoot, pathname);
  return _snapshotAbsolutePath(absolute, pathname);
}

function _actionCwd(projectRoot, action) {
  if (action.cwd === undefined) return projectRoot;
  return path.isAbsolute(action.cwd) ? action.cwd : path.resolve(projectRoot, action.cwd);
}

function _effectiveActionEnvironment(model, action) {
  const environment = _callerEnvironment();
  _applyEnvironment(environment, model.environment);
  _applyEnvironment(environment, action.env);
  return environment;
}

function _resolveExecutableIdentity(projectRoot, model, action) {
  const cwd = _actionCwd(projectRoot, action);
  const environment = _effectiveActionEnvironment(model, action);
  const candidates = action.command.includes('/')
    ? [path.isAbsolute(action.command) ? action.command : path.resolve(cwd, action.command)]
    : String(environment.PATH || '').split(path.delimiter).filter(value => value.length > 0).map(directory => path.join(directory, action.command));

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const resolved = fs.realpathSync(candidate);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) continue;
      return {
        cacheable: true,
        identity: {
          command: action.command,
          resolved,
          mode: _modeBits(stat),
          size: stat.size,
          sha256: _hashFile(resolved)
        },
        environment
      };
    } catch (error) {
      // Try the next PATH candidate. Failure to identify the executable becomes a conservative miss.
    }
  }
  return {cacheable: false, identity: null, environment};
}

function _mkCacheRoot() {
  const root = process.env.m_ROOT;
  if (typeof root !== 'string' || root.length === 0) return null;
  const bootstrap = path.join(root, 'm');
  const statePath = path.join(root, 'bin', 'sys', 'state-path');
  const result = childProcess.spawnSync(bootstrap, [statePath, 'user', 'sys', 'mk', 'cache'], {
    env: _callerEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (result.error || result.signal !== null || result.status !== 0) return null;
  const value = result.stdout.trim();
  if (value.length === 0 || value.includes('\n') || !path.isAbsolute(value)) return null;
  return value;
}

function _freshnessRecordPath(projectRoot, operationName) {
  const cacheRoot = _mkCacheRoot();
  if (cacheRoot === null) return null;
  return path.join(cacheRoot, 'projects', _sha256(projectRoot), 'operations', `${_sha256(operationName)}.json`);
}

function _readFreshnessRecord(projectRoot, operationName) {
  const recordPath = _freshnessRecordPath(projectRoot, operationName);
  if (recordPath === null) return null;
  try {
    const stat = fs.lstatSync(recordPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    if (!_isObject(record) || record.schema !== 1 || record.operation !== operationName ||
        typeof record.fingerprint !== 'string' || !_isObject(record.outputs)) return null;
    return record;
  } catch (error) {
    return null;
  }
}

function _deleteFreshnessRecord(projectRoot, operationName) {
  const recordPath = _freshnessRecordPath(projectRoot, operationName);
  if (recordPath === null) return;
  try {
    fs.unlinkSync(recordPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Freshness state is non-authoritative. Removal failure must not fail the lifecycle.
    }
  }
}

function _writeFreshnessRecord(projectRoot, operationName, fingerprint, outputs) {
  const recordPath = _freshnessRecordPath(projectRoot, operationName);
  if (recordPath === null) return;
  const directory = path.dirname(recordPath);
  let temporary = null;
  try {
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    temporary = `${recordPath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify({schema: 1, operation: operationName, fingerprint, outputs}, null, 2)}\n`, {mode: 0o600});
    fs.renameSync(temporary, recordPath);
    temporary = null;
  } catch (error) {
    // Freshness state is non-authoritative. Write failure must not fail the lifecycle.
  } finally {
    if (temporary !== null) {
      try { fs.unlinkSync(temporary); } catch (error) { /* best-effort cleanup */ }
    }
  }
}

function _artifactStorePath(projectRoot, operationName, fingerprint) {
  const cacheRoot = _mkCacheRoot();
  if (cacheRoot === null) return null;
  return path.join(cacheRoot, 'shared-artifacts', fingerprint);
}

function _artifactAttemptToken() {
  return process.pid + '-' + crypto.randomBytes(12).toString('hex');
}

function _artifactLeaseDirectory(root, kind) {
  return path.join(root, '.' + kind + '-leases');
}

function _artifactLeaseAcquire(directory, token) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const temporary = path.join(directory, '.prep-' + token);
  const published = path.join(directory, token);
  let fd = null;
  try {
    const result = childProcess.spawnSync('mkfifo', [temporary], {encoding: 'utf8'});
    if (result.error || result.status !== 0) {
      throw new Error('cannot create artifact activity token');
    }
    fs.chmodSync(temporary, 0o600);
    fd = fs.openSync(temporary, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    fs.renameSync(temporary, published);
    return {path: published, fd};
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (closeError) {}
    }
    try { fs.unlinkSync(temporary); } catch (unlinkError) {}
    try { fs.unlinkSync(published); } catch (unlinkError) {}
    throw error;
  }
}

function _artifactLeaseRelease(lease) {
  if (lease === null) return;
  try { fs.unlinkSync(lease.path); } catch (error) {}
  try { fs.closeSync(lease.fd); } catch (error) {}
}

function _artifactLeaseState(leasePath) {
  try {
    const stat = fs.lstatSync(leasePath);
    if (!stat.isFIFO()) return 'unknown';
    const fd = fs.openSync(leasePath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    fs.closeSync(fd);
    return 'live';
  } catch (error) {
    if (error && error.code === 'ENOENT') return 'missing';
    if (error && error.code === 'ENXIO') return 'stale';
    return 'unknown';
  }
}

function _artifactLiveLeases(directory, exceptPath = null) {
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    return [];
  }

  const live = [];
  for (const name of names) {
    const leasePath = path.join(directory, name);
    if (leasePath === exceptPath) continue;
    if (name.startsWith('.prep-')) {
      try { fs.unlinkSync(leasePath); } catch (error) {}
      continue;
    }

    const state = _artifactLeaseState(leasePath);
    if (state === 'stale') {
      try { fs.unlinkSync(leasePath); } catch (error) {}
      continue;
    }
    if (state === 'live' || state === 'unknown') live.push(leasePath);
  }
  return live;
}

function _artifactCandidateNames(root) {
  try {
    return fs.readdirSync(path.join(root, 'candidates'))
      .filter(_artifactCandidateNameValid)
      .sort(_byteCompare);
  } catch (error) {
    return [];
  }
}

function _artifactReclaimCandidate(root, candidate) {
  const source = _artifactCandidatePath(root, candidate);
  const quarantine = path.join(root, '.reclaim');
  const retired = path.join(quarantine, candidate + '-' + _artifactAttemptToken());
  try {
    fs.mkdirSync(quarantine, {recursive: true, mode: 0o700});
    fs.renameSync(source, retired);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
  fs.rmSync(retired, {recursive: true, force: true});
  return true;
}

function _artifactCleanupAttemptResidue(root) {
  const leases = _artifactLeaseDirectory(root, 'attempt');
  let names;
  try {
    names = fs.readdirSync(root);
  } catch (error) {
    return;
  }

  for (const name of names) {
    if (!name.startsWith('.staging-')) continue;
    const token = name.slice('.staging-'.length);
    const leasePath = path.join(leases, token);
    const state = _artifactLeaseState(leasePath);
    if (state === 'live' || state === 'unknown') continue;
    fs.rmSync(path.join(root, name), {recursive: true, force: true});
    if (state === 'stale') {
      try { fs.unlinkSync(leasePath); } catch (error) {}
    }
  }
  _artifactLiveLeases(leases);
}

function _artifactCleanupSelectorTemps(root) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch (error) {
    return;
  }
  for (const name of names) {
    if (!name.startsWith('.current-')) continue;
    try { fs.unlinkSync(path.join(root, name)); } catch (error) {}
  }
}

function _artifactMaintain(root) {
  let maintenance = null;
  try {
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    maintenance = _artifactLeaseAcquire(
      _artifactLeaseDirectory(root, 'maintenance'),
      _artifactAttemptToken()
    );
    _artifactLiveLeases(_artifactLeaseDirectory(root, 'maintenance'), maintenance.path);

    if (_artifactLiveLeases(_artifactLeaseDirectory(root, 'publication')).length > 0) {
      return false;
    }

    _artifactCleanupAttemptResidue(root);
    _artifactCleanupSelectorTemps(root);

    const selected = _artifactReadCurrent(root);
    for (const candidate of _artifactCandidateNames(root)) {
      if (candidate === selected) continue;
      _artifactReclaimCandidate(root, candidate);
    }
    return true;
  } catch (error) {
    return false;
  } finally {
    _artifactLeaseRelease(maintenance);
  }
}

function _artifactPublicationSelect(root, candidate, operationName, fingerprint) {
  let publication = null;
  try {
    publication = _artifactLeaseAcquire(
      _artifactLeaseDirectory(root, 'publication'),
      _artifactAttemptToken()
    );

    if (_artifactLiveLeases(_artifactLeaseDirectory(root, 'maintenance')).length > 0) {
      return false;
    }

    const candidatePath = _artifactCandidatePath(root, candidate);
    const manifest = _artifactManifestRead(candidatePath);
    if (manifest === null || manifest.operation !== operationName ||
        manifest.fingerprint !== fingerprint ||
        !_artifactStoreVerified(candidatePath, operationName, fingerprint, manifest.outputs)) {
      return false;
    }

    if (_artifactLiveLeases(_artifactLeaseDirectory(root, 'maintenance')).length > 0) {
      return false;
    }

    return _artifactSelect(root, candidate);
  } catch (error) {
    return false;
  } finally {
    _artifactLeaseRelease(publication);
  }
}

function _artifactCurrentPath(root) {
  return path.join(root, 'current');
}

function _artifactCandidateNameValid(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}(?:-[a-z0-9-]+)?$/.test(value);
}

function _artifactCandidatePath(root, candidate) {
  return path.join(root, 'candidates', candidate);
}

function _artifactReadCurrent(root) {
  try {
    const current = _artifactCurrentPath(root);
    const stat = fs.lstatSync(current);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const candidate = fs.readFileSync(current, 'utf8').trim();
    if (!_artifactCandidateNameValid(candidate)) return null;
    return candidate;
  } catch (error) {
    return null;
  }
}

function _artifactSelected(root, operationName, fingerprint) {
  const candidate = _artifactReadCurrent(root);
  if (candidate === null) return null;
  const candidatePath = _artifactCandidatePath(root, candidate);
  const manifest = _artifactManifestRead(candidatePath);
  if (manifest === null || manifest.operation !== operationName ||
      manifest.fingerprint !== fingerprint ||
      !_artifactStoreVerified(candidatePath, operationName, fingerprint, manifest.outputs)) {
    return null;
  }
  return {candidate, path: candidatePath, manifest};
}

function _artifactSelect(root, candidate) {
  const current = _artifactCurrentPath(root);
  const temporary = path.join(root, '.current-' + _artifactAttemptToken());
  try {
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    fs.writeFileSync(temporary, candidate + '\n', {mode: 0o600});
    fs.renameSync(temporary, current);
    return true;
  } catch (error) {
    return false;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {}
  }
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
  const root = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (root === null) return false;

  _artifactMaintain(root);

  const token = _artifactAttemptToken();
  const candidates = path.join(root, 'candidates');
  let staging = path.join(root, '.staging-' + token);
  let attemptLease = null;

  try {
    fs.mkdirSync(candidates, {recursive: true, mode: 0o700});
    attemptLease = _artifactLeaseAcquire(_artifactLeaseDirectory(root, 'attempt'), token);
    fs.rmSync(staging, {recursive: true, force: true});
    fs.mkdirSync(path.join(staging, 'payload'), {recursive: true, mode: 0o700});

    for (const name of Object.keys(operation.outputs).sort(_byteCompare)) {
      const declared = operation.outputs[name].path;
      const source = path.isAbsolute(declared) ? declared : path.resolve(projectRoot, declared);
      _copyArtifactPath(source, _artifactPayloadPath(staging, name));
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

    const baseCandidate = _sha256({
      schema: 1,
      operation: operationName,
      fingerprint,
      outputs
    });
    const basePath = _artifactCandidatePath(root, baseCandidate);
    let chosen = null;

    try {
      fs.renameSync(staging, basePath);
      staging = null;
      chosen = baseCandidate;
    } catch (error) {
      if (_artifactStoreVerified(basePath, operationName, fingerprint, outputs)) {
        chosen = baseCandidate;
      } else {
        const selected = _artifactSelected(root, operationName, fingerprint);
        if (selected !== null) {
          chosen = selected.candidate;
        } else {
          const recovery = baseCandidate + '-' + token;
          const recoveryPath = _artifactCandidatePath(root, recovery);
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

    _artifactLeaseRelease(attemptLease);
    attemptLease = null;

    const selected = _artifactPublicationSelect(root, chosen, operationName, fingerprint);
    if (selected) _artifactMaintain(root);
    return selected;
  } catch (error) {
    if (staging !== null) {
      try { fs.rmSync(staging, {recursive: true, force: true}); } catch (cleanupError) {}
    }
    _artifactLeaseRelease(attemptLease);
    return false;
  }
}

function _restoreArtifacts(projectRoot, operationName, fingerprint, operation) {
  const root = _artifactStorePath(projectRoot, operationName, fingerprint);
  if (root === null) return false;

  _artifactMaintain(root);

  const selected = _artifactSelected(root, operationName, fingerprint);
  if (selected === null) return false;

  const manifest = selected.manifest;
  const outputNames = Object.keys(operation.outputs).sort(_byteCompare);
  if (_stableJson(outputNames) !== _stableJson(Object.keys(manifest.outputs).sort(_byteCompare))) {
    return false;
  }

  const staged = [];
  const token = _artifactAttemptToken();
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
    const record = _readFreshnessRecord(projectRoot, operationName);
    return record !== null && record.fingerprint === fingerprint &&
      _stableJson(record.outputs) === _stableJson(manifest.outputs);
  } catch (error) {
    for (const entry of staged) {
      try { fs.rmSync(entry.temporary, {recursive: true, force: true}); } catch (cleanupError) {}
    }
    return false;
  }
}

function _outputSnapshots(projectRoot, operation) {
  const outputs = {};
  let cacheable = true;
  let complete = true;
  for (const name of Object.keys(operation.outputs).sort(_byteCompare)) {
    const snapshot = _snapshotPath(projectRoot, operation.outputs[name].path);
    if (!snapshot.cacheable) cacheable = false;
    if (snapshot.snapshot === null || snapshot.snapshot.exists !== true) complete = false;
    outputs[name] = snapshot.snapshot;
  }
  return {outputs, cacheable, complete};
}

function _dependencyChain() {
  const raw = process.env.m_MK_DEPENDENCY_CHAIN;
  if (raw === undefined) return [];
  let value;
  try { value = JSON.parse(raw); }
  catch (error) { _error('invalid internal project dependency chain'); }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    _error('invalid internal project dependency chain');
  }
  return value;
}

function _activeDependencies(projectRoot, model, requestedGoals) {
  const active = [];
  for (const name of Object.keys(model.dependencies).sort(_byteCompare)) {
    const definition = model.dependencies[name];
    const goals = [];
    const seen = new Set();
    for (const parentGoal of requestedGoals) {
      const mapped = definition.goals[parentGoal];
      if (mapped === undefined) continue;
      for (const childGoal of mapped) {
        if (!seen.has(childGoal)) {
          seen.add(childGoal);
          goals.push(childGoal);
        }
      }
    }
    if (goals.length === 0) continue;
    let childRoot;
    try {
      const selected = path.isAbsolute(definition.project) ? definition.project : path.resolve(projectRoot, definition.project);
      childRoot = fs.realpathSync(selected);
      if (!fs.statSync(childRoot).isDirectory()) _error(`dependency ${name}: project path is not a directory: ${definition.project}`);
      if (!fs.statSync(path.join(childRoot, 'mk.json')).isFile()) _error(`dependency ${name}: project configuration not found: ${childRoot}`);
    } catch (error) {
      if (error.mkStatus !== undefined) throw error;
      _error(`dependency ${name}: invalid project: ${definition.project}`);
    }
    active.push({name, project: childRoot, goals, profile: definition.profile});
  }
  return active;
}

function _invokeDependency(dependency, chain, planMode) {
  const code = 'const mk=require(process.argv[1]); process.exit(mk.mkMain(process.argv.slice(2)));';
  const args = ['-e', code, '--', __filename, '--project', dependency.project];
  if (dependency.profile !== null) args.push('--profile', dependency.profile);
  if (planMode) args.push('--plan');
  args.push(...dependency.goals);
  const environment = _callerEnvironment();
  environment.m_MK_DEPENDENCY_CHAIN = JSON.stringify(chain);
  const result = childProcess.spawnSync(process.execPath, args, {
    env: environment,
    encoding: 'utf8',
    stdio: planMode ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) _error(`dependency ${dependency.name}: cannot invoke child mk: ${result.error.message}`);
  if (result.signal !== null) _error(`dependency ${dependency.name}: child mk terminated by signal ${result.signal}`);
  if (result.status !== 0) {
    if (planMode && result.stderr) process.stderr.write(result.stderr);
    _error(`dependency ${dependency.name}: child mk failed with status ${result.status}`);
  }
  if (!planMode) return null;
  const output = result.stdout.trim();
  if (output.length === 0) return {version: 1, operations: []};
  try {
    const parsed = JSON.parse(output);
    if (_isObject(parsed) && parsed.version === 2) return parsed;
  } catch (error) {
    // Version 1 plans are line-oriented rather than JSON.
  }
  return {version: 1, operations: result.stdout.split('\n').filter(line => line.length > 0)};
}

function _planDependencies(projectRoot, model, requestedGoals, chain) {
  return _activeDependencies(projectRoot, model, requestedGoals).map(dependency => ({
    name: dependency.name,
    project: dependency.project,
    goals: dependency.goals.slice(),
    profile: dependency.profile,
    plan: _invokeDependency(dependency, chain, true)
  }));
}

function _executeDependencies(projectRoot, model, requestedGoals, chain) {
  for (const dependency of _activeDependencies(projectRoot, model, requestedGoals)) {
    _invokeDependency(dependency, chain, false);
  }
}

function _resolveFacilityRequirement(name, requirement) {
  const mRoot = process.env.m_ROOT;
  if (typeof mRoot !== 'string' || mRoot.length === 0) _error(`requirement ${name}: m_ROOT is unavailable`);
  const bootstrap = path.join(mRoot, 'm');
  const pkg = path.join(mRoot, 'bin', 'sys', 'pkg');
  const result = childProcess.spawnSync(bootstrap, [pkg, 'requirement', 'resolve', requirement.facility, ...requirement.constraints], {
    env: _callerEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) _error(`requirement ${name}: cannot query pkg: ${result.error.message}`);
  if (result.signal !== null) _error(`requirement ${name}: pkg query terminated by signal ${result.signal}`);
  if (result.status === 1) return {state: 'unsatisfied', provider: null};
  if (result.status === 2) _error(`requirement ${name}: invalid facility requirement`);
  if (result.status !== 0) _error(`requirement ${name}: pkg query failed with status ${result.status}`);
  const provider = result.stdout.trim();
  if (provider.length === 0 || provider.includes('\n')) _error(`requirement ${name}: pkg query returned invalid provider identity`);
  return {state: 'satisfied', provider};
}

function _applyEnvironment(target, overlay) {
  for (const key of Object.keys(overlay)) target[key] = overlay[key];
}

function _executeAction(projectRoot, baseEnvironment, operationName, action) {
  if (action === null) return {status: 0, ok: true, signal: null, error: null};
  let cwd = projectRoot;
  if (action.cwd !== undefined) cwd = path.isAbsolute(action.cwd) ? action.cwd : path.resolve(projectRoot, action.cwd);
  try { if (!fs.statSync(cwd).isDirectory()) _error(`operation ${operationName}: cwd is not a directory: ${cwd}`); }
  catch (error) { if (error.mkStatus !== undefined) throw error; _error(`operation ${operationName}: invalid cwd: ${cwd}`); }
  const environment = Object.assign({}, baseEnvironment); _applyEnvironment(environment, action.env);
  const result = childProcess.spawnSync(action.command, action.args, {cwd, env: environment, stdio: 'inherit', shell: false});
  if (result.error) return {status: null, ok: false, signal: null, error: result.error.message};
  if (result.signal !== null) return {status: null, ok: false, signal: result.signal, error: null};
  return {status: result.status, ok: result.status === 0, signal: null, error: null};
}

function _executeV1(projectRoot, model, plan) {
  const baseEnvironment = _callerEnvironment(); _applyEnvironment(baseEnvironment, model.environment);
  for (const operationName of plan) {
    const result = _executeAction(projectRoot, baseEnvironment, operationName, model.operations[operationName].action);
    if (result.error !== null) _error(`operation ${operationName}: cannot execute: ${result.error}`);
    if (result.signal !== null) _error(`operation ${operationName}: terminated by signal ${result.signal}`);
    if (!result.ok) _error(`operation ${operationName}: action failed with status ${result.status}`);
  }
}

function _portableRelative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function _byteCompare(left, right) {
  return Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8'));
}

function _newV2Runtime() {
  return {
    results: {},
    skipped: new Set(),
    collectionState: {},
    providerMembers: {},
    providerState: {},
    upToDate: new Set(),
    inputReady: new Set(),
    operationInputSnapshots: {},
    incrementalReady: new Set(),
    incrementalFingerprints: {},
    resultRequired: new Set()
  };
}

function _terminal(runtime, name) {
  const result = runtime.results[name];
  return result !== undefined || runtime.skipped.has(name) || runtime.upToDate.has(name);
}

function _satisfied(runtime, name) {
  if (runtime.providerMembers[name] !== undefined) {
    return runtime.providerState[name] === 'completed';
  }
  const result = runtime.results[name];
  return runtime.skipped.has(name) || runtime.upToDate.has(name) || (result !== undefined && result.ok);
}

function _completedSuccessfully(runtime, name) {
  if (runtime.providerMembers[name] !== undefined) {
    return runtime.providerState[name] === 'completed';
  }
  const result = runtime.results[name];
  return runtime.upToDate.has(name) || (result !== undefined && result.ok);
}

function _scanFiles(projectRoot, definition) {
  const root = path.isAbsolute(definition.root) ? definition.root : path.resolve(projectRoot, definition.root);
  let stat;
  try { stat = fs.statSync(root); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; }
  if (!stat.isDirectory()) _error(`collection root is not a directory: ${definition.root}`);
  const files = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => _byteCompare(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const below = _portableRelative(root, absolute);
        if (definition.suffixes.length > 0 && !definition.suffixes.some(suffix => below.endsWith(suffix))) continue;
        if (definition.include.length > 0 && !definition.include.includes(below)) continue;
        if (definition.exclude.includes(below)) continue;
        files.push(_portableRelative(projectRoot, absolute));
      }
    }
  }
  visit(root);
  return files.sort(_byteCompare);
}

function _substituteItem(value, item) {
  return value.replaceAll('${item}', item);
}

function _deriveProviderOperation(providerName, provider, item) {
  const token = Buffer.from(item, 'utf8').toString('hex');
  const substituteAction = {
    type: 'process',
    command: _substituteItem(provider.action.command, item),
    args: provider.action.args.map(value => _substituteItem(value, item)),
    cwd: provider.action.cwd === undefined ? undefined : _substituteItem(provider.action.cwd, item),
    env: Object.fromEntries(Object.entries(provider.action.env).map(([key, value]) => [key, _substituteItem(value, item)]))
  };
  const inputs = {'$item': {type: 'path', path: item}};
  for (const [name, input] of Object.entries(provider.inputs)) {
    if (input.type === 'path') inputs[name] = {type: 'path', path: _substituteItem(input.path, item)};
    else if (input.type === 'collection') inputs[name] = {type: 'collection', collection: input.collection};
    else inputs[name] = {type: 'output', operation: input.operation, name: input.name};
  }
  const outputs = Object.fromEntries(
    Object.entries(provider.outputs).map(([name, output]) => [name, {path: _substituteItem(output.path, item)}])
  );
  return {
    name: `${providerName}-${token}`,
    definition: {
      prerequisites: provider.prerequisites.slice(),
      requirements: provider.requirements.slice(),
      action: substituteAction,
      when: null,
      inputs,
      outputs,
      failure: 'stop',
      incremental: provider.incremental === null ? null : {inputs}
    },
    derived: {provider: providerName, item}
  };
}

function _readPathProperty(projectRoot, pathname, property) {
  const absolute = path.isAbsolute(pathname) ? pathname : path.resolve(projectRoot, pathname);
  try {
    const stat = fs.statSync(absolute);
    if (property === 'exists') return {known: true, value: true};
    if (property === 'size') return {known: true, value: stat.size};
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      if (property === 'exists') return {known: true, value: false};
      if (property === 'size') return {known: false};
    }
    throw error;
  }
  return {known: false};
}

function _evaluateOperand(projectRoot, model, runtime, operand) {
  if (operand.type === 'literal') return {known: true, value: operand.value};
  if (operand.type === 'state') return _readPathProperty(projectRoot, operand.path, operand.property);
  if (operand.type === 'result') {
    const result = runtime.results[operand.operation];
    if (result === undefined) return {known: false};
    return {known: true, value: result[operand.field]};
  }
  if (operand.type === 'output') {
    const result = runtime.results[operand.operation];
    if (result === undefined) {
      if (runtime.upToDate.has(operand.operation)) {
        const output = model.operations[operand.operation].outputs[operand.name];
        return _readPathProperty(projectRoot, output.path, operand.property);
      }
      if (runtime.skipped.has(operand.operation) && operand.property === 'exists') return {known: true, value: false};
      return {known: false};
    }
    if (!result.ok) {
      return operand.property === 'exists' ? {known: true, value: false} : {known: false};
    }
    const output = model.operations[operand.operation].outputs[operand.name];
    return _readPathProperty(projectRoot, output.path, operand.property);
  }
  return {known: false};
}

function _evaluateCondition(projectRoot, model, runtime, condition) {
  if (condition === null) return {known: true, value: true};
  if (condition.op === 'not') {
    const nested = _evaluateCondition(projectRoot, model, runtime, condition.condition);
    return nested.known ? {known: true, value: !nested.value} : {known: false};
  }
  if (condition.op === 'truthy') {
    const operand = _evaluateOperand(projectRoot, model, runtime, condition.value);
    return operand.known ? {known: true, value: Boolean(operand.value)} : {known: false};
  }
  const left = _evaluateOperand(projectRoot, model, runtime, condition.left);
  const right = _evaluateOperand(projectRoot, model, runtime, condition.right);
  if (!left.known || !right.known) return {known: false};
  let value;
  if (condition.op === 'eq') value = left.value === right.value;
  else if (condition.op === 'ne') value = left.value !== right.value;
  else if (condition.op === 'lt') value = left.value < right.value;
  else if (condition.op === 'lte') value = left.value <= right.value;
  else if (condition.op === 'gt') value = left.value > right.value;
  else value = left.value >= right.value;
  return {known: true, value};
}

function _resolveV2(projectRoot, model, requestedGoals, runtime) {
  runtime.upToDate = new Set();
  runtime.inputReady = new Set();
  runtime.operationInputSnapshots = {};
  runtime.incrementalReady = new Set();
  runtime.incrementalFingerprints = {};
  runtime.resultRequired = new Set();

  const operations = Object.assign({}, model.operations);
  const derived = {};
  const reachableCollections = new Set();
  const reachableProviders = new Set();
  const reachableOperations = new Set();
  const reachableRequirements = new Set();
  const requirementState = {};
  const resolvingCollections = new Set();
  const resolvingProviders = new Set();
  const resolvingOperations = new Set();

  function collectResultRequirements() {
    const seenOperations = new Set();
    const seenProviders = new Set();
    const seenCollections = new Set();

    function collectReference(name) {
      if (model.providers[name] !== undefined) collectProvider(name);
      else if (model.operations[name] !== undefined) collectOperation(name);
    }

    function collectCollection(name) {
      if (seenCollections.has(name)) return;
      seenCollections.add(name);
      const collection = model.collections[name];
      if (collection === undefined) return;
      for (const after of collection.after) collectReference(after);
    }

    function collectProvider(name) {
      if (seenProviders.has(name)) return;
      seenProviders.add(name);
      const provider = model.providers[name];
      if (provider === undefined) return;
      for (const prerequisite of provider.prerequisites) collectReference(prerequisite);
      collectCollection(provider.collection);
    }

    function collectOperation(name) {
      if (seenOperations.has(name)) return;
      seenOperations.add(name);
      const operation = model.operations[name];
      if (operation === undefined) return;
      _conditionResultReferences(operation.when, runtime.resultRequired);
      const observed = new Set();
      _conditionOperationReferences(operation.when, observed);
      for (const dependency of observed) collectOperation(dependency);
      for (const prerequisite of operation.prerequisites) collectReference(prerequisite);
      for (const input of Object.values(operation.inputs)) {
        if (input.type === 'collection') collectCollection(input.collection);
        else if (input.type === 'output') collectOperation(input.operation);
      }
    }

    for (const goalName of requestedGoals) {
      const roots = model.goals[goalName];
      if (roots === undefined) continue;
      for (const root of roots) collectReference(root);
    }
  }

  collectResultRequirements();

  function requirementStatus(name) {
    reachableRequirements.add(name);
    if (requirementState[name] === undefined) {
      requirementState[name] = _resolveFacilityRequirement(name, model.requirements[name]);
    }
    return requirementState[name];
  }

  function requirementsSatisfied(names) {
    return names.every(name => requirementStatus(name).state === 'satisfied');
  }

  function visitReference(name) {
    if (model.providers[name] !== undefined) visitProvider(name);
    else if (operations[name] !== undefined) visitOperation(name);
    else _error(`unknown operation/provider: ${name}`);
  }

  function visitCollection(name) {
    if (reachableCollections.has(name)) return;
    if (resolvingCollections.has(name)) _error(`collection dependency cycle involving: ${name}`);
    resolvingCollections.add(name);
    const collection = model.collections[name];
    for (const after of collection.after) visitReference(after);
    if (collection.after.every(after => _completedSuccessfully(runtime, after))) {
      runtime.collectionState[name] = {state: 'resolved', items: _scanFiles(projectRoot, collection)};
    } else {
      runtime.collectionState[name] = {state: 'pending', waitingFor: collection.after.filter(after => !_completedSuccessfully(runtime, after))};
    }
    resolvingCollections.delete(name);
    reachableCollections.add(name);
  }

  function visitProvider(name) {
    if (reachableProviders.has(name)) return;
    if (resolvingProviders.has(name)) _error(`provider dependency cycle involving: ${name}`);
    resolvingProviders.add(name);
    const provider = model.providers[name];
    for (const requirement of provider.requirements) requirementStatus(requirement);
    for (const prerequisite of provider.prerequisites) visitReference(prerequisite);
    visitCollection(provider.collection);
    const collectionState = runtime.collectionState[provider.collection];
    if (collectionState.state !== 'resolved') {
      runtime.providerMembers[name] = [];
      runtime.providerState[name] = 'pending';
      resolvingProviders.delete(name);
      reachableProviders.add(name);
      return;
    }
    const members = [];
    for (const item of collectionState.items) {
      const operation = _deriveProviderOperation(name, provider, item);
      if (operations[operation.name] !== undefined) _error(`derived operation collision: ${operation.name}`);
      operations[operation.name] = operation.definition;
      derived[operation.name] = operation.derived;
      members.push(operation.name);
    }
    runtime.providerMembers[name] = members;
    for (const member of members) visitOperation(member);
    runtime.providerState[name] = provider.prerequisites.every(prerequisite => _satisfied(runtime, prerequisite)) &&
      requirementsSatisfied(provider.requirements) &&
      members.every(member => _satisfied(runtime, member)) ? 'completed' : 'resolved';
    resolvingProviders.delete(name);
    reachableProviders.add(name);
  }

  function visitConditionDependencies(condition) {
    const refs = new Set();
    _conditionOperationReferences(condition, refs);
    for (const name of refs) visitOperation(name);
  }

  function visitInputDependencies(operation) {
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
      if (input.type === 'path') {
        const snapshot = _snapshotPath(projectRoot, input.path);
        if (!snapshot.cacheable) cacheable = false;
        inputs[inputName] = {type: 'path', snapshot: snapshot.snapshot};
        continue;
      }
      if (input.type === 'collection') {
        const state = runtime.collectionState[input.collection];
        if (state === undefined || state.state !== 'resolved') {
          return {ready: false, cacheable: false, inputs: null};
        }
        const members = [];
        for (const item of state.items) {
          const snapshot = _snapshotPath(projectRoot, item);
          if (!snapshot.cacheable) cacheable = false;
          members.push(snapshot.snapshot);
        }
        inputs[inputName] = {type: 'collection', collection: input.collection, members};
        continue;
      }
      if (!_completedSuccessfully(runtime, input.operation)) {
        return {ready: false, cacheable: false, inputs: null};
      }
      const producer = operations[input.operation];
      const output = producer.outputs[input.name];
      const snapshot = _snapshotPath(projectRoot, output.path);
      if (!snapshot.cacheable || snapshot.snapshot === null || snapshot.snapshot.exists !== true) {
        cacheable = false;
      }
      inputs[inputName] = {
        type: 'output',
        operation: input.operation,
        name: input.name,
        snapshot: snapshot.snapshot
      };
    }
    const resolved = {ready: true, cacheable, inputs};
    runtime.operationInputSnapshots[name] = inputs;
    runtime.inputReady.add(name);
    return resolved;
  }

  function assessIncremental(name, operation) {
    if (operation.incremental === null) return;
    const resolvedInputs = operationInputs(name, operation);
    if (!resolvedInputs.ready) return;
    runtime.incrementalReady.add(name);

    if (!resolvedInputs.cacheable) return;

    const executable = _resolveExecutableIdentity(projectRoot, model, operation.action);
    if (!executable.cacheable) return;

    const requirements = {};
    for (const requirementName of operation.requirements.slice().sort(_byteCompare)) {
      const state = requirementStatus(requirementName);
      if (state.state !== 'satisfied' || state.provider === null) return;
      requirements[requirementName] = {
        facility: model.requirements[requirementName].facility,
        constraints: model.requirements[requirementName].constraints.slice(),
        provider: state.provider
      };
    }

    const fingerprint = _sha256({
      schema: 1,
      operation: name,
      definition: operation,
      environment: executable.environment,
      executable: executable.identity,
      requirements,
      inputs: resolvedInputs.inputs
    });
    runtime.incrementalFingerprints[name] = fingerprint;

    if (runtime.resultRequired.has(name)) return;

    const outputs = _outputSnapshots(projectRoot, operation);
    if (!outputs.cacheable || !outputs.complete) return;
    const record = _readFreshnessRecord(projectRoot, name);
    if (record === null || record.fingerprint !== fingerprint) return;
    if (_stableJson(record.outputs) !== _stableJson(outputs.outputs)) return;
    runtime.upToDate.add(name);
  }

  function visitOperation(name) {
    if (reachableOperations.has(name)) return;
    if (resolvingOperations.has(name)) _error(`operation dependency cycle involving: ${name}`);
    resolvingOperations.add(name);
    const operation = operations[name];
    if (operation === undefined) _error(`unknown operation: ${name}`);
    for (const requirement of operation.requirements) requirementStatus(requirement);
    visitConditionDependencies(operation.when);
    const condition = _evaluateCondition(projectRoot, model, runtime, operation.when);
    if (condition.known && condition.value) {
      for (const prerequisite of operation.prerequisites) visitReference(prerequisite);
      visitInputDependencies(operation);
      if (runtime.results[name] === undefined &&
          !runtime.skipped.has(name) &&
          operation.prerequisites.every(ref => _satisfied(runtime, ref)) &&
          requirementsSatisfied(operation.requirements)) {
        if (operation.incremental !== null) {
          assessIncremental(name, operation);
        } else {
          operationInputs(name, operation);
        }
      }
    }
    resolvingOperations.delete(name);
    reachableOperations.add(name);
  }

  for (const goalName of requestedGoals) {
    const roots = model.goals[goalName];
    if (roots === undefined) _error(`unknown goal: ${goalName}`);
    for (const root of roots) visitReference(root);
  }

  const operationEntries = [];
  for (const name of Array.from(reachableOperations).sort(_byteCompare)) {
    const operation = operations[name];
    const observes = new Set();
    _conditionOperationReferences(operation.when, observes);
    const condition = _evaluateCondition(projectRoot, model, runtime, operation.when);
    let state;
    if (runtime.skipped.has(name)) state = 'skipped';
    else if (runtime.results[name] !== undefined) state = runtime.results[name].ok ? 'completed' : 'failed';
    else if (runtime.upToDate.has(name)) state = 'up-to-date';
    else if (!condition.known) state = 'conditional';
    else if (!condition.value) state = 'skipped';
    else if (!operation.prerequisites.every(ref => _satisfied(runtime, ref))) state = 'blocked';
    else if (!requirementsSatisfied(operation.requirements)) state = 'blocked';
    else if (Object.keys(operation.inputs).length > 0 && !runtime.inputReady.has(name)) state = 'blocked';
    else if (operation.incremental !== null && !runtime.incrementalReady.has(name)) state = 'blocked';
    else state = 'ready';
    operationEntries.push({
      name,
      state,
      prerequisites: operation.prerequisites.slice(),
      inputs: Object.fromEntries(Object.entries(operation.inputs).map(([inputName, input]) => [inputName, Object.assign({}, input)])),
      requirements: operation.requirements.slice(),
      unsatisfiedRequirements: operation.requirements.filter(req => requirementStatus(req).state !== 'satisfied'),
      observes: Array.from(observes).sort(_byteCompare),
      when: operation.when === null ? null : {
        state: condition.known ? (condition.value ? 'true' : 'false') : 'unknown',
        condition: operation.when
      },
      derived: derived[name] || null
    });
    if (state === 'skipped') runtime.skipped.add(name);
  }

  for (const name of reachableProviders) {
    const members = runtime.providerMembers[name] || [];
    const provider = model.providers[name];
    if (runtime.providerState[name] !== 'pending' &&
        provider.prerequisites.every(prerequisite => _satisfied(runtime, prerequisite)) &&
        requirementsSatisfied(provider.requirements) &&
        members.every(member => _satisfied(runtime, member))) runtime.providerState[name] = 'completed';
  }

  const collections = Array.from(reachableCollections).sort(_byteCompare).map(name => {
    const state = runtime.collectionState[name];
    return state.state === 'resolved'
      ? {name, state: 'resolved', items: state.items.slice()}
      : {name, state: 'pending', waitingFor: state.waitingFor.slice()};
  });
  const providers = Array.from(reachableProviders).sort(_byteCompare).map(name => ({
    name,
    state: runtime.providerState[name],
    collection: model.providers[name].collection,
    requirements: model.providers[name].requirements.slice(),
    unsatisfiedRequirements: model.providers[name].requirements.filter(req => requirementStatus(req).state !== 'satisfied'),
    operations: (runtime.providerMembers[name] || []).slice()
  }));
  const requirements = Array.from(reachableRequirements).sort(_byteCompare).map(name => ({
    name,
    type: model.requirements[name].type,
    facility: model.requirements[name].facility,
    constraints: model.requirements[name].constraints.slice(),
    state: requirementStatus(name).state,
    provider: requirementStatus(name).provider
  }));
  return {version: 2, goals: requestedGoals.slice(), requirements, collections, providers, operations: operationEntries, _operations: operations};
}

function _goalsComplete(model, requestedGoals, runtime) {
  return requestedGoals.every(goal => model.goals[goal].every(root => {
    if (model.providers[root] !== undefined) return runtime.providerState[root] === 'completed';
    return _terminal(runtime, root);
  }));
}

function _executeV2(projectRoot, model, requestedGoals) {
  const runtime = _newV2Runtime();
  const baseEnvironment = _callerEnvironment();
  _applyEnvironment(baseEnvironment, model.environment);
  while (true) {
    const plan = _resolveV2(projectRoot, model, requestedGoals, runtime);
    if (_goalsComplete(model, requestedGoals, runtime)) return;
    const ready = plan.operations.find(entry => entry.state === 'ready');
    if (ready === undefined) {
      const blocked = new Set();
      for (const entry of plan.operations) {
        if (entry.state === 'blocked' && entry.unsatisfiedRequirements.length > 0 &&
            entry.prerequisites.every(ref => _satisfied(runtime, ref))) {
          for (const name of entry.unsatisfiedRequirements) blocked.add(name);
        }
      }
      for (const provider of plan.providers) {
        const definition = model.providers[provider.name];
        const collection = runtime.collectionState[definition.collection];
        if (provider.state !== 'completed' && provider.unsatisfiedRequirements.length > 0 &&
            collection !== undefined && collection.state === 'resolved' &&
            definition.prerequisites.every(ref => _satisfied(runtime, ref))) {
          for (const name of provider.unsatisfiedRequirements) blocked.add(name);
        }
      }
      if (blocked.size > 0) _error(`unsatisfied requirement: ${Array.from(blocked).sort(_byteCompare).join(', ')}`);
      _error('execution cannot make progress; unresolved conditional/provider dependencies remain');
    }
    const operation = plan._operations[ready.name];
    const fingerprint = runtime.incrementalFingerprints[ready.name];
    if (operation.incremental !== null) {
      if (typeof fingerprint === 'string' && !runtime.resultRequired.has(ready.name) &&
          _restoreArtifacts(projectRoot, ready.name, fingerprint, operation)) {
        continue;
      }
      _deleteFreshnessRecord(projectRoot, ready.name);
    }
    const result = _executeAction(projectRoot, baseEnvironment, ready.name, operation.action);
    runtime.results[ready.name] = result;
    if (result.ok && operation.incremental !== null && typeof fingerprint === 'string') {
      const outputs = _outputSnapshots(projectRoot, operation);
      if (outputs.cacheable && outputs.complete) {
        _storeArtifacts(projectRoot, ready.name, fingerprint, operation, outputs.outputs);
        _writeFreshnessRecord(projectRoot, ready.name, fingerprint, outputs.outputs);
      }
    }
    if (!result.ok && operation.failure !== 'continue') {
      if (result.error !== null) _error(`operation ${ready.name}: cannot execute: ${result.error}`);
      if (result.signal !== null) _error(`operation ${ready.name}: terminated by signal ${result.signal}`);
      _error(`operation ${ready.name}: action failed with status ${result.status}`);
    }
  }
}

function _publicPlan(plan, dependencies = []) {
  return {
    version: plan.version,
    goals: plan.goals.slice(),
    dependencies,
    requirements: plan.requirements,
    collections: plan.collections,
    providers: plan.providers,
    operations: plan.operations
  };
}

function _watchTemporary(message) {
  const error = new Error(message);
  error.mkWatchTemporary = true;
  throw error;
}

function _watchSortedObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).sort(([left], [right]) => _byteCompare(left, right))
  );
}

function _watchSnapshotInput(projectRoot, runtime, operations, input) {
  if (input.type === 'path') {
    return {type: 'path', evidence: _snapshotPath(projectRoot, input.path)};
  }
  if (input.type === 'collection') {
    const state = runtime.collectionState[input.collection];
    if (state === undefined || state.state !== 'resolved') {
      return {type: 'collection', collection: input.collection, state: 'pending'};
    }
    return {
      type: 'collection',
      collection: input.collection,
      state: 'resolved',
      members: state.items.map(item => _snapshotPath(projectRoot, item))
    };
  }
  const producer = operations[input.operation];
  if (producer === undefined || producer.outputs[input.name] === undefined) {
    _watchTemporary(`output input unavailable: ${input.operation}.${input.name}`);
  }
  return {
    type: 'output',
    operation: input.operation,
    name: input.name,
    evidence: _snapshotPath(projectRoot, producer.outputs[input.name].path)
  };
}

function _watchLocalDigest(projectRoot, model, requestedGoals) {
  let runtime;
  let plan;
  try {
    runtime = _newV2Runtime();
    plan = _resolveV2(projectRoot, model, requestedGoals, runtime);
  } catch (error) {
    if (error.mkWatchTemporary) throw error;
    _watchTemporary(error && error.message ? error.message : 'lifecycle model unavailable');
  }

  const publicPlan = _publicPlan(plan, []);
  const operations = plan._operations;
  const actionEvidence = {};
  const inputEvidence = {};
  const incrementalOutputs = {};

  for (const entry of publicPlan.operations) {
    const operation = operations[entry.name];
    if (operation === undefined) _watchTemporary(`resolved operation unavailable: ${entry.name}`);
    if (entry.state === 'skipped') continue;

    if (operation.action !== null) {
      const executable = _resolveExecutableIdentity(projectRoot, model, operation.action);
      actionEvidence[entry.name] = {
        cacheable: executable.cacheable,
        identity: executable.identity,
        environment: executable.environment
      };
    }

    const inputs = {};
    for (const inputName of Object.keys(operation.inputs).sort(_byteCompare)) {
      inputs[inputName] = _watchSnapshotInput(projectRoot, runtime, operations, operation.inputs[inputName]);
    }
    if (Object.keys(inputs).length > 0) inputEvidence[entry.name] = inputs;

    if (operation.incremental !== null) {
      incrementalOutputs[entry.name] = _outputSnapshots(projectRoot, operation);
    }
  }

  const collectionEvidence = {};
  for (const collection of publicPlan.collections) {
    if (collection.state !== 'resolved') {
      collectionEvidence[collection.name] = {
        state: 'pending',
        waitingFor: collection.waitingFor.slice()
      };
    } else {
      collectionEvidence[collection.name] = {
        state: 'resolved',
        members: collection.items.map(item => _snapshotPath(projectRoot, item))
      };
    }
  }

  return _sha256({
    schema: 1,
    project: projectRoot,
    goals: requestedGoals.slice(),
    model,
    plan: publicPlan,
    collections: collectionEvidence,
    inputs: _watchSortedObject(inputEvidence),
    actions: _watchSortedObject(actionEvidence),
    incrementalOutputs: _watchSortedObject(incrementalOutputs),
    incrementalFingerprints: _watchSortedObject(runtime.incrementalFingerprints)
  });
}

function _watchTriggerDigest(projectRoot, profile, requestedGoals, chain) {
  if (chain.includes(projectRoot)) {
    _error(`project dependency cycle: ${chain.concat([projectRoot]).join(' -> ')}`);
  }

  let model;
  try {
    const config = _loadProjectConfig(path.join(projectRoot, 'mk.json'));
    model = _selectModel(config, profile);
    _validateReferences(model);
  } catch (error) {
    _watchTemporary(error && error.message ? error.message : 'project configuration unavailable');
  }

  if (model.version !== 2) _error('watch requires project configuration version 2');

  const local = _watchLocalDigest(projectRoot, model, requestedGoals);
  let active;
  try {
    active = _activeDependencies(projectRoot, model, requestedGoals);
  } catch (error) {
    _watchTemporary(error && error.message ? error.message : 'project dependency unavailable');
  }

  const dependencies = active.map(dependency => ({
    name: dependency.name,
    project: dependency.project,
    goals: dependency.goals.slice(),
    profile: dependency.profile,
    digest: _watchTriggerDigest(
      dependency.project,
      dependency.profile,
      dependency.goals,
      chain.concat([projectRoot])
    )
  }));

  return _sha256({schema: 1, local, dependencies});
}

function _watchTriggerMain(request) {
  try {
    if (request.watch || request.plan || request.listGoals || request.showGoal !== null) {
      _error('invalid internal watch trigger request', 2);
    }
    let project;
    try {
      project = _discoverProject(request.project);
    } catch (error) {
      _watchTemporary(error && error.message ? error.message : 'project unavailable');
    }
    const digest = _watchTriggerDigest(project.root, request.profile, request.goals, []);
    process.stdout.write(`${digest}\n`);
    return 0;
  } catch (error) {
    if (error && error.mkWatchTemporary) {
      process.stderr.write(`mk: watch configuration temporarily unavailable: ${error.message}\n`);
      return 10;
    }
    _writeError(error && error.message ? error.message : 'unexpected watch trigger failure');
    return error && Number.isInteger(error.mkStatus) ? error.mkStatus : 1;
  }
}

function _watchRequestArgs(projectRoot, request) {
  const args = ['--project', projectRoot];
  if (request.profile !== null) args.push('--profile', request.profile);
  args.push(...request.goals);
  return args;
}

function _watchPoll(projectRoot, request) {
  const mRoot = process.env.m_ROOT;
  if (typeof mRoot !== 'string' || mRoot.length === 0) _error('watch bootstrap root is unavailable');
  const environment = _callerEnvironment();
  environment.m_MK_WATCH_TRIGGER = '1';
  const result = childProcess.spawnSync(
    path.join(mRoot, 'm'),
    [path.join(__dirname, '..', '..', 'cmd', 'mk'), ..._watchRequestArgs(projectRoot, request)],
    {
      env: environment,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  if (result.error) _error(`watch trigger cannot start: ${result.error.message}`);
  if (result.signal !== null) _error(`watch trigger terminated by signal ${result.signal}`);
  if (result.status === 10) return {kind: 'temporary'};
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    _error(`watch trigger failed with status ${result.status}`);
  }
  const digest = result.stdout.trim();
  if (!/^[0-9a-f]{64}$/.test(digest)) _error('watch trigger returned invalid digest');
  return {kind: 'ok', digest};
}

function _watchDelay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function _watchRunLifecycle(projectRoot, request, signalState) {
  const mRoot = process.env.m_ROOT;
  const environment = _callerEnvironment();
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      path.join(mRoot, 'm'),
      [path.join(__dirname, '..', '..', 'cmd', 'mk'), ..._watchRequestArgs(projectRoot, request)],
      {env: environment, stdio: 'inherit'}
    );
    signalState.child = child;
    child.once('error', error => {
      signalState.child = null;
      reject(error);
    });
    child.once('exit', (status, signal) => {
      signalState.child = null;
      resolve({status, signal});
    });
  });
}

async function _watchSession(projectRoot, request) {
  const signalState = {requested: null, child: null};
  let temporaryReported = false;

  function requestSignal(signal) {
    if (signalState.requested !== null) return;
    signalState.requested = signal;
    if (signalState.child !== null) {
      try { signalState.child.kill(signal); } catch (error) { /* child may already have exited */ }
    }
  }

  function signalStatus() {
    return signalState.requested === 'SIGINT' ? 130 : 143;
  }

  function observe() {
    const state = _watchPoll(projectRoot, request);
    if (state.kind === 'temporary') {
      if (!temporaryReported) {
        process.stderr.write('mk: watch configuration temporarily unavailable; waiting\n');
        temporaryReported = true;
      }
      return state;
    }
    if (temporaryReported) {
      process.stderr.write('mk: watch configuration valid again\n');
      temporaryReported = false;
    }
    return state;
  }

  async function waitForValid() {
    while (true) {
      if (signalState.requested !== null) return null;
      const state = observe();
      if (state.kind === 'ok') return state.digest;
      await _watchDelay(100);
    }
  }

  async function cycle() {
    const result = await _watchRunLifecycle(projectRoot, request, signalState);
    if (signalState.requested !== null) return result;
    if (result.signal !== null) {
      process.stderr.write(`mk: watch lifecycle cycle terminated by signal ${result.signal}\n`);
    } else if (result.status !== 0) {
      process.stderr.write(`mk: watch lifecycle cycle failed with status ${result.status}\n`);
    }
    return result;
  }

  const onSigint = () => requestSignal('SIGINT');
  const onSigterm = () => requestSignal('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  try {
    let baseline = await waitForValid();
    if (baseline === null) return signalStatus();

    await cycle();
    if (signalState.requested !== null) return signalStatus();

    baseline = await waitForValid();
    if (baseline === null) return signalStatus();

    while (true) {
      await _watchDelay(100);
      if (signalState.requested !== null) return signalStatus();

      const current = observe();
      if (current.kind === 'temporary' || current.digest === baseline) continue;

      await cycle();
      if (signalState.requested !== null) return signalStatus();

      baseline = await waitForValid();
      if (baseline === null) return signalStatus();
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

function mkMain(argv) {
  try {
    if (!Array.isArray(argv)) _error('internal invocation requires an argument array', 2);
    const internalWatchTrigger = process.env.m_MK_WATCH_TRIGGER === '1';
    if (internalWatchTrigger) delete process.env.m_MK_WATCH_TRIGGER;
    const request = _parseCli(argv);
    if (internalWatchTrigger) return _watchTriggerMain(request);
    const project = _discoverProject(request.project);
    if (request.watch) {
      return _watchSession(project.root, request).catch(error => {
        _writeError(error && error.message ? error.message : 'unexpected failure');
        return error && Number.isInteger(error.mkStatus) ? error.mkStatus : 1;
      });
    }
    const chain = _dependencyChain();
    if (chain.includes(project.root)) {
      _error(`project dependency cycle: ${chain.concat([project.root]).join(' -> ')}`);
    }
    const childChain = chain.concat([project.root]);
    const config = _loadProjectConfig(project.configPath);
    const model = _selectModel(config, request.profile);
    _validateReferences(model);

    if (request.listGoals) {
      const names = Object.keys(model.goals).sort(_byteCompare);
      if (names.length > 0) process.stdout.write(`${names.join('\n')}\n`);
      return 0;
    }

    if (request.showGoal !== null) {
      const roots = model.goals[request.showGoal];
      if (roots === undefined) _error(`unknown goal: ${request.showGoal}`);
      if (model.version === 1) {
        const plan = _planV1(model, [request.showGoal]);
        process.stdout.write(`${JSON.stringify({goal: request.showGoal, roots, operations: plan}, null, 2)}\n`);
      } else {
        const runtime = _newV2Runtime();
        const dependencies = _planDependencies(project.root, model, [request.showGoal], childChain);
        const plan = _publicPlan(_resolveV2(project.root, model, [request.showGoal], runtime), dependencies);
        process.stdout.write(`${JSON.stringify({goal: request.showGoal, roots, plan}, null, 2)}\n`);
      }
      return 0;
    }

    if (model.version === 1) {
      const plan = _planV1(model, request.goals);
      if (request.plan) {
        if (plan.length > 0) process.stdout.write(`${plan.join('\n')}\n`);
        return 0;
      }
      _executeV1(project.root, model, plan);
      return 0;
    }

    if (request.plan) {
      const runtime = _newV2Runtime();
      const dependencies = _planDependencies(project.root, model, request.goals, childChain);
      const plan = _publicPlan(_resolveV2(project.root, model, request.goals, runtime), dependencies);
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return 0;
    }

    _executeDependencies(project.root, model, request.goals, childChain);
    _executeV2(project.root, model, request.goals);
    return 0;
  } catch (error) {
    _writeError(error && error.message ? error.message : 'unexpected failure');
    return error && Number.isInteger(error.mkStatus) ? error.mkStatus : 1;
  }
}

module.exports = {mkMain};
