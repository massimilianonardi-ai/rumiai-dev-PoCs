'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const candidate = path.resolve(__dirname, '..', 'candidate-mk.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc017-'));
process.on('exit', () => fs.rmSync(tmp, {recursive: true, force: true}));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeProject(name, config) {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, {recursive: true});
  fs.writeFileSync(path.join(root, 'mk.json'), `${JSON.stringify(config, null, 2)}\n`);
  return root;
}

function run(project, args, extraEnv = {}) {
  return childProcess.spawnSync(process.execPath, [candidate, '--project', project, ...args], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, extraEnv)
  });
}

function lines(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
}

const C = writeProject('C', {
  version: 2,
  goals: {assemble: []}
});
const B = writeProject('B', {
  version: 2,
  goals: {compile: [], verify: []},
  dependencies: {
    c: {project: '../C', goals: {compile: ['assemble']}}
  }
});
const A = writeProject('A', {
  version: 2,
  goals: {build: [], check: []},
  dependencies: {
    b: {project: '../B', goals: {build: ['compile'], check: ['verify']}}
  }
});

const trace = path.join(tmp, 'trace');
let result = run(A, ['build'], {RUMIAI_MK_POC_TRACE: trace});
assert(result.status === 0, `nested execution failed: ${result.stderr}`);
assert(JSON.stringify(lines(trace)) === JSON.stringify([
  'C goals=assemble profile=-',
  'B goals=compile profile=-',
  'A goals=build profile=-'
]), 'nested delegation did not execute child projects before their parent');

fs.rmSync(trace, {force: true});
result = run(A, ['build', 'check'], {RUMIAI_MK_POC_TRACE: trace});
assert(result.status === 0, `multi-goal execution failed: ${result.stderr}`);
assert(JSON.stringify(lines(trace)) === JSON.stringify([
  'C goals=assemble profile=-',
  'B goals=compile,verify profile=-',
  'A goals=build,check profile=-'
]), 'parent goals were not unioned into one child request');

fs.rmSync(trace, {force: true});
result = run(A, ['--profile', 'parent-release', 'build'], {RUMIAI_MK_POC_TRACE: trace});
assert(result.status === 0, `parent-profile execution failed: ${result.stderr}`);
assert(lines(trace)[0] === 'C goals=assemble profile=-', 'profile leaked transitively to grandchild');
assert(lines(trace)[1] === 'B goals=compile profile=-', 'parent profile leaked implicitly to child');
assert(lines(trace)[2] === 'A goals=build profile=parent-release', 'parent profile was not retained locally');

const P = writeProject('P', {
  version: 2,
  goals: {build: []},
  dependencies: {
    b: {project: '../B', profile: 'release', goals: {build: ['compile']}}
  }
});
fs.rmSync(trace, {force: true});
result = run(P, ['build'], {RUMIAI_MK_POC_TRACE: trace});
assert(result.status === 0, `explicit child-profile execution failed: ${result.stderr}`);
assert(lines(trace)[1] === 'B goals=compile profile=release', 'explicit dependency profile was not propagated');

fs.rmSync(trace, {force: true});
result = run(A, ['--plan', 'build'], {RUMIAI_MK_POC_TRACE: trace});
assert(result.status === 0, `nested plan failed: ${result.stderr}`);
assert(!fs.existsSync(trace), '--plan performed execution');
const plan = JSON.parse(result.stdout);
assert(plan.project === A && plan.goals[0] === 'build', 'parent plan identity is wrong');
assert(plan.dependencies.length === 1 && plan.dependencies[0].goals[0] === 'compile', 'parent plan omitted child request');
assert(plan.dependencies[0].plan.project === B, 'child plan is not nested');
assert(plan.dependencies[0].plan.dependencies[0].plan.project === C, 'grandchild plan is not nested');

const X = writeProject('X', {
  version: 2,
  goals: {build: []},
  dependencies: {y: {project: '../Y', goals: {build: ['build']}}}
});
const Y = writeProject('Y', {
  version: 2,
  goals: {build: []},
  dependencies: {x: {project: '../X', goals: {build: ['build']}}}
});
result = run(X, ['build']);
assert(result.status !== 0, 'project cycle unexpectedly succeeded');
assert((result.stderr || '').includes('project dependency cycle'), 'cycle failure did not identify the dependency cycle');

const Broken = writeProject('Broken', {
  version: 2,
  goals: {ok: []}
});
const ParentBroken = writeProject('ParentBroken', {
  version: 2,
  goals: {build: []},
  dependencies: {broken: {project: '../Broken', goals: {build: ['missing']}}}
});
result = run(ParentBroken, ['build']);
assert(result.status !== 0, 'child failure did not propagate to parent');

process.stdout.write('PASS PoC 017 recursive mk dependency delegation\n');
