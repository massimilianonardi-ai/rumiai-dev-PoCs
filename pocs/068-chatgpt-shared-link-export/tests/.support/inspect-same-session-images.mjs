'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectSameSessionImageUrls} from '../../inspect-image-capture.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-image-url-diagnostic-'));
const turns=path.join(dir,'turns');
fs.mkdirSync(turns);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const events=[];
function turn(id,ordinal,session,src,currentSrc) {
  const html='<div data-turn-id-container="'+id+'"><div data-testid="conversation-turn-'+ordinal+
    '"><img src="'+src+'"></div></div>';
  const file='turns/'+sha(Buffer.from(html))+'.html';
  fs.writeFileSync(path.join(dir,file),html);
  events.push({kind:'turn.unidentified-snapshot',sessionId:session,turnId:id,
    file,sha256:sha(Buffer.from(html)),bytes:Buffer.byteLength(html),
    imageSelections:[{src,currentSrc}]});
}
try {
  const domA='https://images.example.test/a.png?sig=dom-secret';
  const reqA='https://images.example.test/a.png?sig=network-secret';
  const domB='https://images.example.test/b.png?sig=dom-secret';
  const domInline='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  turn('turn-a',2,'same-session',domA,reqA);
  turn('turn-b',4,'same-session',domB,domB);
  turn('turn-inline',6,'same-session',domInline,domInline);
  events.push({kind:'network.image-response',sessionId:'same-session',
    requestId:'secret-request-id',initialUrl:reqA,requestUrl:reqA,responseUrl:reqA,
    mimeType:'image/png',resourceType:'Image',status:200});
  events.push({kind:'network.image-response',sessionId:'other-session',
    requestId:'other-secret-id',initialUrl:domB,requestUrl:domB,responseUrl:domB,
    mimeType:'image/png',resourceType:'Image',status:200});
  events.push({kind:'network.image-response',sessionId:'same-session',
    requestId:'request-for-b',initialUrl:'https://images.example.test/b.png?sig=other',
    requestUrl:'https://images.example.test/b.png?sig=other',
    responseUrl:'https://images.example.test/b.png?sig=other',
    mimeType:'image/png',resourceType:'Image',status:200});
  fs.writeFileSync(path.join(dir,'events.jsonl'),events.map(JSON.stringify).join('\n')+'\n');
  const report=inspectSameSessionImageUrls(dir);
  assert.equal(report.status,'same-session-image-url-diagnostic-only');
  assert.equal(report.network.imageResponseEvents,3);
  assert.equal(report.probe.imageBearingTurns,3);
  assert.equal(report.probe.srcCurrentSrcDifferences,1);
  assert.equal(report.sourceUrlEvidence['same-origin-path-different-query'],2);
  assert.equal(report.browserSelectedUrlEvidence['exact-request'],1);
  assert.equal(report.browserSelectedUrlEvidence['same-origin-path-different-query'],1);
  assert.equal(report.browserSelectedUrlEvidence['inline-or-blob'],1);
  assert.deepEqual(report.turns.map(x=>x.ordinal),[2,4,6]);
  assert.equal(report.turns[0].currentSrcEvidence['exact-request'],1);
  const safe=JSON.stringify(report);
  for(const secret of ['dom-secret','network-secret','secret-request-id',
      'images.example.test','turn-a','other-secret-id'])
    assert(!safe.includes(secret),'Report exposed captured identity: '+secret);
  const audit=path.join(dir,'events.jsonl');
  fs.writeFileSync(audit,events.filter(x=>x.kind!=='network.image-response')
    .map(JSON.stringify).join('\n')+'\n');
  assert.throws(()=>inspectSameSessionImageUrls(dir),/No same-session image network responses/);
  fs.writeFileSync(audit,events.map(JSON.stringify).join('\n')+'\n');
  const broken=events.map(x=>({...x}));
  delete broken[0].imageSelections;
  fs.writeFileSync(audit,broken.map(JSON.stringify).join('\n')+'\n');
  assert.throws(()=>inspectSameSessionImageUrls(dir),/missing currentSrc metadata/);
  console.log('PASS: same-session currentSrc versus src URL evidence, sessions and privacy');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
