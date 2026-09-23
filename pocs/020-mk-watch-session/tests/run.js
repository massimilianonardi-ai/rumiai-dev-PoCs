'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
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

async function runMainScenario(root, supervisor) {
  const input = path.join(root, 'input');
  const generated = path.join(root, 'generated');
  const trace = path.join(root, 'trace');
  const counter = path.join(root, 'counter');
  const failOn = path.join(root, 'fail-on');
  const snapshot = path.join(root, 'snapshot');
  const run = path.join(root, 'run');

  fs.writeFileSync(input, 'alpha\n');
  fs.writeFileSync(failOn, '2\n');

  writeExecutable(snapshot, `#!/usr/bin/env node
const crypto=require('node:crypto');
const fs=require('node:fs');
const parts=[];
for(const file of [process.env.WATCH_INPUT, process.env.WATCH_GENERATED]){
  if(fs.existsSync(file)) parts.push(file+'\\0'+fs.readFileSync(file));
  else parts.push(file+'\\0<missing>');
}
if(process.env.SNAPSHOT_FAIL_FILE && fs.existsSync(process.env.SNAPSHOT_FAIL_FILE)) process.exit(9);
process.stdout.write(crypto.createHash('sha256').update(parts.join('\\0')).digest('hex')+'\\n');
`);

  writeExecutable(run, `#!/bin/sh
count=0
[ ! -f "$WATCH_COUNTER" ] || count=$(cat "$WATCH_COUNTER")
count=$((count + 1))
printf '%s\\n' "$count" > "$WATCH_COUNTER"
printf '%s:%s\\n' "$count" "$RUMIAI_POC_WATCH_REASON" >> "$WATCH_TRACE"
printf 'generated-%s\\n' "$count" > "$WATCH_GENERATED"
if [ -f "$WATCH_FAIL_ON" ] && [ "$(cat "$WATCH_FAIL_ON")" = "$count" ]
then
  exit 7
fi
exit 0
`);

  const env = {
    ...process.env,
    RUMIAI_POC_WATCH_SNAPSHOT: snapshot,
    RUMIAI_POC_WATCH_RUN: run,
    WATCH_INPUT: input,
    WATCH_GENERATED: generated,
    WATCH_TRACE: trace,
    WATCH_COUNTER: counter,
    WATCH_FAIL_ON: failOn
  };

  const child = childProcess.spawn(process.execPath, [supervisor, '--interval-ms', '30', '--max-runs', '3'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  await waitFor(() => lines(trace).length === 1, 'initial watch cycle did not run');
  assert(lines(trace)[0] === '1:initial', 'initial cycle reason is wrong');

  const beforeTouch = lines(trace).length;
  const now = new Date();
  fs.utimesSync(input, now, now);
  await sleep(180);
  assert(lines(trace).length === beforeTouch, 'mtime-only change triggered a cycle');

  fs.writeFileSync(input, 'beta\n');
  await waitFor(() => lines(trace).length === 2, 'content change did not trigger second cycle');
  assert(lines(trace)[1] === '2:change', 'second cycle reason is wrong');

  await sleep(220);
  assert(lines(trace).length === 2, 'failed cycle or generated output caused busy/self-trigger loop');
  assert(stderr.includes('cycle failed with status 7'), 'failed cycle was not reported');

  fs.writeFileSync(input, 'gamma\n');
  await waitFor(() => lines(trace).length === 3, 'later change did not trigger after failed cycle');

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  assert(status.signal === null && status.code === 0, `main watch session exited unexpectedly: ${JSON.stringify(status)}`);
  assert(lines(trace).join(',') === '1:initial,2:change,3:change', 'main watch cycle trace is incorrect');
}

async function runSnapshotFailureScenario(root, supervisor) {
  const trace = path.join(root, 'snapshot-failure-trace');
  const fail = path.join(root, 'snapshot-fail');
  const snapshot = path.join(root, 'snapshot-failure-snapshot');
  const run = path.join(root, 'snapshot-failure-run');

  writeExecutable(snapshot, `#!/bin/sh
[ ! -f "$SNAPSHOT_FAIL_FILE" ] || exit 9
printf 'stable\\n'
`);
  writeExecutable(run, `#!/bin/sh
printf 'run\\n' >> "$WATCH_TRACE"
`);

  const child = childProcess.spawn(process.execPath, [supervisor, '--interval-ms', '30'], {
    env: {
      ...process.env,
      RUMIAI_POC_WATCH_SNAPSHOT: snapshot,
      RUMIAI_POC_WATCH_RUN: run,
      SNAPSHOT_FAIL_FILE: fail,
      WATCH_TRACE: trace
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  await waitFor(() => lines(trace).length === 1, 'snapshot-failure scenario initial cycle did not run');
  await sleep(80);
  fs.writeFileSync(fail, 'fail\n');

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  assert(status.signal === null && status.code === 1, 'snapshot failure did not terminate session with status 1');
  assert(stderr.includes('snapshot command failed with status 9'), 'snapshot failure diagnostic is missing');
  assert(lines(trace).length === 1, 'snapshot failure incorrectly started another lifecycle cycle');
}

async function runSignalScenario(root, supervisor) {
  const active = path.join(root, 'signal-active');
  const forwarded = path.join(root, 'signal-forwarded');
  const snapshot = path.join(root, 'signal-snapshot');
  const run = path.join(root, 'signal-run');

  writeExecutable(snapshot, `#!/bin/sh
printf 'stable\\n'
`);
  writeExecutable(run, `#!/bin/sh
trap 'printf forwarded > "$SIGNAL_FORWARDED"; exit 143' TERM
printf active > "$SIGNAL_ACTIVE"
while :
do
  sleep 1
done
`);

  const child = childProcess.spawn(process.execPath, [supervisor, '--interval-ms', '30'], {
    env: {
      ...process.env,
      RUMIAI_POC_WATCH_SNAPSHOT: snapshot,
      RUMIAI_POC_WATCH_RUN: run,
      SIGNAL_ACTIVE: active,
      SIGNAL_FORWARDED: forwarded
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  await waitFor(() => fs.existsSync(active), 'signal scenario child did not become active');
  child.kill('SIGTERM');

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  assert(status.signal === null && status.code === 143, `watch supervisor did not exit 143 after SIGTERM: ${JSON.stringify(status)}`);
  assert(fs.existsSync(forwarded), 'SIGTERM was not forwarded to active child');
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc020-'));
  try {
    const supervisor = path.resolve(__dirname, '..', 'watch-session.js');
    await runMainScenario(root, supervisor);
    await runSnapshotFailureScenario(root, supervisor);
    await runSignalScenario(root, supervisor);
    process.stdout.write('PASS PoC 020 mk watch session\n');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => {
  process.stderr.write(`FAIL PoC 020: ${error.message}\n`);
  process.exitCode = 1;
});
