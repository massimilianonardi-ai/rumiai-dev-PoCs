import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationProgress} from '../accumulate.mjs';
import {resourceErrorClass,summarizeAccumulation}
  from '../diagnose-accumulation.mjs';

test('no scroll or DOM change is stall evidence, never page-end proof',()=>{
  const before={distinct:17,added:30,removed:8,updated:4,windowY:0};
  const progress=navigationProgress(before,{...before});
  assert.equal(progress.newIdentities,false);
  assert.equal(progress.anyDomChange,false);
  assert.equal(progress.proofOfCompletion,false);
});
test('recycling same IDs is activity, not evidence of more exported turns',()=>{
  const before={distinct:17,added:20,removed:10,updated:5,windowY:0};
  const p=navigationProgress(before,{distinct:17,added:25,removed:14,
    updated:7,windowY:0});
  assert.equal(p.anyDomChange,true);
  assert.equal(p.newIdentities,false);
  assert.equal(p.proofOfCompletion,false);
});
test('mounted new segments count even when root scroll always stays zero',()=>{
  const before={distinct:17,added:20,removed:10,updated:5,windowY:0};
  const p=navigationProgress(before,{...before,distinct:34,added:39,
    removed:18});
  assert.equal(p.newIdentities,true);
  assert.equal(p.distinctDelta,17);
  assert.equal(p.scrollDelta,0);
});
test('past run resource failure summary never prints signed URLs or prompt text',()=>{
  const old={status:'export-produced-not-certified',steps:44,
    stopReason:'visual-stasis-after-wheel',
    resources:{seen:95,saved:60,failed:22,skipped:0},
    resourcesErrors:[
      {url:'https://cdn.test/path?secret=xx',error:'resource-body-timeout'},
      {url:'https://cdn.test/private-chat',error:'Target closed'},
      {url:'https://cdn.test/private-chat',error:'net::ERR_CERT_AUTHORITY_INVALID'}
    ],
    continuity:{distinct:17,orderComponents:1,remounts:4,
      firstFrame:['id1','id2'],lastFrame:['id2','id3']}};
  const s=summarizeAccumulation(old);
  assert.equal(s.turns,17);
  assert.equal(s.progress.autoWheelAttempts,44);
  assert.equal(s.completeExportVerified,false);
  assert.equal(s.failuresRecorded,3);
  const serialized=JSON.stringify(s);
  assert.doesNotMatch(serialized,/secret|private-chat|cdn\.test|id1|id2/);
  assert.equal(resourceErrorClass('Timeout 15000ms'), 'resource-body-timeout');
});
