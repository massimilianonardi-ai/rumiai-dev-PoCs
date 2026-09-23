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

function lines(file) {
  if (!fs.existsSync(file)) return [];
  const value = fs.readFileSync(file, 'utf8').trim();
  return value === '' ? [] : value.split('\n').filter(Boolean);
}

function writeConfig(project, include = null) {
  const collection = {
    type: 'files',
    root: 'src',
    suffixes: ['.txt']
  };
  if (include !== null) collection.include = include;

  const config = {
    version: 2,
    goals: {build: ['compile']},
    collections: {sources: collection},
    providers: {
      compile: {
        type: 'map-process',
        collection: 'sources',
        inputs: {
          config: {path: 'build.conf'}
        },
        outputs: {
          artifact: {path: 'out/${item}.out'}
        },
        incremental: {},
        action: {
          type: 'process',
          command: 'sh',
          args: [
            '-c',
            'mkdir -p "$(dirname "$3")"; cat "$2" build.conf > "$3"; printf "%s\\n" "$2" >> trace',
            'provider-member',
            '${item}',
            'out/${item}.out'
          ]
        }
      }
    }
  };
  fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(config, null, 2) + '\n');
}

function output(project, item) {
  return path.join(project, 'out', `${item}.out`);
}

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 029: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
const candidate = path.resolve(__dirname, '..', 'candidate-engine.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc029-'));
const project = path.join(root, 'project');

function candidateRun(args) {
  return run(process.execPath, [candidate, '--project', project, ...args], {
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
}

try {
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'a.txt'), 'A1\n');
  fs.writeFileSync(path.join(project, 'src', 'b.txt'), 'B1\n');
  fs.writeFileSync(path.join(project, 'build.conf'), 'CFG1\n');
  writeConfig(project);

  let result = candidateRun(['build']);
  assert(result.status === 0, `first build failed: ${result.stderr}`);
  assert(lines(path.join(project, 'trace')).length === 2, 'first build did not run both derived members');
  assert(fs.readFileSync(output(project, 'src/a.txt'), 'utf8') === 'A1\nCFG1\n', 'a output is wrong');
  assert(fs.readFileSync(output(project, 'src/b.txt'), 'utf8') === 'B1\nCFG1\n', 'b output is wrong');

  result = candidateRun(['--plan', 'build']);
  assert(result.status === 0, `post-build plan failed: ${result.stderr}`);
  let plan = JSON.parse(result.stdout);
  const derived = plan.operations.filter(value => value.derived && value.derived.provider === 'compile');
  assert(derived.length === 2, 'provider did not expose two derived operations');
  assert(derived.every(value => value.state === 'up-to-date'), 'derived members were not up-to-date after successful build');
  assert(derived.every(value => Object.prototype.hasOwnProperty.call(value.inputs, '$item')), 'derived item identity was not injected as private input');

  result = candidateRun(['build']);
  assert(result.status === 0, `second build failed: ${result.stderr}`);
  assert(lines(path.join(project, 'trace')).length === 2, 'identical second build reran derived members');

  const a = path.join(project, 'src', 'a.txt');
  const now = new Date();
  fs.utimesSync(a, now, now);
  result = candidateRun(['build']);
  assert(result.status === 0, `mtime-only build failed: ${result.stderr}`);
  assert(lines(path.join(project, 'trace')).length === 2, 'mtime-only source change invalidated derived member');

  fs.writeFileSync(a, 'A2\n');
  result = candidateRun(['build']);
  assert(result.status === 0, `single-source rebuild failed: ${result.stderr}`);
  let trace = lines(path.join(project, 'trace'));
  assert(trace.length === 3 && trace[2] === 'src/a.txt', 'single source change did not rerun only its derived member');
  assert(fs.readFileSync(output(project, 'src/a.txt'), 'utf8') === 'A2\nCFG1\n', 'a output was not refreshed');

  fs.writeFileSync(path.join(project, 'build.conf'), 'CFG2\n');
  result = candidateRun(['build']);
  assert(result.status === 0, `common-input rebuild failed: ${result.stderr}`);
  trace = lines(path.join(project, 'trace'));
  assert(trace.length === 5, 'common provider input did not rerun all members');
  assert(new Set(trace.slice(-2)).size === 2, 'common provider input did not run both distinct members');

  fs.writeFileSync(output(project, 'src/b.txt'), 'tampered\n');
  result = candidateRun(['build']);
  assert(result.status === 0, `tampered-output rebuild failed: ${result.stderr}`);
  trace = lines(path.join(project, 'trace'));
  assert(trace.length === 6 && trace[5] === 'src/b.txt', 'tampering one derived output did not rerun only that member');

  fs.writeFileSync(path.join(project, 'src', 'c.txt'), 'C1\n');
  result = candidateRun(['build']);
  assert(result.status === 0, `added-member build failed: ${result.stderr}`);
  trace = lines(path.join(project, 'trace'));
  assert(trace.length === 7 && trace[6] === 'src/c.txt', 'adding one collection item did not run only the new member');

  fs.unlinkSync(path.join(project, 'src', 'a.txt'));
  result = candidateRun(['build']);
  assert(result.status === 0, `removed-member build failed: ${result.stderr}`);
  assert(lines(path.join(project, 'trace')).length === 7, 'removing one item invalidated unchanged reachable members');
  assert(fs.existsSync(output(project, 'src/a.txt')), 'PoC unexpectedly introduced removed-member artifact cleanup');

  writeConfig(project, ['c.txt', 'b.txt']);
  result = candidateRun(['build']);
  assert(result.status === 0, `reordered include build failed: ${result.stderr}`);
  assert(lines(path.join(project, 'trace')).length === 7, 'collection include order changed per-item freshness identity');

  const bad = path.join(root, 'bad');
  fs.mkdirSync(path.join(bad, 'src'), {recursive: true});
  fs.writeFileSync(path.join(bad, 'src', 'x.txt'), 'X\n');
  fs.writeFileSync(path.join(bad, 'mk.json'), JSON.stringify({
    version: 2,
    goals: {build: ['compile']},
    collections: {sources: {type: 'files', root: 'src'}},
    providers: {
      compile: {
        type: 'map-process',
        collection: 'sources',
        incremental: {},
        action: {type: 'process', command: 'true'}
      }
    }
  }, null, 2) + '\n');

  result = run(process.execPath, [candidate, '--project', bad, '--plan', 'build'], {
    encoding: 'utf8',
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(result.status === 1 && result.stderr.includes('incremental requires at least one declared output'), 'incremental provider without outputs was not rejected');

  process.stdout.write('PASS PoC 029 provider-level incremental templates\n');
  process.stdout.write('OBSERVED provider-cache=ordinary-derived-operation-freshness\n');
  process.stdout.write('OBSERVED provider-item-input=implicit-private\n');
  process.stdout.write('OBSERVED collection-order=identity-independent\n');
} catch (error) {
  process.stderr.write(`FAIL PoC 029: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
