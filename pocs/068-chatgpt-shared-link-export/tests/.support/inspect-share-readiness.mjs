'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {inspectShareReadiness} from '../../inspect-share-readiness.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-not-ready-'));
const privateUrl='https://private.example/share/secret-signed-token?auth=signed-secret';
const secretText='private-chat-conversation-not-for-export';
function capture(events,name)
{
  const dir=path.join(tmp,name);
  fs.mkdirSync(dir,{mode:0o700});
  fs.writeFileSync(path.join(dir,'events.jsonl'),
    events.map((event,i)=>JSON.stringify({
      sequence:i+1,at:'2026-10-26T00:00:00Z',
      arbitrarySecret:privateUrl,privateContent:secretText,...event
    })).join('\n')+'\n',{mode:0o600});
  return inspectShareReadiness(dir);
}
try
{
  const unavailable=capture([
    {kind:'session.ready'},
    {kind:'navigation.result',error:null,url:privateUrl},
    {kind:'network.image-response',url:privateUrl},
    {kind:'sweep.not-ready',pageShape:{
      readyState:'complete',hasScrollRoot:false,
      turnWrappers:0,conversationMarkers:0,mainElements:1,
      text:secretText,url:privateUrl}},
    {kind:'session.stop',reason:'sweep-not-ready'}
  ],'no-hooks');
  assert.equal(unavailable.observedReadiness,
    'scroll-root-and-turn-containers-not-observed');
  assert.deepEqual(unavailable.finalNotReadyPageShape,{
    readyState:'complete',hasScrollRoot:false,
    turnWrappers:0,conversationMarkers:0,mainElements:1
  });
  assert.equal(unavailable.lastNavigationObservation,
    'navigation-command-reported-no-error');
  assert.equal(unavailable.eventCounts['network.image-response'],1);
  assert.equal(unavailable.eventCounts['sweep.not-ready'],1);
  for(const secret of [privateUrl,secretText,'secret-signed-token','signed-secret'])
    assert(!JSON.stringify(unavailable).includes(secret),'Sensitive capture field leaked');

  const withoutShape=capture([
    {kind:'navigation.command-failed',error:privateUrl},
    {kind:'sweep.not-ready',content:secretText}
  ],'old-capture');
  assert.equal(withoutShape.observedReadiness,'readiness-failure-without-page-shape');
  assert.equal(withoutShape.finalNotReadyPageShape,null);
  assert.equal(withoutShape.lastNavigationObservation,'navigation-command-failed');
  const missingScroll=capture([
    {kind:'sweep.not-ready',pageShape:{hasScrollRoot:false,turnWrappers:10}}
  ],'missing-scroll');
  assert.equal(missingScroll.observedReadiness,'expected-scroll-root-not-observed');
  const missingTurns=capture([
    {kind:'sweep.not-ready',pageShape:{hasScrollRoot:true,turnWrappers:0}}
  ],'missing-turns');
  assert.equal(missingTurns.observedReadiness,'expected-turn-containers-not-observed');
  const contradictory=capture([
    {kind:'sweep.not-ready',pageShape:{hasScrollRoot:true,turnWrappers:4}}
  ],'final-hooks');
  assert.equal(contradictory.observedReadiness,'both-dom-hooks-present-in-final-observation');
  const valid=capture([
    {kind:'navigation.result',error:null},
    {kind:'sweep.started'},
    {kind:'turn.snapshot',html:secretText},
    {kind:'sweep.finished'}
  ],'ready');
  assert.equal(valid.observedReadiness,'no-readiness-failure-recorded');
  assert.equal(valid.eventCounts['turn.snapshot'],1);
  assert(!JSON.stringify(valid).includes(secretText));
  console.log('PASS: private existing-capture readiness classification, missing legacy fields and signed-token suppression');
}
finally {fs.rmSync(tmp,{recursive:true,force:true});}
