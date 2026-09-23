'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const TEMPORARY_CONFIG_STATUS = 10;
const POLL_INTERVAL_MS = 50;

function fail(message, status = 1) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function loadCliBoundary(targetRoot) {
  const filename = path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js');
  const source = fs.readFileSync(filename, 'utf8');
  const marker = 'module.exports = {mkMain};';
  if (!source.includes(marker)) fail('unexpected mk.lib.js export boundary');
  const instrumented = source.replace(
    marker,
    `${marker}
module.exports.__pocWatchCli = {_parseCli, _discoverProject};`
  );
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(instrumented, filename);
  return mod.exports.__pocWatchCli;
}

function watchRequest(argv, targetRoot) {
  let options = true;
  let watch = false;
  const forwarded = [];

  for (const arg of argv) {
    if (options && arg === '--') {
      options = false;
      forwarded.push(arg);
      continue;
    }
    if (options && arg === '--watch') {
      if (watch) fail('--watch may be specified only once', 2);
      watch = true;
      continue;
    }
    forwarded.push(arg);
  }

  if (!watch) fail('--watch is required by the watch candidate', 2);

  const mk = loadCliBoundary(targetRoot);
  const request = mk._parseCli(forwarded);
  if (request.plan || request.listGoals || request.showGoal !== null) {
    fail('--watch is incompatible with planning/introspection options', 2);
  }
  const project = mk._discoverProject(request.project);
  return {
    project: project.root,
    profile: request.profile,
    goals: request.goals.slice()
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) fail(`${name} is required`, 2);
  return value;
}

function childArgs(command, request) {
  const args = [command, '--project', request.project];
  if (request.profile !== null) args.push('--profile', request.profile);
  args.push(...request.goals);
  return args;
}

function readSnapshot(bootstrap, hostNode, trigger, request) {
  const result = childProcess.spawnSync(
    bootstrap,
    [hostNode, ...childArgs(trigger, request)],
    {
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  if (result.error) fail(`trigger child failed to start: ${result.error.message}`);
  if (result.signal !== null) fail(`trigger child terminated by signal ${result.signal}`);
  if (result.status === TEMPORARY_CONFIG_STATUS) {
    return {kind: 'temporary', diagnostic: result.stderr.trim()};
  }
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`trigger child failed with status ${result.status}`);
  }
  const value = result.stdout.trim();
  if (value.length === 0 || value.includes('\n')) fail('trigger child returned invalid digest');
  return {kind: 'ok', value};
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runLifecycle(bootstrap, hostNode, runOnce, request, signalState) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      bootstrap,
      [hostNode, ...childArgs(runOnce, request)],
      {env: process.env, stdio: 'inherit'}
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

async function main() {
  const target = requiredEnv('RUMIAI_POC_RUMIAI_OS');
  const targetRoot = fs.realpathSync(target);
  process.env.m_ROOT = targetRoot;

  const bootstrap = path.join(targetRoot, 'm');
  const hostNode = process.execPath;
  const trigger = requiredEnv('RUMIAI_POC_WATCH_TRIGGER');
  const runOnce = requiredEnv('RUMIAI_POC_WATCH_RUN_ONCE');
  const request = watchRequest(process.argv.slice(2), targetRoot);
  const signalState = {requested: null, child: null};
  let temporaryReported = false;

  function requestSignal(signal) {
    if (signalState.requested !== null) return;
    signalState.requested = signal;
    if (signalState.child !== null) {
      try { signalState.child.kill(signal); } catch (error) {}
    }
  }

  function signalStatus() {
    return signalState.requested === 'SIGINT' ? 130 : 143;
  }

  function observeSnapshot() {
    const state = readSnapshot(bootstrap, hostNode, trigger, request);
    if (state.kind === 'temporary') {
      if (!temporaryReported) {
        process.stderr.write('mk --watch: project configuration temporarily unavailable; waiting\n');
        temporaryReported = true;
      }
      return state;
    }
    if (temporaryReported) {
      process.stderr.write('mk --watch: project configuration valid again\n');
      temporaryReported = false;
    }
    return state;
  }

  process.on('SIGINT', () => requestSignal('SIGINT'));
  process.on('SIGTERM', () => requestSignal('SIGTERM'));

  async function waitForValidSnapshot() {
    while (true) {
      if (signalState.requested !== null) return null;
      const state = observeSnapshot();
      if (state.kind === 'ok') return state.value;
      await delay(POLL_INTERVAL_MS);
    }
  }

  async function cycle() {
    const result = await runLifecycle(bootstrap, hostNode, runOnce, request, signalState);
    if (signalState.requested !== null) return result;
    if (result.signal !== null) {
      process.stderr.write(`mk --watch: lifecycle cycle terminated by signal ${result.signal}\n`);
    } else if (result.status !== 0) {
      process.stderr.write(`mk --watch: lifecycle cycle failed with status ${result.status}\n`);
    }
    return result;
  }

  let baseline = await waitForValidSnapshot();
  if (baseline === null) return signalStatus();

  await cycle();
  if (signalState.requested !== null) return signalStatus();

  baseline = await waitForValidSnapshot();
  if (baseline === null) return signalStatus();

  while (true) {
    await delay(POLL_INTERVAL_MS);
    if (signalState.requested !== null) return signalStatus();

    const current = observeSnapshot();
    if (current.kind === 'temporary' || current.value === baseline) continue;

    await cycle();
    if (signalState.requested !== null) return signalStatus();

    baseline = await waitForValidSnapshot();
    if (baseline === null) return signalStatus();
  }
}

main().then(
  status => { process.exitCode = status; },
  error => {
    process.stderr.write(`mk-watch-candidate: ${error && error.message ? error.message : 'unexpected failure'}\n`);
    process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
  }
);
