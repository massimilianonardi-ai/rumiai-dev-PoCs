'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(message);
}

function lines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o700);
}

function operation(input) {
  return {
    inputs: {source: {path: input}},
    action: {type: 'process', command: 'sh', args: ['-c', 'true']}
  };
}

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 025: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
const pocRoot = path.resolve(__dirname, '..');
const trigger = path.join(pocRoot, 'trigger-snapshot.js');
const supervisor = path.join(pocRoot, 'watch-session.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc025-'));

function makeFixture(prefix) {
  const base = path.join(root, prefix);
  const a = path.join(base, 'A');
  const b = path.join(base, 'B');
  fs.mkdirSync(a, {recursive: true});
  fs.mkdirSync(b, {recursive: true});
  fs.writeFileSync(path.join(a, 'a.txt'), 'a-one\n');
  fs.writeFileSync(path.join(b, 'b.txt'), 'b-one\n');

  const bConfig = {
    version: 2,
    goals: {build: ['build']},
    operations: {build: operation('b.txt')}
  };
  const aConfig = {
    version: 2,
    goals: {build: ['build']},
    dependencies: {b: {project: '../B', goals: {build: ['build']}}},
    operations: {build: operation('a.txt')}
  };
  fs.writeFileSync(path.join(a, 'mk.json'), JSON.stringify(aConfig, null, 2) + '\n');
  fs.writeFileSync(path.join(b, 'mk.json'), JSON.stringify(bConfig, null, 2) + '\n');
  return {a, b, aConfig, bConfig};
}

function makeCommands(prefix, project, trace, fatalFile) {
  const snapshot = path.join(root, `${prefix}-snapshot`);
  const run = path.join(root, `${prefix}-run`);

  writeExecutable(snapshot, `#!/bin/sh
exec node "${trigger}" --project "${project}" build
`);
  writeExecutable(run, `#!/bin/sh
printf '%s\\n' "$RUMIAI_POC_WATCH_REASON" >> "${trace}"
`);

  return {
    snapshot,
    run,
    env: {
      ...process.env,
      RUMIAI_POC_RUMIAI_OS: targetRoot,
      RUMIAI_POC_WATCH_SNAPSHOT: snapshot,
      RUMIAI_POC_WATCH_RUN: run,
      RUMIAI_POC_TRIGGER_FATAL_FILE: fatalFile
    }
  };
}

async function mainScenario() {
  const fixture = makeFixture('main');
  const trace = path.join(root, 'main-trace');
  const fatalFile = path.join(root, 'main-fatal');
  const commands = makeCommands('main', fixture.a, trace, fatalFile);

  // Startup with invalid root config: no lifecycle run until a valid snapshot exists.
  const originalA = fs.readFileSync(path.join(fixture.a, 'mk.json'), 'utf8');
  fs.writeFileSync(path.join(fixture.a, 'mk.json'), '{');

  const child = childProcess.spawn(process.execPath, [supervisor, '--interval-ms', '25', '--max-runs', '3'], {
    env: commands.env,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  await sleep(160);
  assert(lines(trace).length === 0, 'invalid startup configuration ran a lifecycle cycle');
  assert(child.exitCode === null, 'invalid startup configuration terminated the watch session');

  fs.writeFileSync(path.join(fixture.a, 'mk.json'), originalA);
  await waitFor(() => lines(trace).length === 1, 'valid startup configuration did not start initial cycle');
  assert(lines(trace)[0] === 'initial', 'first lifecycle cycle was not initial');

  // Active child config becomes temporarily invalid.
  const originalB = fs.readFileSync(path.join(fixture.b, 'mk.json'), 'utf8');
  fs.writeFileSync(path.join(fixture.b, 'mk.json'), '{"version":');
  await sleep(180);
  assert(lines(trace).length === 1, 'temporary invalid child configuration ran a lifecycle cycle');
  assert(child.exitCode === null, 'temporary invalid child configuration terminated the session');

  // Exact semantic restoration does not trigger.
  fs.writeFileSync(path.join(fixture.b, 'mk.json'), originalB);
  await sleep(180);
  assert(lines(trace).length === 1, 'restoring unchanged child configuration triggered a lifecycle cycle');

  // Change child data while configuration is invalid; recovery should trigger exactly once.
  fs.writeFileSync(path.join(fixture.b, 'mk.json'), '{');
  fs.writeFileSync(path.join(fixture.b, 'b.txt'), 'b-two\n');
  await sleep(120);
  assert(lines(trace).length === 1, 'invalid child period ran work after child input change');
  fs.writeFileSync(path.join(fixture.b, 'mk.json'), originalB);
  await waitFor(() => lines(trace).length === 2, 'changed child identity did not trigger on configuration recovery');
  assert(lines(trace)[1] === 'change', 'child recovery cycle reason is wrong');
  await sleep(140);
  assert(lines(trace).length === 2, 'child recovery caused duplicate/busy-loop cycle');

  // Root config invalid/restored unchanged: no cycle.
  fs.writeFileSync(path.join(fixture.a, 'mk.json'), '{');
  await sleep(100);
  fs.writeFileSync(path.join(fixture.a, 'mk.json'), originalA);
  await sleep(160);
  assert(lines(trace).length === 2, 'restoring unchanged root configuration triggered a lifecycle cycle');

  // Later valid root input change triggers one final cycle.
  fs.writeFileSync(path.join(fixture.a, 'a.txt'), 'a-two\n');
  await waitFor(() => lines(trace).length === 3, 'root input change did not trigger lifecycle cycle');

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  assert(status.signal === null && status.code === 0, `main session exited unexpectedly: ${JSON.stringify(status)}`);
  assert(lines(trace).join(',') === 'initial,change,change', 'main session cycle trace is incorrect');

  const unavailableCount = (stderr.match(/temporarily unavailable/g) || []).length;
  assert(unavailableCount >= 3, 'temporary invalid configuration was not reported for each outage');
  assert(unavailableCount <= 4, 'temporary invalid configuration was repeatedly spammed during one outage');
  assert(stderr.includes('trigger configuration valid again'), 'configuration recovery was not reported');
}

async function fatalScenario() {
  const fixture = makeFixture('fatal');
  const trace = path.join(root, 'fatal-trace');
  const fatalFile = path.join(root, 'fatal-marker');
  const commands = makeCommands('fatal', fixture.a, trace, fatalFile);

  const child = childProcess.spawn(process.execPath, [supervisor, '--interval-ms', '25'], {
    env: commands.env,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  await waitFor(() => lines(trace).length === 1, 'fatal scenario initial cycle did not run');
  fs.writeFileSync(fatalFile, 'fatal\n');

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  assert(status.signal === null && status.code === 1, 'fatal trigger failure did not terminate watch session');
  assert(stderr.includes('forced fatal trigger resolver failure'), 'fatal resolver diagnostic was not surfaced');
  assert(lines(trace).length === 1, 'fatal trigger failure incorrectly started another cycle');
}

(async () => {
  try {
    await mainScenario();
    await fatalScenario();
    process.stdout.write('PASS PoC 025 watch transient invalid configuration\n');
    process.stdout.write('OBSERVED invalid-config=retry-with-last-valid-baseline\n');
    process.stdout.write('OBSERVED fatal-trigger-error=session-failure\n');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => {
  process.stderr.write(`FAIL PoC 025: ${error.message}\n`);
  process.exitCode = 1;
});
