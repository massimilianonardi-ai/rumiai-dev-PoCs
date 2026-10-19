#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const [rootArg, ...urls] = process.argv.slice(2);
if (!rootArg || urls.length === 0) {
  process.stderr.write('usage: node capture-share-reference-set.mjs <output-root> <share-url> [share-url ...]\n');
  process.exit(2);
}
const root = path.resolve(rootArg);
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const capture = path.resolve('capture-share-reference.mjs');
const results = [];
for (const url of urls) {
  const id = new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'share';
  const log = path.join(root, id + '.log');
  const handle = await fs.open(log, 'w', 0o600);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [capture, url, root], {
      cwd: path.dirname(capture),
      stdio: ['ignore', handle.fd, handle.fd]
    });
    child.on('error', reject);
    child.on('close', resolve);
  });
  await handle.close();
  results.push({ url, id, exit_code: code, log: path.basename(log) });
}
const summary = { captured_at: new Date().toISOString(), results };
await fs.writeFile(path.join(root, 'SET-SUMMARY.json'),
  JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
