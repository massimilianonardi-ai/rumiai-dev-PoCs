'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../render-probe.mjs');
const secret='fixture-private-chat-secret-do-not-emit';
const server=http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  if(req.url==='/ready') {
    res.end('<!doctype html><html><body><main data-scroll-root>'+
      '<section data-turn-id-container="fixture-id" data-testid="conversation-turn-1">'+
      '<article data-message-id="fixture-message">Visible turn</article>'+
      '</section></main></body></html>');
  } else {
    res.end('<!doctype html><html><body><main><p>'+
      secret+'</p></main></body></html>');
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-live-readiness-'));
const run=async(kind)=>{
  const dir=path.join(tmp,kind);
  const child=spawn(process.execPath,[script,
    'http://127.0.0.1:'+server.address().port+'/'+kind,dir,
    '--readiness-only','--headless'],{stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stdout.on('data',d=>out+=String(d));
  child.stderr.on('data',d=>err+=String(d));
  const status=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Readiness browser timeout'));},70000);
    child.once('error',reject);
    child.once('exit',code=>{clearTimeout(timeout);resolve(code);});
  });
  assert.equal(status,0,err+' '+out);
  const open=out.indexOf('{"status": "private-safe-live-share-readiness"');
  // JSON output is pretty-printed, so use brace-balance through the next
  // summary object instead of assuming one-line reports.
  const start=out.indexOf('{\n  "status": "private-safe-live-share-readiness"');
  assert(start>=0,'No sanitized readiness output: '+out);
  const ending=out.indexOf('\n}\n',start);
  assert(ending>start);
  const json=JSON.parse(out.slice(start,ending+2));
  const records=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8')
    .split('\n').filter(Boolean).map(JSON.parse);
  assert(records.some(e=>e.kind==='readiness.observed'));
  assert(!JSON.stringify(json).includes(secret));
  return json;
};
try {
  const ready=await run('ready');
  assert.equal(ready.classification,'expected-hooks-observed');
  assert(ready.finalShape.turnWrappers>0);
  assert.equal(ready.navigationCommand,'no-error');
  const none=await run('none');
  assert.equal(none.classification,'expected-hooks-never-observed');
  assert.equal(none.finalShape.readyState,'complete');
  assert.equal(none.finalShape.mainElements,1);
  assert.equal(none.finalShape.turnWrappers,0);
  assert(none.validSamples>1);
  console.log('PASS: Chromium readiness-only diagnostics distinguish complete hook presence from loaded page without turns');
}
finally{server.close();fs.rmSync(tmp,{recursive:true,force:true});}
