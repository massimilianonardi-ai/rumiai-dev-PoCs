'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');

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

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) fail(`${name} is required`, 2);
  return value;
}

function snapshot(bootstrap, command) {
  const result = childProcess.spawnSync(bootstrap, [command], {
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  if (result.error) fail(`snapshot bootstrap failed to start: ${result.error.message}`);
  if (result.signal !== null) fail(`snapshot bootstrap terminated by signal ${result.signal}`);
  if (result.status !== 0) fail(`snapshot bootstrap failed with status ${result.status}`);
  const value = result.stdout.trim();
  if (value.length === 0 || value.includes('\n')) fail('snapshot child returned invalid digest');
  return value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runCycle(bootstrap, command, reason) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(bootstrap, [command], {
      env: {...process.env, RUMIAI_POC_WATCH_REASON: reason},
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve({status, signal}));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bootstrap = requiredEnv('RUMIAI_POC_WATCH_BOOTSTRAP');
  const snapshotCommand = requiredEnv('RUMIAI_POC_WATCH_SNAPSHOT');
  const runCommand = requiredEnv('RUMIAI_POC_WATCH_RUN');
  const supervisorEnvFile = requiredEnv('RUMIAI_POC_WATCH_SUPERVISOR_ENV_FILE');

  fs.writeFileSync(supervisorEnvFile, `${process.env.POC027_VALUE || '<unset>'}\n`);

  let runs = 0;
  async function cycle(reason) {
    const result = await runCycle(bootstrap, runCommand, reason);
    runs += 1;
    if (result.signal !== null) fail(`cycle terminated by signal ${result.signal}`);
    if (result.status !== 0) fail(`cycle failed with status ${result.status}`);
  }

  await cycle('initial');
  let baseline = snapshot(bootstrap, snapshotCommand);
  if (options.maxRuns !== null && runs >= options.maxRuns) return 0;

  while (true) {
    await delay(options.intervalMs);
    const current = snapshot(bootstrap, snapshotCommand);
    if (current === baseline) continue;

    await cycle('change');
    baseline = snapshot(bootstrap, snapshotCommand);
    if (options.maxRuns !== null && runs >= options.maxRuns) return 0;
  }
}

main().then(
  status => { process.exitCode = status; },
  error => {
    process.stderr.write(`fresh-bootstrap-watch: ${error && error.message ? error.message : 'unexpected failure'}\n`);
    process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
  }
);
