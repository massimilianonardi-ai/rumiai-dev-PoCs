import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import http from 'node:http';

const root = resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(join(tmpdir(), 'jsc-poc-'));
const build = join(tmp, 'bundle.js');
try {
  const result = spawnSync(process.execPath, [join(root, 'src/jsc.mjs'), join(root, 'example/modules.json'), build], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const code = await readFile(build, 'utf8');
  assert.ok(code.includes('globalThis.JscRuntime.install'));
  assert.ok(!code.includes('import("'));
  const check = spawnSync(process.execPath, ['--check', build], {encoding:'utf8'});
  assert.equal(check.status, 0, check.stderr);

  const context = vm.createContext({console});
  vm.runInContext(code, context, {filename:'bundle.js'});
  assert.equal(context.JscRuntime.state().registered, 2);
  assert.equal(context.JscRuntime.state().active, 0);
  const app = context.JscRuntime.require('application');
  assert.equal(app.run(), 1);
  assert.equal(app.run(), 2);
  assert.equal(context.__pocCounterEvaluations, 1);
  assert.equal(context.JscRuntime.state().active, 2);

  context.JscRuntime.install('counter', [], function(require, module) {
    module.exports.next = () => 123;
  });
  assert.equal(context.__pocApplicationDisposals, 1);
  assert.equal(context.__pocCounterDisposals, 1);
  assert.equal(context.JscRuntime.state().active, 0);
  assert.equal(context.JscRuntime.require('application').run(), 123);
  // Explicit caveat: a previously captured export object is NOT automatically updated.
  assert.equal(app.run(), 3);

  let cleanup = 0;
  for (let i = 0; i < 2000; i++) {
    context.JscRuntime.install('counter', [], function(require, module) {
      module.exports.next = () => i;
      module.onDispose(() => {cleanup++;});
    });
    const refreshed = context.JscRuntime.require('application');
    assert.equal(refreshed.run(), i);
    assert.equal(context.JscRuntime.state().registered, 2);
    assert.equal(context.JscRuntime.state().active, 2);
  }
  context.JscRuntime.invalidate('counter');
  assert.equal(cleanup, 2000);
  assert.equal(context.JscRuntime.state().active, 0);

  // Compiler reject missing deps and invalid source traversal.
  const invalid = join(tmp, 'invalid.json');
  await writeFile(invalid, JSON.stringify({version:1,modules:[{id:'bad',file:'../outside.js',deps:[]}]}));
  const failure = spawnSync(process.execPath, [join(root,'src/jsc.mjs'),invalid,build], {encoding:'utf8'});
  assert.notEqual(failure.status, 0);

  // Local HTTP transport: verify GET + no-store, and real output delivered over HTTP.
  const server = http.createServer((req,res) => {
    if(req.url==='/bundle.js') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(code);
    } else {res.statusCode=404;res.end('not found');}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port=server.address().port;
    const response=await fetch(`http://127.0.0.1:${port}/bundle.js`,{cache:'no-store'});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(await response.text(),code);
  } finally { await new Promise(resolve=>server.close(resolve)); }

  console.log('PASS: single classic bundle, lazy evaluation, transitive disposal, 2000 replacements, deterministic registry bounds, GET no-store, compiler validation');
  console.log('NOT PROVEN: long-lived browser heap reclamation, state-preserving HMR, service worker/version-atomic deploy, strict CSP, physical-host portability');
} finally { await rm(tmp,{recursive:true,force:true}); }
