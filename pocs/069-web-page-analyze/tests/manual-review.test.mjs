import test from 'node:test';
import assert from 'node:assert/strict';
import {manualSourceSummary,manualSourceReviewHtml} from '../manual-review.mjs';

function evidence(){
  const manifest={frameIds:['0000','0001'],topCaptured:true,
    messageSignatures:{user:['u0','u1'],assistant:['a0','a1']},
    screenshotSignatures:{user:['u0'],assistant:['a0']},
    incompleteByDesign:false};
  const frames=[
    {id:'0000',scrollBefore:{top:30000,max:30000},
      screenshotStable:true,reason:'initial',
      messages:[{role:'user',signature:'u0',visible:true},
        {role:'assistant',signature:'a0',visible:true},
        {role:'user',signature:'u1',visible:false}]},
    {id:'0001',scrollBefore:{top:0,max:30000},
      screenshotStable:true,reason:'observed-quiescence',
      messages:[{role:'assistant',signature:'a1',visible:false}]}
  ];
  return {manifest,frames};
}
test('original manual top and role coverage are separate from replay',()=>{
  const {manifest,frames}=evidence();
  const report={topCoverage:{replayTopCaptured:false},
    messageCoverage:{missingCounts:{user:16,assistant:12}}};
  const summary=manualSourceSummary(manifest,frames,report);
  assert.equal(summary.sourceTopCaptured,true);
  assert.equal(summary.replayTopCaptured,false);
  assert.equal(summary.messages.user.observed,2);
  assert.equal(summary.messages.user.inStableViewport,1);
  assert.equal(summary.messages.user.unverifiedInScreenshot,1);
  assert.equal(summary.replayMissing.user,16);
  assert.equal(summary.fullConversationVerified,false);
});
test('review embeds unchanged original manual PNGs, not replay or MHTML',()=>{
  const {manifest,frames}=evidence();
  const html=manualSourceReviewHtml(manifest,frames,{
    topCoverage:{replayTopCaptured:false},
    messageCoverage:{missingCounts:{user:16,assistant:12}}
  });
  assert.match(html,/src=".\/0000\.png"/);
  assert.match(html,/src=".\/0001\.png"/);
  assert.match(html,/href="#frame-0001"/);
  assert.match(html,/16 prompt utente e 12 risposte/);
  assert.doesNotMatch(html,/page\.mhtml|states\/[0-9]|u0|a0/);
  assert.ok(html.indexOf('id="frame-0000"')<
    html.indexOf('id="frame-0001"'));
});
test('potentially unstable/manual-unverified checkpoints remain visible',()=>{
  const {manifest,frames}=evidence();
  frames[1].screenshotStable=false;
  manifest.incompleteByDesign=true;
  const html=manualSourceReviewHtml(manifest,frames,null);
  assert.match(html,/potenzialmente instabile/);
  assert.match(html,/copertura non è certificata/);
  assert.match(html,/NON raggiunto/);
});
test('HTML metadata is escaped and cannot inject script',()=>{
  const {manifest,frames}=evidence();
  frames[0].reason='<script>alert(1)</script>';
  const html=manualSourceReviewHtml(manifest,frames,null);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;/);
});
test('empty manual evidence is explicitly not complete',()=>{
  const summary=manualSourceSummary(null,[],null);
  assert.equal(summary.frames,0);
  assert.equal(summary.sourceTopCaptured,false);
  assert.equal(summary.fullConversationVerified,false);
});

test('offscreen DOM identities are not claimed as photographed content',()=>{
  const {manifest,frames}=evidence();
  frames[0].screenshotStable=false;
  const summary=manualSourceSummary(manifest,frames,null);
  assert.equal(summary.messages.user.inStableViewport,0);
  assert.equal(summary.messages.user.unverifiedInScreenshot,2);
  assert.equal(summary.messages.assistant.inStableViewport,0);
});
