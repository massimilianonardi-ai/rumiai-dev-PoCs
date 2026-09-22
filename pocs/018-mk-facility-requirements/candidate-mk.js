'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function fail(message, status = 1) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseArgs(argv) {
  const request = {project: '.', plan: false, goals: []};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      if (++i >= argv.length) fail('--project requires a value', 2);
      request.project = argv[i];
    } else if (arg === '--plan') request.plan = true;
    else if (arg.startsWith('-')) fail(`unsupported option: ${arg}`, 2);
    else request.goals.push(arg);
  }
  if (request.goals.length === 0) fail('at least one goal is required', 2);
  return request;
}

function readConfig(root) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'mk.json'), 'utf8'));
  if (!isObject(raw) || raw.version !== 2) fail('candidate requires version 2');
  for (const key of ['goals', 'operations', 'providers', 'requirements']) {
    if (raw[key] !== undefined && !isObject(raw[key])) fail(`${key} must be an object`);
  }
  return {
    goals: raw.goals || {},
    operations: raw.operations || {},
    providers: raw.providers || {},
    requirements: raw.requirements || {}
  };
}

function normalizeNameArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) fail(`${label} must be an array of names`);
  return value;
}

function normalizeRequirement(name, raw) {
  if (!isObject(raw)) fail(`requirement ${name} must be an object`);
  if (raw.type !== 'facility') fail(`requirement ${name}: unsupported type`);
  if (typeof raw.facility !== 'string' || raw.facility.length === 0) fail(`requirement ${name}: facility must be a non-empty string`);
  const constraints = normalizeNameArray(raw.constraints, `requirement ${name}: constraints`);
  if (constraints.length === 0) fail(`requirement ${name}: at least one constraint is required`);
  return {name, type: 'facility', facility: raw.facility, constraints};
}

function normalizeNode(name, raw, kind) {
  if (!isObject(raw)) fail(`${kind} ${name} must be an object`);
  return {
    name,
    kind,
    prerequisites: normalizeNameArray(raw.prerequisites, `${kind} ${name}: prerequisites`),
    requirements: normalizeNameArray(raw.requirements, `${kind} ${name}: requirements`),
    action: raw.action || null
  };
}

function queryRequirement(requirement) {
  const resolver = process.env.RUMIAI_MK_POC_REQUIREMENT_RESOLVER;
  if (!resolver) fail('requirement resolver is not configured');
  const result = childProcess.spawnSync(resolver, [requirement.facility, ...requirement.constraints], {encoding: 'utf8'});
  if (result.error) fail(`requirement ${requirement.name}: resolver failed: ${result.error.message}`);
  if (result.status === 0) {
    const provider = result.stdout.trim();
    if (!provider) fail(`requirement ${requirement.name}: resolver returned empty provider`);
    return {state: 'satisfied', provider};
  }
  if (result.status === 1) return {state: 'unsatisfied', provider: null};
  fail(`requirement ${requirement.name}: resolver error status ${result.status}`);
}

function resolve(root, config, goals, runtime) {
  const requirements = Object.fromEntries(Object.entries(config.requirements).map(([name, raw]) => [name, normalizeRequirement(name, raw)]));
  const operations = Object.fromEntries(Object.entries(config.operations).map(([name, raw]) => [name, normalizeNode(name, raw, 'operation')]));
  const providers = Object.fromEntries(Object.entries(config.providers).map(([name, raw]) => [name, normalizeNode(name, raw, 'provider')]));
  const reachableNodes = new Set();
  const reachableRequirements = new Set();
  const stack = [];

  function node(name) {
    return operations[name] || providers[name] || null;
  }

  function visit(name) {
    if (reachableNodes.has(name)) return;
    if (stack.includes(name)) fail(`lifecycle cycle: ${[...stack, name].join(' -> ')}`);
    const current = node(name);
    if (!current) fail(`unknown lifecycle node: ${name}`);
    stack.push(name);
    for (const prerequisite of current.prerequisites) visit(prerequisite);
    for (const requirementName of current.requirements) {
      if (!requirements[requirementName]) fail(`${current.kind} ${name}: unknown requirement ${requirementName}`);
      reachableRequirements.add(requirementName);
    }
    stack.pop();
    reachableNodes.add(name);
  }

  for (const goal of goals) {
    const roots = config.goals[goal];
    if (!Array.isArray(roots)) fail(`unknown goal: ${goal}`);
    for (const rootName of roots) visit(rootName);
  }

  const requirementState = {};
  for (const name of [...reachableRequirements].sort()) requirementState[name] = queryRequirement(requirements[name]);

  const nodeEntries = [];
  for (const name of [...reachableNodes].sort()) {
    const current = node(name);
    const missing = current.requirements.filter(req => requirementState[req].state !== 'satisfied');
    let state;
    if (runtime.completed.has(name)) state = 'completed';
    else if (current.prerequisites.some(prereq => !runtime.completed.has(prereq))) state = 'blocked';
    else if (missing.length > 0) state = 'blocked';
    else state = 'ready';
    nodeEntries.push({name, kind: current.kind, state, prerequisites: current.prerequisites, requirements: current.requirements, unsatisfiedRequirements: missing});
  }

  return {
    version: 2,
    goals: goals.slice(),
    requirements: [...reachableRequirements].sort().map(name => ({...requirements[name], ...requirementState[name]})),
    nodes: nodeEntries,
    _nodes: {...operations, ...providers}
  };
}

function executeAction(root, name, action) {
  if (!action) return;
  if (!isObject(action) || action.type !== 'process' || typeof action.command !== 'string') fail(`node ${name}: invalid action`);
  const args = Array.isArray(action.args) ? action.args : [];
  const result = childProcess.spawnSync(action.command, args, {cwd: root, env: process.env, stdio: 'inherit'});
  if (result.error) fail(`node ${name}: cannot execute: ${result.error.message}`);
  if (result.status !== 0) fail(`node ${name}: action failed with status ${result.status}`);
}

function publicPlan(plan) {
  return {version: plan.version, goals: plan.goals, requirements: plan.requirements, nodes: plan.nodes};
}

function main() {
  const request = parseArgs(process.argv.slice(2));
  const root = fs.realpathSync(path.resolve(request.project));
  const config = readConfig(root);
  const runtime = {completed: new Set()};

  if (request.plan) {
    process.stdout.write(`${JSON.stringify(publicPlan(resolve(root, config, request.goals, runtime)), null, 2)}\n`);
    return 0;
  }

  while (true) {
    const plan = resolve(root, config, request.goals, runtime);
    const unfinished = plan.nodes.filter(entry => entry.state !== 'completed');
    if (unfinished.length === 0) return 0;
    const ready = unfinished.find(entry => entry.state === 'ready');
    if (ready) {
      executeAction(root, ready.name, plan._nodes[ready.name].action);
      runtime.completed.add(ready.name);
      continue;
    }
    const unsatisfied = plan.requirements.filter(req => req.state === 'unsatisfied');
    if (unsatisfied.length > 0) fail(`unsatisfied requirement: ${unsatisfied.map(req => req.name).join(', ')}`);
    fail('no executable lifecycle node');
  }
}

try { process.exitCode = main(); }
catch (error) {
  process.stderr.write(`candidate-mk: ${error.message}\n`);
  process.exitCode = Number.isInteger(error.status) ? error.status : 1;
}
