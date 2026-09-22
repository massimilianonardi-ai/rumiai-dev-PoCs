'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc018-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
const candidate = path.resolve(__dirname, '..', 'candidate-mk.js');
const state = path.join(root, 'resolver-state');
const calls = path.join(root, 'resolver-calls');
const trace = path.join(root, 'trace');

function assert(condition, message) { if (!condition) throw new Error(message); }
function write(file, content, mode) { fs.writeFileSync(file, content); if (mode) fs.chmodSync(file, mode); }

const resolver = path.join(root, 'resolver');
write(resolver, `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
facility=$1
shift
case "$facility:$*" in
  java:\\>=21\\ \\<26) [ "$(cat "$STATE" 2>/dev/null)" = java25 ] || exit 1; printf '%s\\n' temurin@25 ;;
  c-compiler:=1) [ "$(cat "$STATE" 2>/dev/null)" = compiler ] || exit 1; printf '%s\\n' clang@1 ;;
  *) exit 1 ;;
esac
`, 0o700);

function run(project, args) {
  return childProcess.spawnSync(process.execPath, [candidate, '--project', project, ...args], {
    encoding: 'utf8',
    env: {...process.env, RUMIAI_MK_POC_REQUIREMENT_RESOLVER: resolver, STATE: state, CALLS: calls, TRACE: trace}
  });
}

function project(name, config) {
  const dir = path.join(root, name); fs.mkdirSync(dir); write(path.join(dir, 'mk.json'), `${JSON.stringify(config, null, 2)}\n`); return dir;
}

const p = project('p', {
  version: 2,
  goals: {docs: ['docs'], build: ['compile'], generated: ['generate', 'provider']},
  requirements: {
    java21: {type: 'facility', facility: 'java', constraints: ['>=21', '<26']},
    cc: {type: 'facility', facility: 'c-compiler', constraints: ['=1']}
  },
  operations: {
    docs: {action: {type: 'process', command: 'sh', args: ['-c', 'printf docs >> "$TRACE"']}},
    prepare: {action: {type: 'process', command: 'sh', args: ['-c', 'printf java25 > "$STATE"; printf prepare >> "$TRACE"']}},
    compile: {prerequisites: ['prepare'], requirements: ['java21'], action: {type: 'process', command: 'sh', args: ['-c', 'printf compile >> "$TRACE"']}},
    generate: {action: {type: 'process', command: 'sh', args: ['-c', 'printf compiler > "$STATE"; printf generate >> "$TRACE"']}}
  },
  providers: {
    provider: {prerequisites: ['generate'], requirements: ['cc'], action: {type: 'process', command: 'sh', args: ['-c', 'printf provider >> "$TRACE"']}}
  }
});

let result = run(p, ['docs']);
assert(result.status === 0, `docs failed: ${result.stderr}`);
assert(fs.readFileSync(trace, 'utf8') === 'docs', 'docs action did not run');
assert(!fs.existsSync(calls) || fs.readFileSync(calls, 'utf8').trim() === '', 'unreachable requirements were resolved');

fs.rmSync(trace, {force: true}); fs.rmSync(calls, {force: true}); fs.rmSync(state, {force: true});
result = run(p, ['--plan', 'build']);
assert(result.status === 0, `plan failed: ${result.stderr}`);
assert(!fs.existsSync(trace), '--plan executed actions');
const plan = JSON.parse(result.stdout);
assert(plan.requirements.length === 1 && plan.requirements[0].name === 'java21', 'plan did not limit requirements to reachable lifecycle');
assert(plan.requirements[0].state === 'unsatisfied', 'plan did not expose unsatisfied requirement');
assert(plan.nodes.find(x => x.name === 'compile').state === 'blocked', 'unsatisfied requirement did not block consumer');

fs.rmSync(calls, {force: true});
result = run(p, ['build']);
assert(result.status === 0, `refined build failed: ${result.stderr}`);
assert(fs.readFileSync(trace, 'utf8') === 'preparecompile', 'prerequisite did not run before requirement re-resolution/consumer');
const javaCalls = fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
assert(javaCalls.length >= 2, 'requirement was not re-resolved after prerequisite changed external state');

fs.rmSync(trace, {force: true}); fs.rmSync(calls, {force: true}); fs.rmSync(state, {force: true});
result = run(p, ['generated']);
assert(result.status === 0, `provider requirement refinement failed: ${result.stderr}`);
assert(fs.readFileSync(trace, 'utf8') === 'generateprovider', 'provider requirement did not wait for prerequisite and re-resolve');

const bad = project('bad', {
  version: 2,
  goals: {build: ['compile']},
  requirements: {java21: {type: 'facility', facility: 'java', constraints: ['>=21', '<26']}},
  operations: {compile: {requirements: ['java21'], action: {type: 'process', command: 'sh', args: ['-c', 'exit 99']}}}
});
fs.rmSync(state, {force: true});
result = run(bad, ['build']);
assert(result.status === 1 && result.stderr.includes('unsatisfied requirement'), 'unsatisfied requirement did not fail before action');

process.stdout.write('PASS PoC 018 mk facility requirements\n');
