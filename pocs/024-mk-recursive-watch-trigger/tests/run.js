'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function snapshot(command, targetRoot, project, goals, profile = null) {
  const args = [command, '--project', project];
  if (profile !== null) args.push('--profile', profile);
  args.push(...goals);
  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  assert(result.status === 0, `snapshot failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function snapshotFail(command, targetRoot, project, goals) {
  const result = childProcess.spawnSync(process.execPath, [command, '--project', project, ...goals], {
    encoding: 'utf8',
    env: {...process.env, RUMIAI_POC_RUMIAI_OS: targetRoot}
  });
  return result;
}

function writeProject(root, name, config, files = {}) {
  const project = path.join(root, name);
  fs.mkdirSync(project, {recursive: true});
  fs.writeFileSync(path.join(project, 'mk.json'), JSON.stringify(config, null, 2) + '\n');
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(project, relative);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content);
  }
  return project;
}

function operation(inputPath, marker = 'same-name') {
  return {
    inputs: {source: {path: inputPath}},
    action: {type: 'process', command: 'sh', args: ['-c', `printf ${marker} >/dev/null`]}
  };
}

const target = process.env.RUMIAI_POC_RUMIAI_OS;
if (!target) {
  process.stderr.write('FAIL PoC 024: RUMIAI_POC_RUMIAI_OS is required\n');
  process.exit(1);
}

const targetRoot = fs.realpathSync(target);
const command = path.resolve(__dirname, '..', 'recursive-trigger.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-poc024-'));

try {
  const c = writeProject(root, 'C', {
    version: 2,
    goals: {build: ['build']},
    operations: {build: operation('c.txt')}
  }, {'c.txt': 'c-one\n'});

  const inactive = writeProject(root, 'I', {
    version: 2,
    goals: {build: ['build']},
    operations: {build: operation('i.txt')}
  }, {'i.txt': 'i-one\n'});

  const b = writeProject(root, 'B', {
    version: 2,
    goals: {build: ['build']},
    dependencies: {
      c: {project: '../C', goals: {build: ['build']}},
      inactive: {project: '../I', goals: {other: ['build']}}
    },
    operations: {build: operation('b.txt')},
    profiles: {
      release: {
        operations: {
          build: {
            inputs: {source: {path: 'b-release.txt'}},
            action: {type: 'process', command: 'sh', args: ['-c', 'printf same-name >/dev/null']}
          }
        }
      }
    }
  }, {'b.txt': 'b-one\n', 'b-release.txt': 'b-release\n'});

  const a = writeProject(root, 'A', {
    version: 2,
    goals: {build: ['build'], release: ['build']},
    dependencies: {
      b: {
        project: '../B',
        goals: {build: ['build'], release: ['build']}
      },
      'b-release': {
        project: '../B',
        goals: {release: ['build']},
        profile: 'release'
      }
    },
    operations: {build: operation('a.txt')}
  }, {'a.txt': 'a-one\n'});

  const baseline = snapshot(command, targetRoot, a, ['build']);
  const repeated = snapshot(command, targetRoot, a, ['build']);
  assert(repeated.digest === baseline.digest, 'unchanged recursive digest is unstable');
  assert(baseline.dependencies.length === 1 && baseline.dependencies[0].name === 'b', 'inactive/direct dependency selection is incorrect');
  assert(!baseline.visits.some(value => value.project === fs.realpathSync(inactive)), 'inactive dependency was resolved');

  const cDirect = snapshot(command, targetRoot, c, ['build']);
  const bDirect = snapshot(command, targetRoot, b, ['build']);
  assert(baseline.dependencies[0].digest === bDirect.digest, 'parent did not consume the direct child opaque digest');

  const cFile = path.join(c, 'c.txt');
  const now = new Date();
  fs.utimesSync(cFile, now, now);
  assert(snapshot(command, targetRoot, a, ['build']).digest === baseline.digest, 'deep child mtime-only change altered recursive digest');

  fs.writeFileSync(cFile, 'c-two\n');
  const afterC = snapshot(command, targetRoot, a, ['build']);
  const cAfter = snapshot(command, targetRoot, c, ['build']);
  const bAfterC = snapshot(command, targetRoot, b, ['build']);
  assert(cAfter.digest !== cDirect.digest, 'C input change did not alter C digest');
  assert(bAfterC.digest !== bDirect.digest, 'C input change did not propagate to B digest');
  assert(afterC.digest !== baseline.digest, 'C input change did not propagate to A digest');
  assert(afterC.dependencies[0].digest === bAfterC.digest, 'A did not consume updated B opaque digest');

  const cStable = cAfter.digest;
  const bBeforeOwn = bAfterC.digest;
  fs.writeFileSync(path.join(b, 'b.txt'), 'b-two\n');
  const afterB = snapshot(command, targetRoot, a, ['build']);
  const bAfterOwn = snapshot(command, targetRoot, b, ['build']);
  assert(bAfterOwn.digest !== bBeforeOwn, 'B own input change did not alter B digest');
  assert(snapshot(command, targetRoot, c, ['build']).digest === cStable, 'B input change altered independent C digest');
  assert(afterB.digest !== afterC.digest, 'B input change did not propagate to A');

  const bStable = bAfterOwn.digest;
  fs.writeFileSync(path.join(a, 'a.txt'), 'a-two\n');
  const afterA = snapshot(command, targetRoot, a, ['build']);
  assert(afterA.digest !== afterB.digest, 'A own input change did not alter A digest');
  assert(snapshot(command, targetRoot, b, ['build']).digest === bStable, 'A input change altered child B digest');

  const bConfig = JSON.parse(fs.readFileSync(path.join(b, 'mk.json'), 'utf8'));
  const beforeFormatting = snapshot(command, targetRoot, a, ['build']).digest;
  fs.writeFileSync(path.join(b, 'mk.json'), JSON.stringify(bConfig, null, 6) + '\n');
  assert(snapshot(command, targetRoot, a, ['build']).digest === beforeFormatting, 'formatting-only child mk.json rewrite changed recursive digest');

  const release = snapshot(command, targetRoot, a, ['release']);
  assert(release.dependencies.length === 2, 'release goal did not activate both mapped dependency requests');
  const explicit = release.dependencies.find(value => value.name === 'b-release');
  assert(explicit && explicit.profile === 'release', 'explicit child profile was not preserved');
  const bRelease = snapshot(command, targetRoot, b, ['build'], 'release');
  assert(explicit.digest === bRelease.digest, 'parent did not consume explicitly profiled child digest');
  fs.writeFileSync(path.join(b, 'b-release.txt'), 'b-release-two\n');
  assert(snapshot(command, targetRoot, a, ['release']).digest !== release.digest, 'explicit-profile child input change did not affect parent digest');

  const d = writeProject(root, 'D', {
    version: 2,
    goals: {build: ['build']},
    operations: {build: operation('d.txt')}
  }, {'d.txt': 'd-one\n'});
  const db = writeProject(root, 'DB', {
    version: 2,
    goals: {build: ['build']},
    dependencies: {d: {project: '../D', goals: {build: ['build']}}},
    operations: {build: operation('db.txt')}
  }, {'db.txt': 'db-one\n'});
  const dc = writeProject(root, 'DC', {
    version: 2,
    goals: {build: ['build']},
    dependencies: {d: {project: '../D', goals: {build: ['build']}}},
    operations: {build: operation('dc.txt')}
  }, {'dc.txt': 'dc-one\n'});
  const da = writeProject(root, 'DA', {
    version: 2,
    goals: {build: ['build']},
    dependencies: {
      b: {project: '../DB', goals: {build: ['build']}},
      c: {project: '../DC', goals: {build: ['build']}}
    },
    operations: {build: operation('da.txt')}
  }, {'da.txt': 'da-one\n'});

  const diamond = snapshot(command, targetRoot, da, ['build']);
  const dRoot = fs.realpathSync(d);
  const dVisits = diamond.visits.filter(value => value.project === dRoot);
  assert(dVisits.length === 2, `diamond downstream project was resolved ${dVisits.length} times instead of twice`);
  assert(diamond.dependencies.every(value => typeof value.digest === 'string' && !('plan' in value)), 'parent dependency descriptor flattened child plan data');

  fs.writeFileSync(path.join(d, 'd.txt'), 'd-two\n');
  const diamondChanged = snapshot(command, targetRoot, da, ['build']);
  assert(diamondChanged.digest !== diamond.digest, 'D input change did not propagate through diamond to A');
  assert(
    diamondChanged.dependencies[0].digest !== diamond.dependencies[0].digest &&
    diamondChanged.dependencies[1].digest !== diamond.dependencies[1].digest,
    'D input change did not propagate independently through both sibling branches'
  );

  const x = writeProject(root, 'X', {
    version: 2,
    goals: {build: []},
    dependencies: {y: {project: '../Y', goals: {build: ['build']}}}
  });
  const y = writeProject(root, 'Y', {
    version: 2,
    goals: {build: []},
    dependencies: {x: {project: '../X', goals: {build: ['build']}}}
  });
  const cycle = snapshotFail(command, targetRoot, x, ['build']);
  assert(cycle.status === 1 && cycle.stderr.includes('project dependency cycle'), 'recursive trigger cycle was not rejected deterministically');

  process.stdout.write('PASS PoC 024 recursive watch trigger ownership\n');
  process.stdout.write('OBSERVED child-trigger-identity=opaque-recursive\n');
  process.stdout.write('OBSERVED diamond-downstream-resolution=per-branch\n');
} catch (error) {
  process.stderr.write(`FAIL PoC 024: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
