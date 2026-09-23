'use strict';

const childProcess = require('node:child_process');

function fail(message, status = 1) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function parsePositive(value, label) {
  if (!/^[1-9][0-9]*$/.test(value)) fail(`${label} must be a positive integer`, 2);
  return Number(value);
}

function parseArgs(argv) {
  const options = {intervalMs: 100, maxRuns: null};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--interval-ms') {
      if (++i >= argv.length) fail('--interval-ms requires a value', 2);
      options.intervalMs = parsePositive(argv[i], '--interval-ms');
    } else if (arg === '--max-runs') {
      if (++i >= argv.length) fail('--max-runs requires a value', 2);
      options.maxRuns = parsePositive(argv[i], '--max-runs');
    } else {
      fail(`unsupported option: ${arg}`, 2);
    }
  }
  return options;
}

function commandFromEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) fail(`${name} is required`, 2);
  return value;
}

function snapshot(command) {
  const result = childProcess.spawnSync(command, [], {
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  if (result.error) fail(`snapshot command failed to start: ${result.error.message}`);
  if (result.signal !== null) fail(`snapshot command terminated by signal ${result.signal}`);
  if (result.status !== 0) fail(`snapshot command failed with status ${result.status}`);
  return result.stdout;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runChild(command, reason, signalState) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, [], {
      env: {...process.env, RUMIAI_POC_WATCH_REASON: reason},
      stdio: 'inherit'
    });
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
  const options = parseArgs(process.argv.slice(2));
  const snapshotCommand = commandFromEnvironment('RUMIAI_POC_WATCH_SNAPSHOT');
  const runCommand = commandFromEnvironment('RUMIAI_POC_WATCH_RUN');
  const signalState = {requested: null, child: null};

  function requestSignal(signal) {
    if (signalState.requested !== null) return;
    signalState.requested = signal;
    if (signalState.child !== null) {
      try { signalState.child.kill(signal); } catch (error) { /* child may already have exited */ }
    }
  }

  process.on('SIGINT', () => requestSignal('SIGINT'));
  process.on('SIGTERM', () => requestSignal('SIGTERM'));

  let runs = 0;
  async function cycle(reason) {
    const result = await runChild(runCommand, reason, signalState);
    runs += 1;
    if (signalState.requested !== null) return result;
    if (result.signal !== null) {
      process.stderr.write(`watch-session: cycle terminated by signal ${result.signal}\n`);
    } else if (result.status !== 0) {
      process.stderr.write(`watch-session: cycle failed with status ${result.status}\n`);
    }
    return result;
  }

  await cycle('initial');
  if (signalState.requested !== null) {
    return signalState.requested === 'SIGINT' ? 130 : 143;
  }

  let baseline = snapshot(snapshotCommand);
  if (options.maxRuns !== null && runs >= options.maxRuns) return 0;

  while (true) {
    await delay(options.intervalMs);
    if (signalState.requested !== null) {
      return signalState.requested === 'SIGINT' ? 130 : 143;
    }

    const current = snapshot(snapshotCommand);
    if (current === baseline) continue;

    await cycle('change');
    if (signalState.requested !== null) {
      return signalState.requested === 'SIGINT' ? 130 : 143;
    }

    baseline = snapshot(snapshotCommand);
    if (options.maxRuns !== null && runs >= options.maxRuns) return 0;
  }
}

main().then(
  status => { process.exitCode = status; },
  error => {
    process.stderr.write(`watch-session: ${error && error.message ? error.message : 'unexpected failure'}\n`);
    process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
  }
);
