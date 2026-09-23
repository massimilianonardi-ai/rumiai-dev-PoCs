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
  const result = childProcess.spawnSync(command, args, {encoding: 'utf8', ...options});
  if (result.error) throw result.error;
  return result;
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o700);
}

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 026: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
process.env.m_ROOT = targetRoot;
const pocRoot = path.resolve(__dirname, '..');
const trigger = path.join(pocRoot, 'trigger-composition.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc026-'));
const provider = `poc026provider${process.pid}`;
const facility = `poc026facility${process.pid}`;
let pkgStoreCreated = false;
let cacheProject = null;

function mEnv() {
  return {
    ...process.env,
    m_ROOT: targetRoot,
    PATH: `${path.join(targetRoot, 'bin', 'sys')}${path.delimiter}${process.env.PATH || ''}`
  };
}

function runM(args) {
  return run(path.join(targetRoot, 'm'), args, {env: mEnv()});
}

function runPkg(args) {
  return runM([path.join(targetRoot, 'bin', 'sys', 'pkg'), ...args]);
}

function requireOk(result, message) {
  assert(result.signal === null && result.status === 0, `${message}: status=${result.status} stderr=${result.stderr}`);
  return result;
}

function integrate(version, label) {
  const range = path.join(root, `range-${version}`);
  const payload = path.join(root, `payload-${version}`);
  fs.mkdirSync(range);
  fs.mkdirSync(payload);
  fs.writeFileSync(path.join(range, 'format'), 'tar.xz\n');
  fs.writeFileSync(path.join(range, 'facility'), `${facility} 21\n`);
  fs.writeFileSync(path.join(payload, 'marker'), `${label}\n`);
  requireOk(
    runM([path.join(root, 'integration-driver'), provider, String(version), range, payload]),
    `cannot integrate provider version ${version}`
  );
}

function snapshot(project, goals) {
  const result = run(process.execPath, [trigger, '--project', project, ...goals], {
    env: {...process.env, m_ROOT: targetRoot, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(result.status === 0, `trigger snapshot failed: ${result.stderr}`);
  return result.stdout.trim();
}

function statePath() {
  const result = requireOk(
    runM([path.join(targetRoot, 'bin', 'sys', 'state-path'), 'user', 'sys', 'mk', 'cache']),
    'cannot resolve mk cache root'
  );
  return result.stdout.trim();
}

function cleanup() {
  try { runPkg(['provider', 'default', '-u', '--', facility]); } catch (error) {}
  try { runPkg(['default', '-u', '--', provider]); } catch (error) {}
  try { runPkg(['uninstall', `${provider}@2`]); } catch (error) {}
  try { runPkg(['uninstall', `${provider}@1`]); } catch (error) {}
  if (cacheProject !== null) fs.rmSync(cacheProject, {recursive: true, force: true});
  if (pkgStoreCreated) {
    try { fs.rmdirSync(path.join(targetRoot, 'pkg')); } catch (error) {}
  }
  fs.rmSync(root, {recursive: true, force: true});
}

try {
  const pkgStore = path.join(targetRoot, 'pkg');
  if (!fs.existsSync(pkgStore)) {
    fs.mkdirSync(pkgStore);
    pkgStoreCreated = true;
  }
  assert(fs.statSync(pkgStore).isDirectory(), 'target package store is not a directory');

  writeExecutable(path.join(root, 'integration-driver'), `#!/usr/bin/env m
. "$m_LIB_DIR/sys/sh/pkg/pkg-integration.lib.sh" || exit 3
pkg_integrate "$@"
`);

  integrate(1, 'provider-one');
  integrate(2, 'provider-two');
  requireOk(runPkg(['default', `${provider}@1`]), 'cannot select provider package default v1');
  requireOk(runPkg(['provider', 'default', facility, provider]), 'cannot select facility default');

  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'provider-src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'plain.txt'), 'plain-one\n');
  fs.writeFileSync(path.join(project, 'inc-source.txt'), 'inc-one\n');
  fs.writeFileSync(path.join(project, 'producer-source.txt'), 'generated-one\n');
  fs.writeFileSync(path.join(project, 'provider-src', 'item.txt'), 'provider-source-one\n');

  const toolSource = `#!/bin/sh
cat plain.txt >/dev/null
`;
  writeExecutable(path.join(project, 'tool.sh'), toolSource);

  const config = {
    version: 2,
    goals: {
      all: ['plain', 'incremental', 'consumer', 'noise', 'requirement-op', 'mapped'],
      'plain-only': ['plain']
    },
    requirements: {
      tool: {type: 'facility', facility, constraints: ['>=21', '<26']}
    },
    collections: {
      sources: {type: 'files', root: 'provider-src', suffixes: ['.txt']}
    },
    providers: {
      mapped: {
        type: 'map-process',
        collection: 'sources',
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'cat "$1" >/dev/null', 'sh', '${item}']
        }
      }
    },
    operations: {
      plain: {
        inputs: {source: {path: 'plain.txt'}},
        action: {type: 'process', command: './tool.sh'}
      },
      incremental: {
        inputs: {source: {path: 'inc-source.txt'}},
        incremental: {},
        action: {type: 'process', command: 'sh', args: ['-c', 'cp inc-source.txt inc.out']},
        outputs: {artifact: {path: 'inc.out'}}
      },
      producer: {
        inputs: {source: {path: 'producer-source.txt'}},
        action: {type: 'process', command: 'sh', args: ['-c', 'cp producer-source.txt generated.txt']},
        outputs: {artifact: {path: 'generated.txt'}}
      },
      consumer: {
        inputs: {artifact: {output: {operation: 'producer', name: 'artifact'}}},
        action: {type: 'process', command: 'sh', args: ['-c', 'cp generated.txt consumed.txt']},
        outputs: {artifact: {path: 'consumed.txt'}}
      },
      noise: {
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'n=0; [ ! -f noise.out ] || n=$(cat noise.out); n=$((n + 1)); printf "%s\\n" "$n" > noise.out']
        },
        outputs: {artifact: {path: 'noise.out'}}
      },
      'requirement-op': {
        requirements: ['tool'],
        action: {type: 'process', command: 'sh', args: ['-c', 'true']}
      }
    }
  };
  fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(config, null, 2) + '\n');

  const projectCanonical = fs.realpathSync(project);
  const projectKey = crypto.createHash('sha256').update(projectCanonical).digest('hex');
  cacheProject = path.join(statePath(), 'projects', projectKey);
  fs.rmSync(cacheProject, {recursive: true, force: true});

  const mk = require(path.join(targetRoot, 'lib', 'sys', 'js', 'mk.lib.js'));
  function execute(goals) {
    const status = mk.mkMain(['--project', project, ...goals]);
    assert(status === 0, `one-shot mk execution failed with status ${status}`);
  }

  execute(['all']);
  const baseline = snapshot(project, ['all']);
  assert(snapshot(project, ['all']) === baseline, 'unchanged post-cycle trigger identity is unstable');

  const now = new Date();
  fs.utimesSync(path.join(project, 'plain.txt'), now, now);
  fs.utimesSync(path.join(project, 'tool.sh'), now, now);
  assert(snapshot(project, ['all']) === baseline, 'mtime-only change altered trigger identity');

  fs.appendFileSync(path.join(project, 'tool.sh'), '# changed executable bytes\n');
  assert(snapshot(project, ['all']) !== baseline, 'non-incremental executable content change was invisible');
  writeExecutable(path.join(project, 'tool.sh'), toolSource);
  assert(snapshot(project, ['all']) === baseline, 'restoring executable bytes did not restore trigger identity');

  const plainBeforeProviderChange = snapshot(project, ['plain-only']);
  requireOk(runPkg(['default', `${provider}@2`]), 'cannot move provider package default to v2');
  assert(snapshot(project, ['all']) !== baseline, 'reachable requirement provider change was invisible');
  assert(snapshot(project, ['plain-only']) === plainBeforeProviderChange, 'unreachable requirement provider affected unrelated goal');
  requireOk(runPkg(['default', `${provider}@1`]), 'cannot restore provider package default v1');
  assert(snapshot(project, ['all']) === baseline, 'restoring requirement provider did not restore trigger identity');

  fs.writeFileSync(path.join(project, 'inc.out'), 'tampered-incremental\n');
  assert(snapshot(project, ['all']) !== baseline, 'incremental output tampering was invisible');
  execute(['all']);
  assert(snapshot(project, ['all']) === baseline, 'one-shot incremental output repair did not restore stable trigger identity');

  fs.writeFileSync(path.join(project, 'generated.txt'), 'tampered-generated\n');
  assert(snapshot(project, ['all']) !== baseline, 'declared output-input content change was invisible');
  execute(['all']);
  assert(snapshot(project, ['all']) === baseline, 'producer/consumer repair did not restore trigger identity');

  fs.writeFileSync(path.join(project, 'noise.out'), '999\n');
  assert(snapshot(project, ['all']) === baseline, 'ordinary unconsumed output became trigger identity');
  execute(['all']);
  assert(snapshot(project, ['all']) === baseline, 'one-shot rewrite of ordinary output caused post-cycle trigger drift');

  fs.writeFileSync(path.join(project, 'provider-src', 'item.txt'), 'provider-source-two\n');
  assert(snapshot(project, ['all']) !== baseline, 'provider collection content change was invisible');
  fs.writeFileSync(path.join(project, 'provider-src', 'item.txt'), 'provider-source-one\n');
  assert(snapshot(project, ['all']) === baseline, 'restoring provider collection content did not restore trigger identity');

  process.stdout.write('PASS PoC 026 mk watch trigger composition\n');
  process.stdout.write('OBSERVED nonincremental-executable=trigger-identity\n');
  process.stdout.write('OBSERVED requirement-provider=reachable-plan-identity\n');
  process.stdout.write('OBSERVED output-input=trigger-identity\n');
  process.stdout.write('OBSERVED ordinary-output=not-trigger-identity\n');
  process.stdout.write('OBSERVED provider-collection-content=trigger-identity\n');
} catch (error) {
  process.stderr.write(`FAIL PoC 026: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
