'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error) throw result.error;
  return result;
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o700);
}

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 021: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
const pocRoot = path.resolve(__dirname, '..');
const snapshotCommand = path.join(pocRoot, 'trigger-snapshot.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc021-'));
let cacheProject = null;

function snapshot(project, goals, profile = null) {
  const args = [snapshotCommand, '--project', project];
  if (profile !== null) args.push('--profile', profile);
  args.push(...goals);
  const result = run(process.execPath, args, {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(result.status === 0, `trigger snapshot failed: ${result.stderr}`);
  return result.stdout.trim();
}

process.env.m_ROOT = targetRoot;
const {mkMain} = require(path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js'));

function execute(project, goals, profile = null) {
  const args = ['--project', project];
  if (profile !== null) args.push('--profile', profile);
  args.push(...goals);
  const status = mkMain(args);
  assert(status === 0, `one-shot mk execution failed with status ${status}`);
}

function statePath() {
  const result = run(path.join(targetRoot, 'm'), [
    path.join(targetRoot, 'bin', 'sys', 'state-path'),
    'user', 'sys', 'mk', 'cache'
  ], {env: {...process.env, m_ROOT: targetRoot}});
  assert(result.status === 0, `cannot resolve mk cache root: ${result.stderr}`);
  return result.stdout.trim();
}

try {
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'input.txt'), 'alpha\n');
  fs.writeFileSync(path.join(project, 'opaque.txt'), 'opaque-one\n');

  const tool = path.join(project, 'tool.sh');
  writeExecutable(tool, `#!/bin/sh
mkdir -p out
cp src/input.txt out/artifact
`);

  const config = {
    version: 2,
    goals: {
      build: ['compile', 'state-op'],
      opaque: ['opaque']
    },
    operations: {
      compile: {
        incremental: {
          inputs: {
            source: {path: 'src/input.txt'}
          }
        },
        action: {
          type: 'process',
          command: './tool.sh'
        },
        outputs: {
          artifact: {path: 'out/artifact'}
        }
      },
      'state-op': {
        when: {
          op: 'truthy',
          value: {state: {path: 'marker', property: 'exists'}}
        },
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'printf state > state.out']
        }
      },
      opaque: {
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'cat opaque.txt > opaque.out']
        }
      }
    }
  };
  fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(config));

  const projectCanonical = fs.realpathSync(project);
  const projectKey = crypto.createHash('sha256').update(projectCanonical).digest('hex');
  cacheProject = path.join(statePath(), 'projects', projectKey);
  fs.rmSync(cacheProject, {recursive: true, force: true});

  const beforeBuild = snapshot(project, ['build']);
  execute(project, ['build']);
  const baseline = snapshot(project, ['build']);
  assert(beforeBuild !== baseline, 'successful incremental build did not change ready/up-to-date trigger state');
  assert(snapshot(project, ['build']) === baseline, 'unchanged post-build trigger snapshot is unstable');

  const input = path.join(project, 'src', 'input.txt');
  const now = new Date();
  fs.utimesSync(input, now, now);
  assert(snapshot(project, ['build']) === baseline, 'mtime-only change altered trigger snapshot');

  fs.writeFileSync(input, 'beta\n');
  const changedInput = snapshot(project, ['build']);
  assert(changedInput !== baseline, 'declared incremental input content change was invisible');

  execute(project, ['build']);
  const betaBaseline = snapshot(project, ['build']);
  assert(betaBaseline !== baseline, 'new input content did not establish distinct stable snapshot');
  assert(snapshot(project, ['build']) === betaBaseline, 'rebuilt trigger snapshot is unstable');

  fs.writeFileSync(path.join(project, 'out', 'artifact'), 'tampered\n');
  const tamperedOutput = snapshot(project, ['build']);
  assert(tamperedOutput !== betaBaseline, 'declared output tampering was invisible');

  execute(project, ['build']);
  const repairedBaseline = snapshot(project, ['build']);
  assert(repairedBaseline === betaBaseline, 'repairing output did not restore the same trigger identity');

  fs.appendFileSync(tool, '# executable identity change\n');
  const changedExecutable = snapshot(project, ['build']);
  assert(changedExecutable !== repairedBaseline, 'executable content change was invisible');

  execute(project, ['build']);
  const executableBaseline = snapshot(project, ['build']);
  assert(executableBaseline !== repairedBaseline, 'changed executable did not establish a new stable identity');

  fs.writeFileSync(path.join(project, 'marker'), 'present\n');
  const stateChanged = snapshot(project, ['build']);
  assert(stateChanged !== executableBaseline, 'reachable condition-state change was invisible');

  const parsed = JSON.parse(fs.readFileSync(path.join(project, 'mk.json'), 'utf8'));
  fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(parsed, null, 4) + '\n');
  const reformatted = snapshot(project, ['build']);
  assert(reformatted === stateChanged, 'formatting-only mk.json rewrite changed normalized trigger identity');

  const opaqueBaseline = snapshot(project, ['opaque']);
  fs.writeFileSync(path.join(project, 'opaque.txt'), 'opaque-two\n');
  const opaqueChanged = snapshot(project, ['opaque']);
  assert(
    opaqueChanged === opaqueBaseline,
    'undeclared non-incremental input unexpectedly affected trigger identity; PoC no longer demonstrates the contract gap'
  );

  process.stdout.write('PASS PoC 021 mk internal watch trigger snapshot\n');
  process.stdout.write('OBSERVED undeclared-nonincremental-input=invisible\n');
} catch (error) {
  process.stderr.write(`FAIL PoC 021: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (cacheProject !== null) fs.rmSync(cacheProject, {recursive: true, force: true});
  fs.rmSync(root, {recursive: true, force: true});
}
