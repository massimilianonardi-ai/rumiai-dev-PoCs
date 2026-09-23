'use strict';

const childProcess = require('node:child_process');
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(message);
}

function lines(file) {
  if (!fs.existsSync(file)) return [];
  const value = fs.readFileSync(file, 'utf8').trim();
  return value === '' ? [] : value.split('\n');
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o700);
}

function writeProject(root, config, files = {}) {
  fs.mkdirSync(root, {recursive: true});
  fs.writeFileSync(path.join(root, 'mk.json'), JSON.stringify(config, null, 2) + '\n');
  for (const [relative, value] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, value);
  }
}

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 028: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
const pocRoot = path.resolve(__dirname, '..');
const candidate = path.join(pocRoot, 'candidate-mk');
const trigger = path.join(pocRoot, 'trigger-command');
const runOnce = path.join(pocRoot, 'run-command');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc028-'));
let activeWatch = null;

function env(extra = {}) {
  return {
    ...process.env,
    RUMIAI_POC_RUMIAI_OS: targetRoot,
    RUMIAI_POC_HOST_NODE: process.execPath,
    RUMIAI_POC_WATCH_TRIGGER: trigger,
    RUMIAI_POC_WATCH_RUN_ONCE: runOnce,
    PATH: targetRoot + path.delimiter + path.join(targetRoot, 'bin', 'sys') + path.delimiter + (process.env.PATH || ''),
    ...extra
  };
}

function runCandidate(args, extra = {}) {
  return run(candidate, args, {env: env(extra)});
}

function startWatch(args, extra = {}) {
  const child = childProcess.spawn(candidate, args, {
    env: env(extra),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  activeWatch = child;
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  return {child, stderr: () => stderr};
}

function directDigest(projectRoot, extra = {}) {
  const result = run(trigger, ['--project', projectRoot, 'build'], {env: env(extra)});
  assert(
    result.signal === null && result.status === 0,
    'direct trigger resolution failed: status=' + result.status + ' stderr=' + result.stderr
  );
  return result.stdout.trim();
}

async function stopWatch(child, expected = 143) {
  child.kill('SIGTERM');
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  if (activeWatch === child) activeWatch = null;
  assert(status.signal === null && status.code === expected, 'watch stop status is wrong: ' + JSON.stringify(status));
}

async function cliScenario() {
  const v1 = path.join(root, 'v1');
  writeProject(v1, {
    version: 1,
    goals: {build: ['build']},
    operations: {
      build: {action: {type: 'process', command: 'sh', args: ['-c', 'true']}}
    }
  });

  let result = runCandidate(['--watch', '--plan', '--project', v1, 'build']);
  assert(result.status !== 0, '--watch --plan was not rejected');

  result = runCandidate(['--watch', '--goals', '--project', v1]);
  assert(result.status !== 0, '--watch --goals was not rejected');

  result = runCandidate(['--watch', '--show-goal', 'build', '--project', v1]);
  assert(result.status !== 0, '--watch --show-goal was not rejected');

  result = runCandidate(['--watch', '--interval-ms', '10', '--project', v1, 'build']);
  assert(result.status !== 0, 'public polling interval unexpectedly accepted');

  result = runCandidate(['--watch', '--project', v1, 'build']);
  assert(
    result.status !== 0,
    'version-1 watch request was not rejected: status=' + result.status +
      ' signal=' + result.signal + ' stdout=' + JSON.stringify(result.stdout) +
      ' stderr=' + JSON.stringify(result.stderr)
  );
}

async function mainScenario() {
  const trace = path.join(root, 'main-trace');
  const childRoot = path.join(root, 'child');
  const parentRoot = path.join(root, 'parent');

  writeProject(childRoot, {
    version: 2,
    goals: {build: ['child-build']},
    operations: {
      'child-build': {
        inputs: {source: {path: 'child.txt'}},
        action: {type: 'process', command: 'sh', args: ['-c', 'printf "child\\n" >> "$POC028_TRACE"']}
      }
    }
  }, {'child.txt': 'child-one\n'});

  writeProject(parentRoot, {
    version: 2,
    goals: {build: ['build', 'ordinary']},
    dependencies: {
      child: {project: '../child', goals: {build: ['build']}}
    },
    operations: {
      build: {
        inputs: {source: {path: 'input.txt'}},
        action: {type: 'process', command: './tool.sh'},
        outputs: {artifact: {path: 'build.out'}}
      },
      ordinary: {
        action: {type: 'process', command: 'sh', args: ['-c', 'printf "ordinary\\n" >> "$POC028_TRACE"; printf ordinary > ordinary.out']},
        outputs: {artifact: {path: 'ordinary.out'}}
      }
    }
  }, {'input.txt': 'one\n'});

  const tool = path.join(parentRoot, 'tool.sh');
  writeExecutable(tool, '#!/bin/sh\nprintf "parent\\n" >> "$POC028_TRACE"\ncp input.txt build.out\n');

  const directTrigger = run(trigger, ['--project', parentRoot, 'build'], {env: env({POC028_TRACE: trace})});
  assert(
    directTrigger.signal === null && directTrigger.status === 0 && /^[0-9a-f]{64}\n?$/.test(directTrigger.stdout),
    'integrated trigger command failed before watch: status=' + directTrigger.status +
      ' signal=' + directTrigger.signal + ' stderr=' + JSON.stringify(directTrigger.stderr)
  );

  const directRun = run(runOnce, ['--project', parentRoot, 'build'], {env: env({POC028_TRACE: trace})});
  assert(
    directRun.signal === null && directRun.status === 0,
    'integrated one-shot command failed before watch: status=' + directRun.status +
      ' signal=' + directRun.signal + ' stderr=' + JSON.stringify(directRun.stderr)
  );
  assert(lines(trace).length === 3, 'integrated one-shot command did not execute recursive lifecycle exactly once');
  fs.rmSync(trace, {force: true});

  const watch = startWatch(['--watch', '--project', parentRoot, 'build'], {POC028_TRACE: trace});
  await waitFor(
    () => lines(trace).length === 3 || watch.child.exitCode !== null,
    'watch supervisor neither ran the initial lifecycle nor terminated'
  );
  assert(
    lines(trace).length === 3,
    'initial recursive lifecycle did not run exactly once; trace=' + lines(trace).join(',') +
      ' exit=' + watch.child.exitCode + ' stderr=' + JSON.stringify(watch.stderr())
  );
  const initial = lines(trace).length;

  await sleep(220);
  assert(lines(trace).length === initial, 'unchanged trigger identity reran lifecycle');

  const input = path.join(parentRoot, 'input.txt');
  const now = new Date();
  fs.utimesSync(input, now, now);
  await sleep(180);
  assert(lines(trace).length === initial, 'mtime-only input change triggered lifecycle');

  fs.writeFileSync(input, 'two\n');
  await waitFor(() => lines(trace).length === 6, 'declared parent input change did not trigger exactly one cycle');

  fs.writeFileSync(path.join(parentRoot, 'ordinary.out'), 'tampered\n');
  await sleep(180);
  assert(lines(trace).length === 6, 'ordinary unconsumed output change triggered lifecycle');

  fs.appendFileSync(tool, '# executable change\n');
  await waitFor(() => lines(trace).length === 9, 'reachable executable change did not trigger exactly one cycle');

  const childDigestBefore = directDigest(parentRoot, {POC028_TRACE: trace});
  fs.writeFileSync(path.join(childRoot, 'child.txt'), 'child-two\n');
  const childDigestAfter = directDigest(parentRoot, {POC028_TRACE: trace});
  assert(childDigestAfter !== childDigestBefore, 'active child input change did not alter recursive trigger digest');
  await waitFor(
    () => lines(trace).length === 12,
    'recursive digest changed but parent lifecycle did not run; trace=' + lines(trace).join(',') +
      ' exit=' + watch.child.exitCode + ' stderr=' + watch.stderr()
  );

  const childConfig = fs.readFileSync(path.join(childRoot, 'mk.json'), 'utf8');
  fs.writeFileSync(path.join(childRoot, 'mk.json'), '{');
  await sleep(180);
  assert(lines(trace).length === 12, 'invalid child configuration started lifecycle work');
  fs.writeFileSync(path.join(childRoot, 'mk.json'), childConfig);
  await sleep(180);
  assert(lines(trace).length === 12, 'unchanged child configuration recovery triggered lifecycle');

  fs.writeFileSync(path.join(childRoot, 'mk.json'), '{');
  fs.writeFileSync(path.join(childRoot, 'child.txt'), 'child-three\n');
  await sleep(120);
  assert(lines(trace).length === 12, 'child input change ran lifecycle while configuration was invalid');
  fs.writeFileSync(path.join(childRoot, 'mk.json'), childConfig);
  await waitFor(() => lines(trace).length === 15, 'changed child identity did not trigger after valid recovery');

  const parentConfig = fs.readFileSync(path.join(parentRoot, 'mk.json'), 'utf8');
  fs.writeFileSync(path.join(parentRoot, 'mk.json'), '{"version":');
  await sleep(150);
  assert(lines(trace).length === 15, 'invalid root configuration started lifecycle work');
  fs.writeFileSync(path.join(parentRoot, 'mk.json'), parentConfig);
  await sleep(180);
  assert(lines(trace).length === 15, 'unchanged root configuration recovery triggered lifecycle');

  await stopWatch(watch.child);
  const stderr = watch.stderr();
  assert(stderr.includes('temporarily unavailable'), 'temporary configuration diagnostic missing');
  assert(stderr.includes('valid again'), 'configuration recovery diagnostic missing');
}

async function failedCycleScenario() {
  const projectRoot = path.join(root, 'failure');
  const trace = path.join(root, 'failure-trace');

  writeProject(projectRoot, {
    version: 2,
    goals: {build: ['run']},
    operations: {
      run: {
        inputs: {source: {path: 'input.txt'}},
        action: {
          type: 'process',
          command: 'sh',
          args: ['-c', 'printf "run\\n" >> "$POC028_TRACE"; [ "$(cat input.txt)" != fail ]']
        }
      }
    }
  }, {'input.txt': 'ok\n'});

  const watch = startWatch(['--watch', '--project', projectRoot, 'build'], {POC028_TRACE: trace});
  await waitFor(() => lines(trace).length === 1, 'failure scenario initial cycle did not run');

  const digestBeforeFailure = directDigest(projectRoot, {POC028_TRACE: trace});
  fs.writeFileSync(path.join(projectRoot, 'input.txt'), 'fail\n');
  const digestAfterFailureInput = directDigest(projectRoot, {POC028_TRACE: trace});
  assert(digestAfterFailureInput !== digestBeforeFailure, 'failure-scenario input change did not alter trigger digest');
  await waitFor(
    () => lines(trace).length === 2 || watch.child.exitCode !== null,
    'failing lifecycle cycle neither ran nor terminated the supervisor'
  );
  assert(
    lines(trace).length === 2,
    'failing lifecycle cycle did not run; exit=' + watch.child.exitCode +
      ' stderr=' + JSON.stringify(watch.stderr())
  );
  await sleep(180);
  assert(lines(trace).length === 2, 'failed cycle busy-looped without another trigger');
  assert(watch.stderr().includes('lifecycle cycle failed with status 1'), 'failed lifecycle cycle was not reported');

  fs.writeFileSync(path.join(projectRoot, 'input.txt'), 'ok-again\n');
  await waitFor(() => lines(trace).length === 3, 'watch did not continue after failed lifecycle cycle');
  await stopWatch(watch.child);
}

async function signalScenario() {
  const projectRoot = path.join(root, 'signal');
  const active = path.join(root, 'signal-active');
  const forwarded = path.join(root, 'signal-forwarded');

  writeProject(projectRoot, {
    version: 2,
    goals: {build: []},
    operations: {}
  });

  const directActive = path.join(root, 'signal-direct-active');
  const directForwarded = path.join(root, 'signal-direct-forwarded');
  const directChild = childProcess.spawn(
    runOnce,
    ['--project', projectRoot, 'build'],
    {
      env: env({
        RUMIAI_POC_SIGNAL_MODE: '1',
        RUMIAI_POC_SIGNAL_ACTIVE: directActive,
        RUMIAI_POC_SIGNAL_FORWARDED: directForwarded
      }),
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );
  await waitFor(() => fs.existsSync(directActive), 'direct signal-mode child did not become active');
  directChild.kill('SIGTERM');
  const directStatus = await new Promise((resolve, reject) => {
    directChild.once('error', reject);
    directChild.once('exit', (code, signal) => resolve({code, signal}));
  });
  assert(
    fs.existsSync(directForwarded),
    'direct integrated one-shot child did not observe SIGTERM: ' + JSON.stringify(directStatus)
  );

  const watch = startWatch(
    ['--watch', '--project', projectRoot, 'build'],
    {
      RUMIAI_POC_SIGNAL_MODE: '1',
      RUMIAI_POC_SIGNAL_ACTIVE: active,
      RUMIAI_POC_SIGNAL_FORWARDED: forwarded
    }
  );

  await waitFor(() => fs.existsSync(active), 'signal-mode one-shot child did not become active');
  await stopWatch(watch.child);
  assert(
    fs.existsSync(forwarded),
    'SIGTERM was not forwarded to active one-shot child; supervisor-stderr=' + JSON.stringify(watch.stderr())
  );
}

(async () => {
  try {
    await cliScenario();
    await mainScenario();
    await failedCycleScenario();
    await signalScenario();
    process.stdout.write('PASS PoC 028 mk public watch baseline\n');
    process.stdout.write('OBSERVED watch-surface=execution-mode\n');
    process.stdout.write('OBSERVED polling=portable-private-baseline\n');
    process.stdout.write('OBSERVED cycle-failure=report-and-wait\n');
    process.stdout.write('OBSERVED fresh-bootstrap=session-children\n');
  } finally {
    if (activeWatch !== null && activeWatch.exitCode === null) {
      try { activeWatch.kill('SIGTERM'); } catch (error) {}
    }
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => {
  process.stderr.write('FAIL PoC 028: ' + error.message + '\n');
  process.exitCode = 1;
});
