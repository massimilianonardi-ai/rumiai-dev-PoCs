'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectSameSessionImageUrls} from '../../inspect-image-capture.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(base, 'render-probe.mjs');
const page = '<!doctype html><html><head><style>' +
  'body{margin:0}[data-scroll-root]{height:480px;overflow-y:auto}' +
  '[data-turn-id-container]{height:280px;border:1px solid gray}' +
  '</style></head><body><main data-scroll-root></main><script src="/fixture.js"></script></body></html>';
const app = [
  "const root=document.querySelector('[data-scroll-root]');",
  "const observer=new IntersectionObserver(entries=>{",
  "  for(const entry of entries){",
  "    const turn=entry.target;",
  "    turn.setAttribute('data-is-intersecting', String(entry.isIntersecting));",
  "    const markup=entry.isIntersecting ?",
  "      '<article data-message-id=\"message-'+turn.dataset.turnIdContainer+'\"><p>Rendered turn</p></article>' : '';",
  "    if(turn.innerHTML!==markup)turn.innerHTML=markup;",
  "  }",
  "},{root,rootMargin:'200px 0px 200px 0px',threshold:0});",
  "for(let i=0;i<16;i++){",
  "  const turn=document.createElement('section');",
  "  turn.dataset.turnIdContainer='turn-'+i;",
  "  root.append(turn);observer.observe(turn);",
  "}",
  "const imageTurn=document.createElement('section');",
  "imageTurn.dataset.turnIdContainer='image-only';",
  "imageTurn.dataset.testid='conversation-turn-16';",
  "const image=document.createElement('img');",
  "image.srcset='/pixel.gif?sig=selected 1x';",
  "image.src='/pixel.gif?sig=dom';",
  "imageTurn.append(image);root.append(imageTurn);",
  "root.addEventListener('scroll',()=>{});"
].join('\n');
const pixel=Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/pixel.gif?')) {
    res.writeHead(200, {'Content-Type':'image/gif','Cache-Control':'no-store'});
    res.end(pixel);
    return;
  }
  res.writeHead(200, {'Content-Type': req.url==='/fixture.js'?
    'application/javascript' : 'text/html'});
  res.end(req.url==='/fixture.js' ? app : page);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rumiai-render-probe-test-'));
try {
  const out = path.join(root,'capture');
  const child = spawn(process.execPath, [script,
    'http://127.0.0.1:'+server.address().port+'/', out, '--sweep', '--headless', '--compare-image-urls'],
    {stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data', chunk => {stdout+=String(chunk);});
  child.stderr.on('data', chunk => {stderr+=String(chunk);});
  const status = await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('probe timeout: '+stderr));},90000);
    child.once('error',reject);
    child.once('exit',code=>{clearTimeout(timer);resolve(code);});
  });
  assert.equal(status,0,stderr+' '+stdout);
  const summary=JSON.parse(fs.readFileSync(path.join(out,'summary.json'),'utf8'));
  const records=fs.readFileSync(path.join(out,'events.jsonl'),'utf8')
    .split('\n').filter(Boolean).map(JSON.parse);
  const kinds=['session.ready','probe.installed','intersection.create','intersection.observe',
    'intersection.callback','dom.mutation','scroll.actual','turn.snapshot',
    'sweep.step','sweep.finished'];
  for(const kind of kinds)assert(summary.counts[kind]>0,'missing '+kind);
  assert(summary.counts['turn.initial'] >= 8, 'initial per-turn state missing');
  assert(summary.counts['turn.content-mounted'] > 0,
    'scroll never remounted any turn contents');
  assert(summary.counts['turn.content-unmounted'] > 0,
    'scroll never unmounted any turn contents');
  const registrations = records.filter(e => e.kind === 'listener.register');
  assert(registrations.some(e => e.event === 'scroll' &&
    Array.isArray(e.caller) && e.caller.length),
    'listener registration has no origin callsite');
  const ioRegistrations = records.filter(e => e.kind === 'intersection.create');
  assert(ioRegistrations.some(e => Array.isArray(e.caller) && e.caller.length),
    'observer construction has no origin callsite');
  const transitions = records.filter(e => e.kind === 'turn.content-mounted' ||
    e.kind === 'turn.content-unmounted');
  assert(transitions.every(e => e.turnId && e.messageIds.length),
    'mount/unmount transitions must keep stable original turn/message identity');
  assert(summary.uniqueTurnSnapshots>=8,'not enough reconstructed turn snapshots');
  const unidentified = records.filter(e => e.kind === 'turn.unidentified-snapshot');
  assert(unidentified.some(e => e.turnId === 'image-only' && e.messageIds.length === 0),
    'image-only turn with no data-message-id was not captured');
  for (const entry of unidentified) {
    assert(fs.existsSync(path.join(out, entry.file)), 'unidentified turn HTML missing');
    assert(!('html' in entry), 'unidentified turn HTML leaked into JSONL');
  }
  assert(unidentified.some(e => e.turnId === 'image-only' &&
    fs.readFileSync(path.join(out, e.file), 'utf8').includes('<img')),
    'image-only turn snapshot missing image markup');
  const turns=new Set(records.filter(e=>e.kind==='turn.snapshot').map(e=>e.turnId));
  assert(turns.has('turn-0')&&turns.has('turn-15'),'sweep did not capture both ends');
  for(const row of records.filter(e=>e.kind==='turn.snapshot')){
    assert(fs.existsSync(path.join(out,row.file)),'snapshot missing');
    assert(fs.readFileSync(path.join(out,row.file),'utf8').includes('data-message-id'));
  }
  const imageAudit=inspectSameSessionImageUrls(out);
  console.log('Chrome fixture image URL evidence: '+JSON.stringify(imageAudit));
  assert(imageAudit.network.imageResponseEvents >= 1,
    'Chrome CDP did not observe image response within the same session');
  assert(imageAudit.probe.imageBearingTurns >= 1,
    'No image-bearing DOM frame with browser-selected URL');
  assert(imageAudit.browserSelectedUrlEvidence['exact-request'] >= 1,
    'CurrentSrc was not linked to the actual browser image request');
  assert(imageAudit.sourceUrlEvidence['same-origin-path-different-query'] >= 1,
    'Fixture did not exercise srcset/currentSrc query distinction');
  console.log('PASS real Chrome: observer callbacks, scroll, turn IDs, srcset/currentSrc and CDP network request');
} finally {
  server.close();
  fs.rmSync(root,{recursive:true,force:true});
}
