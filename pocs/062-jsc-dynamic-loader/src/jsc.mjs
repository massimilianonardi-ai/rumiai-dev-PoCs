#!/usr/bin/env node
// Experimental classic-JS compiler. Deliberately NOT an ES Module compiler.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { argv } from 'node:process';
import { Script } from 'node:vm';

function fail(message) { throw new Error(message); }
function moduleId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9._/-]*$/.test(value) || value.includes('..')) {
    fail('invalid module id: ' + String(value));
  }
  return value;
}

function checkGraph(entries) {
  const graph = new Map(entries.map(e => [e.id, e.deps]));
  for (const e of entries) {
    for (const dep of e.deps) if (!graph.has(dep)) fail(`${e.id}: missing dependency ${dep}`);
  }
  const done = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(`circular module dependencies involving ${id}`);
    if (done.has(id)) return;
    visiting.add(id);
    for (const dep of graph.get(id)) visit(dep);
    visiting.delete(id);
    done.add(id);
  }
  for (const e of entries) visit(e.id);
}

async function main() {
  if (argv.length !== 4) fail('usage: node src/jsc.mjs manifest.json output.js');
  const manifestPath = resolve(argv[2]);
  const manifestRoot = await realpath(dirname(manifestPath));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.modules) || Object.keys(manifest).some(k => !['version', 'modules'].includes(k))) {
    fail('unsupported manifest format');
  }
  const ids = new Set();
  const entries = [];
  for (const entry of manifest.modules) {
    if (!entry || Array.isArray(entry) || Object.keys(entry).some(k => !['id', 'file', 'deps', 'format'].includes(k))) fail('invalid module record');
    const id = moduleId(entry.id);
    if (ids.has(id)) fail('duplicate module id: ' + id);
    ids.add(id);
    if (entry.format !== undefined && entry.format !== 'classic') {
      fail(`${id}: unsupported source format ${JSON.stringify(entry.format)}; jsc only accepts classic modules, not ES Modules`);
    }
    if (typeof entry.file !== 'string' || !entry.file || isAbsolute(entry.file)) fail('invalid module file');
    if (!Array.isArray(entry.deps)) fail(`${id}: deps must be an array`);
    const deps = entry.deps.map(moduleId);
    if (deps.includes(id) || new Set(deps).size !== deps.length) fail(`${id}: invalid module dependency list`);
    const filePath = await realpath(resolve(manifestRoot, entry.file));
    const rel = relative(manifestRoot, filePath);
    if (rel.startsWith('..') || isAbsolute(rel)) fail('module source must be inside manifest tree');
    const source = await readFile(filePath, 'utf8');
    // A classic factory is the user-visible source contract, not an ESM transform.
    try { new Script(`(function (require, module, exports) {\n'use strict';\n${source}\n})`, {filename: rel}); }
    catch (error) {
      fail(`${id} (${rel}): invalid classic module source: ${error.message}. ES Module import/export syntax is unsupported; use an independent ESM toolchain.`);
    }
    entries.push({ id, deps, source, path: rel });
  }
  checkGraph(entries);
  const loader = await readFile(new URL('./loader.js', import.meta.url), 'utf8');
  let result = `/* jsc experimental classic single-file bundle */\n${loader}\n`;
  for (const e of entries) {
    result += `\n/* module ${e.id}; source ${e.path.replace(/\*\//g, '* /')} */\n`;
    result += `globalThis.JscRuntime.install(${JSON.stringify(e.id)}, ${JSON.stringify(e.deps)}, function (require, module, exports) {\n'use strict';\n${e.source}\n});\n`;
  }
  new Script(result, {filename: argv[3]});
  await writeFile(resolve(argv[3]), result);
  process.stdout.write(`jsc: ${entries.length} classic modules, ${Buffer.byteLength(result)} bytes\n`);
}

main().catch(error => { console.error('jsc:', error.message); process.exitCode = 1; });
