import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCheckpoint,summarizeEvidence} from '../diagnose-run.mjs';

const base={screenshotStable:true,stable:true,
  before:{top:400,max:1800},originalAnchors:[{key:'x',line:0,top:20}]};
function archived(shift=0,extra={}){
  return {success:true,selector:'#chat',positionAligned:true,
    restoredGeometry:{top:400,max:1800},
    contentAligned:shift===0,
    finalContentShift:{usable:true,shift,matches:5,spread:0},
    ...extra};
}
test('aligned content requires content identity, not scrollTop alone',()=>{
  assert.equal(classifyCheckpoint(base,archived(0),'#chat'),'content-aligned');
  assert.equal(classifyCheckpoint(base,archived(580),'#chat'),'content-displaced');
  assert.equal(classifyCheckpoint(base,archived(580,{
    contentAligned:null,finalContentShift:{usable:false,
      reason:'content-reflow',shift:580,matches:5,spread:38}
  }),'#chat'),'content-reflow');
});
test('different scroll container invalidates apparently aligned coordinates',()=>{
  assert.equal(classifyCheckpoint(base,archived(0,{
    selector:'html'
  }),'#chat'),'different-scroll-container');
});
test('unstable source, missing anchors and MHTML failures stay distinct',()=>{
  assert.equal(classifyCheckpoint({...base,stable:false},
    archived(0),'#chat'),'source-not-stable');
  assert.equal(classifyCheckpoint(base,archived(0,{
    contentAligned:null,finalContentShift:{
      usable:false,reason:'insufficient-matching-content',matches:0}
  }),'#chat'),'content-unverified');
  assert.equal(classifyCheckpoint(base,{success:false,
    error:'offline.scroll-container-not-found'},'#chat'),'reopen-failed');
  assert.equal(classifyCheckpoint(null,archived(0),'#chat'),'missing-diagnostics');
});
test('diagnosis compares actual capture evidence with semantic state',()=>{
  const report={site:'chatgpt-share',plan:{selector:'#chat',
    actions:[{kind:'scroll',target:'top'}]},
    topCoverage:{manualTopObserved:true,manualTopCaptured:true,
      replayTopCaptured:false},
    messageCoverage:{status:'missing-observed-messages',
      missingCounts:{user:9,assistant:2}},
    replay:{complete:false,executionError:'truncated',
      disturbances:[{recovered:false}],activityWaits:[{settled:false}]}};
  const summary=summarizeEvidence(report,[
    {id:'0000',capture:base,offline:archived(0)},
    {id:'0001',capture:{...base,before:{top:100,max:1700}},
      offline:archived(200,{selector:'html'})}
  ]);
  assert.equal(summary.states,2);
  assert.equal(summary.counts['content-aligned'],1);
  assert.equal(summary.counts['different-scroll-container'],1);
  assert.equal(summary.topCoverage.replayCaptured,false);
  assert.equal(summary.manualVsReplayMessages.missingUser,9);
  assert.equal(summary.minimumSourceScreenshotTop,100);
  assert.ok(summary.flags.includes('mhtml-selector-fallback'));
  assert.ok(summary.flags.includes('replay-start-not-confirmed'));
  assert.ok(summary.flags.includes('manual-messages-absent-from-replay'));
  assert.equal(summary.firstProblems.length,1);
});
test('no checkpoint or report does not fabricate alignment',()=>{
  const summary=summarizeEvidence({site:'amazon-wishlist'},[]);
  assert.equal(summary.states,0);
  assert.deepEqual(summary.counts,{});
  assert.equal(summary.replayComplete,false);
});
