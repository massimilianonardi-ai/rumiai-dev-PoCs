'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function token() {
  return process.pid + '-' + crypto.randomBytes(8).toString('hex');
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

function publicationPins(root) {
  const dir = path.join(root, '.publication-pins');
  try {
    return fs.readdirSync(dir).filter(name => name.length > 0);
  } catch (error) {
    return [];
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

function maintain(root, mode) {
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  const marker = path.join(root, '.maintenance');
  try {
    fs.writeFileSync(marker, token() + '\n', {flag: 'wx', mode: 0o600});
  } catch (error) {
    if (error && error.code === 'EEXIST') return {state: 'blocked-maintenance', reclaimed: []};
    throw error;
  }

  let removeMarker = true;
  try {
    pause(process.env.RUMIAI_POC_MAINTENANCE_MARKER, process.env.RUMIAI_POC_MAINTENANCE_WAIT);

    const pins = publicationPins(root);
    if (pins.length > 0) return {state: 'blocked-publication', pins, reclaimed: []};

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
    return {state: 'ok', reclaimed, selected: current};
  } finally {
    if (removeMarker) {
      try { fs.unlinkSync(marker); } catch (error) {}
    }
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
