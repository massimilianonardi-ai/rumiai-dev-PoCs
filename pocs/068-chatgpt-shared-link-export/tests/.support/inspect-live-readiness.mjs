'use strict';
import assert from 'node:assert/strict';
import {liveReadinessExpression,normalizedLiveShape,summarizeLiveReadiness}
  from '../../inspect-live-readiness.mjs';

assert(liveReadinessExpression.includes('document.readyState'));
assert(!liveReadinessExpression.includes('document.body.innerText;'));
const original={readyState:'complete',hasScrollRoot:false,turnWrappers:0,
  conversationMarkers:0,messageMarkers:0,mainElements:1,roleMainElements:0,
  iframeElements:0,bodyChildElements:1,bodyTextCharacters:24,
  alternateScrollCandidates:0,navigationResponseStatus:200,
  secret:'PRIVATE CHAT',url:'https://private.test/signed-token'};
const first=summarizeLiveReadiness([original],'no-error');
assert.equal(first.classification,'expected-hooks-never-observed');
assert.equal(first.validSamples,1);
assert.equal(first.finalShape.bodyTextCharacters,24);
assert.equal(first.finalShape.navigationResponseStatus,200);
assert.equal(first.observedBoth,false);
for(const token of ['PRIVATE CHAT','signed-token','private.test'])
  assert(!JSON.stringify(first).includes(token));
const intermediate=summarizeLiveReadiness([
  {...original,hasScrollRoot:true,turnWrappers:0},
  {...original,hasScrollRoot:false,turnWrappers:2}
],'no-error');
assert.equal(intermediate.classification,'expected-hooks-at-different-times');
const recovered=summarizeLiveReadiness([
  original,{...original,hasScrollRoot:true,turnWrappers:2,
    conversationMarkers:2}
],'no-error');
assert.equal(recovered.classification,'expected-hooks-observed');
assert.equal(recovered.maximumObserved.turnWrappers,2);
assert.equal(normalizedLiveShape({turnWrappers:'private-message'}).turnWrappers,null);
assert.equal(summarizeLiveReadiness([], 'failed').classification,'no-dom-evaluation');
console.log('PASS: read-only live readiness structural classifier and no private field disclosure');
