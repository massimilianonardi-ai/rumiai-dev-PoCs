'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
  if (request.project === null || request.goals.length === 0) fail('invalid one-shot request', 2);
  return request;
}

async function signalProbe() {
  const active = process.env.RUMIAI_POC_SIGNAL_ACTIVE;
  const forwarded = process.env.RUMIAI_POC_SIGNAL_FORWARDED;
  if (!active || !forwarded) fail('signal probe paths are required', 2);

  process.on('SIGTERM', () => {
    fs.writeFileSync(forwarded, 'forwarded\n');
    process.exit(143);
  });
  process.on('SIGINT', () => {
    fs.writeFileSync(forwarded, 'forwarded\n');
    process.exit(130);
  });

  fs.writeFileSync(active, 'active\n');
  await new Promise(() => {});
}

async function main() {
  if (process.env.RUMIAI_POC_SIGNAL_MODE === '1') {
    await signalProbe();
    return 0;
  }

  const request = parseArgs(process.argv.slice(2));
  const target = process.env.RUMIAI_POC_RUMIAI_OS;
  if (typeof target !== 'string' || target.length === 0) fail('RUMIAI_POC_RUMIAI_OS is required', 2);

  const targetRoot = fs.realpathSync(target);
  const projectRoot = fs.realpathSync(request.project);
  process.env.m_ROOT = targetRoot;
  const {mkMain} = require(path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js'));

  const args = ['--project', projectRoot];
  if (request.profile !== null) args.push('--profile', request.profile);
  args.push(...request.goals);
  return mkMain(args);
}

main().then(
  status => { process.exitCode = status; },
  error => {
    process.stderr.write(`watch-run-once: ${error && error.message ? error.message : 'unexpected failure'}\n`);
    process.exitCode = error && Number.isInteger(error.status) ? error.status : 1;
  }
);
