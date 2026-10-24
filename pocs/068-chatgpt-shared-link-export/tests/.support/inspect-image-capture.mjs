'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectImages} from '../../inspect-image-capture.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc068-image-inspect-'));
const cumulative = path.join(root, 'cumulative');
const resources = path.join(root, 'resources-archive');
const probe = path.join(root, 'probe');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const makeDir = dir => fs.mkdirSync(dir, {recursive:true});
for (const dir of [cumulative, probe, path.join(probe,'turns'), path.join(resources,'resources')])
  makeDir(dir);

function archived(bytes, suffix) {
  const fileHash = hash(bytes);
  const filename = 'resources/' + fileHash + suffix;
  fs.writeFileSync(path.join(resources, filename), bytes);
  return {file:filename, sha256:fileHash, bytes:bytes.length};
}
function hydration() {
  const flat=[], names=new Map();
  const add = value => (flat.push(value),flat.length-1);
  function name(n) {if (!names.has(n)) names.set(n,add(n));return names.get(n);}
  function record(fields) {
    const v={};
    for (const [k,p] of Object.entries(fields)) v['_'+name(k)]=p;
    return add(v);
  }
  function message(role,id,final) {
    const author=record({role:add(role)});
    const metadata=record({is_visually_hidden_from_conversation:add(false)});
    return record({message:record({id:add(id),author,metadata,
      recipient:add('all'),end_turn:add(final)})});
  }
  const nodes=[message('user','user-id',false),message('assistant','assistant-id',true)];
  name('linear_conversation');add(nodes);
  return '<script>streamController.enqueue(' + JSON.stringify(JSON.stringify(flat)+'\n') + ')</script>';
}
try {
  const html = Buffer.from(hydration());
  const doc = archived(html, '.html');
  const png = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.writeUInt32BE(1024,16);
  png.writeUInt32BE(768,20);
  const image = archived(png,'.png');
  const second = archived(Buffer.concat([png, Buffer.from('different')]), '.png');
  const index = [
    {status:'saved',resourceType:'Document',mimeType:'text/html',
      url:'https://chatgpt.com/share/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',...doc},
    {status:'saved',resourceType:'Image',mimeType:'image/png',
      url:'https://chatgpt.com/private?token=secret-should-not-leak&size=1',...image},
    {status:'redirect-no-body',session:'test-session',requestId:'request-7',
      url:'https://images.example.test/original?private=secret-redirect-token'},
    {status:'saved',session:'test-session',requestId:'request-7',
      resourceType:'Image',mimeType:'image/png',
      url:'https://cdn.example.test/final?private=secret-redirect-token',...second}
  ];
  fs.writeFileSync(path.join(resources,'resources.jsonl'),index.map(JSON.stringify).join('\n')+'\n');
  const snapshotHtml='<div data-turn-id-container="secret-turn"><section data-testid="conversation-turn-1"><img src="https://chatgpt.com/private?token=secret-should-not-leak&amp;size=1"><svg></svg></section></div>';
  const snapshotBuffer = Buffer.from(snapshotHtml);
  const snapshotHash=hash(snapshotBuffer);
  const snapshotFile='turns/'+snapshotHash+'.html';
  fs.writeFileSync(path.join(probe,snapshotFile),snapshotBuffer);
  const unidentifiedHtml = '<div data-turn-id-container="secret-image-turn"><section data-testid="conversation-turn-2"><img src="https://chatgpt.com/private?token=secret-should-not-leak&amp;size=1"><img src="blob:https://chatgpt.com/private-object"><img src="https://chatgpt.com/private?token=different&amp;size=1"><img src="https://images.example.test/original?private=secret-redirect-token"></section></div>';
  const unidentifiedBytes = Buffer.from(unidentifiedHtml);
  const unidentifiedHash = hash(unidentifiedBytes);
  const unidentifiedFile = 'turns/' + unidentifiedHash + '.html';
  fs.writeFileSync(path.join(probe,unidentifiedFile),unidentifiedBytes);
  const events=[
    {kind:'turn.initial',turnId:'secret-turn',rendered:true,messageIds:['user-id']},
    {kind:'turn.initial',turnId:'another-turn',rendered:false,messageIds:[]},
    {kind:'turn.snapshot',sequence:3,turnId:'secret-turn',messageIds:['user-id'],
      file:snapshotFile,sha256:snapshotHash,bytes:snapshotBuffer.length},
    {kind:'turn.unidentified-snapshot',sequence:4,turnId:'secret-image-turn',
      messageIds:[],file:unidentifiedFile,sha256:unidentifiedHash,
      bytes:unidentifiedBytes.length},
    {kind:'turn.unidentified-snapshot',sequence:5,turnId:'secret-image-turn',
      messageIds:[],file:unidentifiedFile,sha256:unidentifiedHash,
      bytes:unidentifiedBytes.length}
  ];
  fs.writeFileSync(path.join(probe,'events.jsonl'),events.map(JSON.stringify).join('\n')+'\n');
  fs.writeFileSync(path.join(cumulative,'audit.json'),JSON.stringify({turns:[
    {ordinal:1,messageIds:['user-id']},{ordinal:2,messageIds:['assistant-id']}
  ]}));
  fs.writeFileSync(path.join(cumulative,'resource-references.json'),
    JSON.stringify([{attribute:'src',reference:'https://chatgpt.com/private?token=secret-should-not-leak'}]));
  const report=inspectImages(cumulative,resources,probe);
  assert.equal(report.archive.savedImageResponses,2);
  assert.equal(report.archive.savedImageBytes,24+second.bytes);
  assert.deepEqual(report.archive.images[0].dimensions,[1024,768]);
  assert.deepEqual(report.archive.byMime,{'image/png':2});
  assert.equal(report.archive.byOriginClass.chatgpt,1);
  assert.equal(report.archive.byOriginClass['other-host'],1);
  assert.equal(report.probe.initiallyObservedTurnWrappers,2);
  assert.equal(report.probe.initiallyWithoutMessageIds,1);
  assert.equal(report.probe.snapshotsWithImg,1);
  assert.equal(report.probe.elementCounts.svg,1);
  assert.equal(report.probe.imgSrcClasses.chatgpt,1);
  assert.equal(report.probe.unidentifiedSnapshotEvents,2);
  assert.equal(report.probe.unidentifiedDistinctTurnIds,1);
  assert.equal(report.probe.unidentifiedSnapshotsWithImg,2);
  assert.equal(report.probe.unidentifiedElementCounts.img,8);
  assert.equal(report.probe.unidentifiedImgSrcClasses['browser-blob'],2);
  assert.equal(report.probe.unidentifiedImgSrcClasses.chatgpt,4);
  assert.equal(report.probe.unidentifiedImgSrcClasses['other-host'],2);
  assert.equal(report.linkage.unidentified.imageTagOccurrences,8);
  assert.equal(report.linkage.unidentified.distinctImageReferences,4);
  assert.equal(report.linkage.unidentified.matchedSavedReferences,1);
  assert.equal(report.linkage.unidentified.unmatchedReferences,3);
  assert.equal(report.linkage.unidentified.unmatchedEvidence.sameRequestRedirect,1);
  assert.equal(report.linkage.unidentified.unmatchedEvidence.sameOriginPathDifferentQuery,1);
  assert.equal(report.linkage.unidentified.unmatchedEvidence.nonHttp,1);
  assert.equal(report.linkage.unidentified.unmatchedEvidence.redirectPngBodies,1);
  assert.equal(report.linkage.unidentified.turns[0].unmatchedEvidence.sameRequestRedirect,1);
  assert.equal(report.linkage.unidentified.distinctMatchedPngBodies,1);
  assert.equal(report.linkage.unidentified.turns[0].ordinal,2);
  assert.equal(report.linkage.unidentified.turns[0].imageBearingSnapshotEvents,2);
  assert.equal(report.linkage.identified.matchedSavedReferences,1);
  assert.deepEqual(report.linkage.imageOrdinalsAbsentFromCumulative,[]);
  assert.equal(report.cumulative.rawAuditStatus,'complete-visible-message-identity-and-order');
  const json=JSON.stringify(report);
  for(const sensitive of ['secret-should-not-leak','secret-turn','secret-image-turn','private-object','secret-redirect-token','different&size=1','user-id','assistant-id'])
    assert(!json.includes(sensitive), 'private field leaked');
  // Missing DOM turn 2 is recovered only as identifiable image-bearing
  // ordinal evidence, not as an automatically accepted message.
  fs.writeFileSync(path.join(cumulative,'audit.json'),JSON.stringify({turns:[
    {ordinal:1,messageIds:['user-id']},{ordinal:3,messageIds:['assistant-id']}
  ]}));
  const withGap = inspectImages(cumulative,resources,probe);
  assert.deepEqual(withGap.linkage.imageOrdinalsAbsentFromCumulative,[2]);
  assert.equal(withGap.cumulative.rawAuditStatus,'inconclusive-visible-message-coverage');
  fs.appendFileSync(path.join(resources,image.file),'tamper');
  assert.throws(()=>inspectImages(cumulative,resources,probe),/integrity verification failed/);
  console.log('PASS: image hashes, exact URLs, same-request redirects, query mismatch, turn ordinals, privacy, integrity');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
