'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function token() {
  return process.pid + '-' + crypto.randomBytes(12).toString('hex');
}

function pause(marker, waitFile) {
  if (marker) {
    fs.mkdirSync(path.dirname(marker), {recursive: true, mode: 0o700});
    fs.writeFileSync(marker, 'ready\n', {mode: 0o600});
  }
  if (!waitFile) return;
  const start = Date.now();
  while (!fs.existsSync(waitFile)) {
    if (Date.now() - start > 15000) throw new Error('maintenance synchronization timeout');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

function leaseDirectory(root, kind) {
  return path.join(root, '.' + kind + '-leases');
}

function leaseAcquire(directory, value) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const temporary = path.join(directory, '.prep-' + value);
  const published = path.join(directory, value);
  let fd = null;
  try {
    const result = childProcess.spawnSync('mkfifo', [temporary], {encoding: 'utf8'});
    if (result.error || result.status !== 0) throw new Error('cannot create POSIX FIFO activity token');
    fs.chmodSync(temporary, 0o600);
    fd = fs.openSync(temporary, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    fs.renameSync(temporary, published);
    return {path: published, token: value, fd};
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (closeError) {}
    }
    try { fs.unlinkSync(temporary); } catch (unlinkError) {}
    try { fs.unlinkSync(published); } catch (unlinkError) {}
    throw error;
  }
}

function leaseRelease(lease) {
  if (!lease) return;
  try { fs.unlinkSync(lease.path); } catch (error) {}
  try { fs.closeSync(lease.fd); } catch (error) {}
}

function leaseState(leasePath) {
  try {
    const stat = fs.lstatSync(leasePath);
    if (!stat.isFIFO()) return 'unknown';
    const fd = fs.openSync(leasePath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    fs.closeSync(fd);
    return 'live';
  } catch (error) {
    if (error && error.code === 'ENOENT') return 'missing';
    if (error && error.code === 'ENXIO') return 'stale';
    return 'unknown';
  }
}

function liveLeases(directory, exceptPath = null) {
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    return [];
  }
  const live = [];
  for (const name of names) {
    const leasePath = path.join(directory, name);
    if (leasePath === exceptPath) continue;
    if (name.startsWith('.prep-')) {
      try { fs.unlinkSync(leasePath); } catch (error) {}
      continue;
    }
    const state = leaseState(leasePath);
    if (state === 'stale') {
      try { fs.unlinkSync(leasePath); } catch (error) {}
      continue;
    }
    if (state === 'live' || state === 'unknown') live.push(leasePath);
  }
  return live;
}

function candidateNameValid(value) {
  return /^[a-f0-9]{64}(?:-[a-z0-9-]+)?$/.test(value);
}

function readCurrent(root) {
  const current = path.join(root, 'current');
  try {
    const stat = fs.lstatSync(current);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = fs.readFileSync(current, 'utf8').trim();
    return candidateNameValid(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function candidateNames(root) {
  const dir = path.join(root, 'candidates');
  try {
    return fs.readdirSync(dir).filter(candidateNameValid).sort();
  } catch (error) {
    return [];
  }
}

function reclaimCandidate(root, candidate) {
  const source = path.join(root, 'candidates', candidate);
  const reclaim = path.join(root, '.reclaim');
  fs.mkdirSync(reclaim, {recursive: true, mode: 0o700});
  const retired = path.join(reclaim, candidate + '-' + token());
  try {
    fs.renameSync(source, retired);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
  fs.rmSync(retired, {recursive: true, force: true});
  return true;
}

function cleanupAttemptResidue(root) {
  const leases = leaseDirectory(root, 'attempt');
  let names = [];
  try { names = fs.readdirSync(root); } catch (error) {}
  const removed = [];
  for (const name of names) {
    if (!name.startsWith('.staging-')) continue;
    const attempt = name.slice('.staging-'.length);
    const leasePath = path.join(leases, attempt);
    const state = leaseState(leasePath);
    if (state === 'live' || state === 'unknown') continue;
    fs.rmSync(path.join(root, name), {recursive: true, force: true});
    if (state === 'stale') {
      try { fs.unlinkSync(leasePath); } catch (error) {}
    }
    removed.push(name);
  }
  liveLeases(leases);
  return removed;
}

function cleanupSelectorTemps(root) {
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch (error) {}
  for (const name of names) {
    if (!name.startsWith('.current-')) continue;
    try {
      fs.unlinkSync(path.join(root, name));
      removed.push(name);
    } catch (error) {}
  }
  return removed;
}

function maintain(root, mode) {
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  const maintenance = leaseAcquire(leaseDirectory(root, 'maintenance'), token());
  try {
    liveLeases(leaseDirectory(root, 'maintenance'), maintenance.path);
    pause(process.env.RUMIAI_POC_MAINTENANCE_LEASE_MARKER, process.env.RUMIAI_POC_MAINTENANCE_LEASE_WAIT);

    const publications = liveLeases(leaseDirectory(root, 'publication'));
    if (publications.length > 0) {
      return {state: 'blocked-publication', publications, reclaimed: [], stagingRemoved: [], selectorTempsRemoved: []};
    }

    const stagingRemoved = cleanupAttemptResidue(root);
    const selectorTempsRemoved = cleanupSelectorTemps(root);

    let current = readCurrent(root);
    let retiredSelector = null;
    if (mode === 'evict' && current !== null) {
      retiredSelector = path.join(root, '.retired-current-' + token());
      try {
        fs.renameSync(path.join(root, 'current'), retiredSelector);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
      current = null;
    }

    const reclaimed = [];
    for (const candidate of candidateNames(root)) {
      if (candidate === current) continue;
      if (reclaimCandidate(root, candidate)) reclaimed.push(candidate);
    }

    if (retiredSelector !== null) {
      try { fs.unlinkSync(retiredSelector); } catch (error) {}
    }
    return {state: 'ok', reclaimed, selected: current, stagingRemoved, selectorTempsRemoved};
  } finally {
    leaseRelease(maintenance);
  }
}

function main() {
  const mode = process.argv[2];
  const root = process.argv[3];
  if ((mode !== 'sweep' && mode !== 'evict') || !root) {
    process.stderr.write('usage: node maintenance.js <sweep|evict> <fingerprint-root>\n');
    return 2;
  }
  const result = maintain(path.resolve(root), mode);
  process.stdout.write(JSON.stringify(result) + '\n');
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`maintenance: ${error.message}\n`);
  process.exitCode = 1;
}
