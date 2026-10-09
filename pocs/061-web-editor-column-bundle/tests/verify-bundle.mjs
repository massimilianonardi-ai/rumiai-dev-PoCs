import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('dist');
const entry = resolve(dist, 'editor.js');
assert.ok(existsSync(entry), 'browser JS bundle must exist');
assert.deepEqual(readdirSync(dist).sort(), ['editor.js'], 'distribution must contain only one file');
const code = readFileSync(entry, 'utf8');
assert.ok(code.length > 1000, 'bundle must be nonempty');
assert.match(code, /EditorPoC/, 'bundle must expose the embeddable API');
execFileSync(process.execPath, ['--check', entry], { stdio: 'inherit' });
console.log('PASS: single JavaScript artifact and syntax');
