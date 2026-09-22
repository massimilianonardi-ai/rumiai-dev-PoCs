'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function fail(message) {
  process.stderr.write(`candidate-mk: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const request = {project: '.', profile: null, plan: false, goals: []};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      if (++i >= argv.length) fail('--project requires a value');
      request.project = argv[i];
    } else if (arg === '--profile') {
      if (++i >= argv.length) fail('--profile requires a value');
      request.profile = argv[i];
    } else if (arg === '--plan') {
      request.plan = true;
    } else if (arg.startsWith('-')) {
      fail(`unsupported option: ${arg}`);
    } else {
      request.goals.push(arg);
    }
  }
  if (request.goals.length === 0) fail('at least one goal is required');
  return request;
}

function readConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'mk.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`cannot read project configuration: ${configPath}`);
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail('project configuration must be an object');
  if (config.version !== 2) fail('PoC supports candidate version 2 only');
  if (config.goals === null || typeof config.goals !== 'object' || Array.isArray(config.goals)) fail('goals must be an object');
  const dependencies = config.dependencies === undefined ? {} : config.dependencies;
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) fail('dependencies must be an object');
  return {goals: config.goals, dependencies};
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function parseChain() {
  const raw = process.env.RUMIAI_MK_POC_CHAIN;
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('invalid');
    return value;
  } catch (error) {
    fail('invalid invocation chain');
  }
}

function childRequest(projectRoot, dependencyName, definition, requestedGoals) {
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    fail(`dependency ${dependencyName} must be an object`);
  }
  if (typeof definition.project !== 'string' || definition.project.length === 0) {
    fail(`dependency ${dependencyName} requires project`);
  }
  if (definition.profile !== undefined && (typeof definition.profile !== 'string' || definition.profile.length === 0)) {
    fail(`dependency ${dependencyName} profile must be a non-empty string`);
  }
  if (definition.goals === null || typeof definition.goals !== 'object' || Array.isArray(definition.goals)) {
    fail(`dependency ${dependencyName} goals must be an object`);
  }

  const childGoals = [];
  for (const parentGoal of requestedGoals) {
    const mapped = definition.goals[parentGoal];
    if (mapped === undefined) continue;
    if (!Array.isArray(mapped) || mapped.some(goal => typeof goal !== 'string' || goal.length === 0)) {
      fail(`dependency ${dependencyName} goal mapping for ${parentGoal} must be an array of non-empty strings`);
    }
    childGoals.push(...mapped);
  }
  if (childGoals.length === 0) return null;

  const childRoot = fs.realpathSync(path.resolve(projectRoot, definition.project));
  return {
    name: dependencyName,
    project: childRoot,
    profile: definition.profile === undefined ? null : definition.profile,
    goals: unique(childGoals)
  };
}

function invokeChild(request, chain, planMode) {
  const args = [__filename, '--project', request.project];
  if (request.profile !== null) args.push('--profile', request.profile);
  if (planMode) args.push('--plan');
  args.push(...request.goals);

  const env = Object.assign({}, process.env, {
    RUMIAI_MK_POC_CHAIN: JSON.stringify(chain)
  });
  const result = childProcess.spawnSync(process.execPath, args, {
    env,
    encoding: 'utf8',
    stdio: planMode ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) fail(`dependency ${request.name}: cannot invoke child mk: ${result.error.message}`);
  if (result.status !== 0) {
    if (planMode && result.stderr) process.stderr.write(result.stderr);
    fail(`dependency ${request.name}: child mk failed with status ${result.status}`);
  }
  if (!planMode) return null;
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`dependency ${request.name}: child plan is not valid JSON`);
  }
}

function appendTrace(projectRoot, goals, profile) {
  const trace = process.env.RUMIAI_MK_POC_TRACE;
  if (!trace) return;
  fs.appendFileSync(trace, `${path.basename(projectRoot)} goals=${goals.join(',')} profile=${profile === null ? '-' : profile}\n`);
}

function main() {
  const request = parseArgs(process.argv.slice(2));
  let projectRoot;
  try {
    projectRoot = fs.realpathSync(path.resolve(request.project));
  } catch (error) {
    fail(`invalid project: ${request.project}`);
  }

  const chain = parseChain();
  if (chain.includes(projectRoot)) {
    fail(`project dependency cycle: ${[...chain, projectRoot].map(item => path.basename(item)).join(' -> ')}`);
  }
  const nextChain = [...chain, projectRoot];
  const config = readConfig(projectRoot);
  for (const goal of request.goals) {
    if (!Object.prototype.hasOwnProperty.call(config.goals, goal)) fail(`unknown goal: ${goal}`);
  }

  const dependencies = [];
  for (const dependencyName of Object.keys(config.dependencies).sort()) {
    const child = childRequest(projectRoot, dependencyName, config.dependencies[dependencyName], request.goals);
    if (child !== null) dependencies.push(child);
  }

  if (request.plan) {
    const dependencyPlans = dependencies.map(child => ({
      name: child.name,
      project: child.project,
      goals: child.goals,
      profile: child.profile,
      plan: invokeChild(child, nextChain, true)
    }));
    process.stdout.write(`${JSON.stringify({
      project: projectRoot,
      goals: request.goals,
      profile: request.profile,
      dependencies: dependencyPlans
    }, null, 2)}\n`);
    return;
  }

  for (const child of dependencies) invokeChild(child, nextChain, false);
  appendTrace(projectRoot, request.goals, request.profile);
}

main();
