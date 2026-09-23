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

function requireOk(result, message) {
  assert(
    result.signal === null && result.status === 0,
    `${message}: status=${result.status} signal=${result.signal} stderr=${result.stderr}`
  );
  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, message, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
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

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 027: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
const pocRoot = path.resolve(__dirname, '..');
const supervisor = path.join(pocRoot, 'watch-session.js');
const trigger = path.resolve(pocRoot, '..', '026-mk-watch-trigger-composition', 'trigger-composition.js');
const runOnce = path.join(pocRoot, 'run-once.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc027-'));
const provider = `poc027provider${process.pid}`;
const facility = `poc027facility${process.pid}`;
let pkgStoreCreated = false;
let watchChild = null;

function baseEnv() {
  return {
    ...process.env,
    m_ROOT: targetRoot,
    PATH: `${path.join(targetRoot, 'bin', 'sys')}${path.delimiter}${process.env.PATH || ''}`
  };
}

function runM(args, env = baseEnv()) {
  return run(path.join(targetRoot, 'm'), args, {env});
}

function runPkg(args) {
  return runM([path.join(targetRoot, 'bin', 'sys', 'pkg'), ...args]);
}

function integrate(version, value) {
  const range = path.join(root, `range-${version}`);
  const payload = path.join(root, `payload-${version}`);
  fs.mkdirSync(path.join(range, 'facility-env'), {recursive: true});
  fs.mkdirSync(payload, {recursive: true});
  fs.writeFileSync(path.join(range, 'format'), 'tar.xz\n');
  fs.writeFileSync(path.join(range, 'facility'), `${facility} 21\n`);
  fs.writeFileSync(
    path.join(range, 'facility-env', facility),
    `POC027_VALUE\tliteral ${value}\n`
  );
  fs.writeFileSync(path.join(payload, 'marker'), `${value}\n`);
  requireOk(
    runM([path.join(root, 'integration-driver'), provider, String(version), range, payload]),
    `cannot integrate provider version ${version}`
  );
}

function cleanup() {
  if (watchChild !== null && watchChild.exitCode === null) {
    try { watchChild.kill('SIGTERM'); } catch (error) {}
  }
  try { runPkg(['provider', 'default', '-u', '--', facility]); } catch (error) {}
  try { runPkg(['default', '-u', '--', provider]); } catch (error) {}
  try { runPkg(['uninstall', `${provider}@2`]); } catch (error) {}
  try { runPkg(['uninstall', `${provider}@1`]); } catch (error) {}
  if (pkgStoreCreated) {
    try { fs.rmdirSync(path.join(targetRoot, 'pkg')); } catch (error) {}
  }
  fs.rmSync(root, {recursive: true, force: true});
}

(async () => {
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

    integrate(1, 'one');
    integrate(2, 'two');
    requireOk(runPkg(['default', `${provider}@1`]), 'cannot select provider package default v1');
    requireOk(runPkg(['provider', 'default', facility, provider]), 'cannot select unversioned facility default');

    const project = path.join(root, 'project');
    fs.mkdirSync(project);
    const trace = path.join(project, 'trace');
    const projectConfig = {
      version: 2,
      goals: {build: ['show-env']},
      operations: {
        'show-env': {
          action: {
            type: 'process',
            command: 'sh',
            args: ['-c', 'printf "%s:%s\\n" "$RUMIAI_POC_WATCH_REASON" "$POC027_VALUE" >> "$POC027_TRACE"']
          }
        }
      }
    };
    fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(projectConfig, null, 2) + '\n');

    const snapshotTrace = path.join(root, 'snapshot-trace');
    const supervisorTrace = path.join(root, 'supervisor-env');

    const snapshotWrapper = path.join(root, 'snapshot-wrapper');
    const runWrapper = path.join(root, 'run-wrapper');
    const supervisorWrapper = path.join(root, 'supervisor-wrapper');
    const probeWrapper = path.join(root, 'probe-wrapper');

    writeExecutable(snapshotWrapper, `#!/usr/bin/env m
printf '%s\\n' "$POC027_VALUE" >> "$POC027_SNAPSHOT_TRACE"
exec "$POC027_HOST_NODE" "$POC027_TRIGGER" --project "$POC027_PROJECT" build
`);
    writeExecutable(runWrapper, `#!/usr/bin/env m
exec "$POC027_HOST_NODE" "$POC027_RUN_ONCE"
`);
    writeExecutable(supervisorWrapper, `#!/usr/bin/env m
exec "$POC027_HOST_NODE" "$POC027_SUPERVISOR" "$@"
`);
    writeExecutable(probeWrapper, `#!/usr/bin/env m
printf '%s\\n' "$POC027_VALUE"
`);

    const env = {
      ...baseEnv(),
      RUMIAI_POC_RUMIAI_OS: targetRoot,
      RUMIAI_POC_WATCH_BOOTSTRAP: path.join(targetRoot, 'm'),
      RUMIAI_POC_WATCH_SNAPSHOT: snapshotWrapper,
      RUMIAI_POC_WATCH_RUN: runWrapper,
      RUMIAI_POC_WATCH_SUPERVISOR_ENV_FILE: supervisorTrace,
      POC027_HOST_NODE: process.execPath,
      POC027_TRIGGER: trigger,
      POC027_RUN_ONCE: runOnce,
      POC027_SUPERVISOR: supervisor,
      POC027_PROJECT: project,
      POC027_TRACE: trace,
      POC027_SNAPSHOT_TRACE: snapshotTrace
    };

    const firstProbe = requireOk(runM([probeWrapper], env), 'initial fresh-bootstrap probe failed');
    assert(firstProbe.stdout.trim() === 'one', `initial fresh bootstrap saw ${JSON.stringify(firstProbe.stdout.trim())} instead of one`);

    watchChild = childProcess.spawn(
      path.join(targetRoot, 'm'),
      [supervisorWrapper, '--interval-ms', '35', '--max-runs', '2'],
      {env, stdio: ['ignore', 'ignore', 'pipe']}
    );
    let stderr = '';
    watchChild.stderr.on('data', chunk => { stderr += chunk; });

    await waitFor(() => lines(trace).length === 1, 'initial watch lifecycle cycle did not run');
    assert(lines(trace)[0] === 'initial:one', `initial lifecycle child did not see v1 bootstrap environment: ${lines(trace).join(',')}`);
    await waitFor(() => lines(supervisorTrace).length >= 2, 'supervisor environment evidence was not written');
    assert(
      lines(supervisorTrace).every(line => line.endsWith(':one')),
      `supervisor did not start/stay in v1 environment before transition: ${lines(supervisorTrace).join(',')}`
    );

    requireOk(runPkg(['default', `${provider}@2`]), 'cannot move provider package default to v2');

    const secondProbe = requireOk(runM([probeWrapper], env), 'post-transition fresh-bootstrap probe failed');
    assert(secondProbe.stdout.trim() === 'two', `new bootstrap did not observe v2 environment: ${JSON.stringify(secondProbe.stdout.trim())}`);

    await waitFor(() => lines(trace).length === 2, 'provider environment transition did not trigger second lifecycle cycle');
    assert(
      lines(trace).join(',') === 'initial:one,change:two',
      `fresh-bootstrap lifecycle trace is incorrect: ${lines(trace).join(',')}`
    );

    const status = await new Promise((resolve, reject) => {
      watchChild.once('error', reject);
      watchChild.once('exit', (code, signal) => resolve({code, signal}));
    });
    watchChild = null;
    assert(status.signal === null && status.code === 0, `watch supervisor exited unexpectedly: ${JSON.stringify(status)} stderr=${stderr}`);

    const supervisorValues = lines(supervisorTrace);
    assert(
      supervisorValues.length >= 3 && supervisorValues.every(line => line.endsWith(':one')),
      `long-lived supervisor environment changed retroactively: ${supervisorValues.join(',')}`
    );

    const snapshotValues = lines(snapshotTrace);
    assert(snapshotValues.includes('one'), 'fresh trigger child never observed provider v1 environment');
    assert(snapshotValues.includes('two'), 'fresh trigger child never observed provider v2 environment');

    process.stdout.write('PASS PoC 027 mk watch fresh-bootstrap supervision\n');
    process.stdout.write('OBSERVED supervisor-environment=stable-old-bootstrap\n');
    process.stdout.write('OBSERVED trigger-environment=fresh-bootstrap\n');
    process.stdout.write('OBSERVED lifecycle-environment=fresh-bootstrap\n');
  } finally {
    cleanup();
  }
})().catch(error => {
  process.stderr.write(`FAIL PoC 027: ${error.message}\n`);
  process.exitCode = 1;
});
