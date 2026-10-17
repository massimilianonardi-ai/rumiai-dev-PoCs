import test from 'node:test';
import assert from 'node:assert/strict';
import { replayableAction, consolidateActions } from '../experiments/two-site-observation.mjs';

test('trial replay permits scroll and explicit disclosure controls only', () => {
  assert.equal(replayableAction({kind:'scroll',selector:'html',top:0}), true);
  assert.equal(replayableAction({kind:'scroll',selector:'html',top:-1}), false);
  assert.equal(replayableAction({kind:'scroll',selector:'html',top:Infinity}), false);
  assert.equal(replayableAction({kind:'click',selector:'summary',target:'summary'}), true);
  assert.equal(replayableAction({kind:'click',selector:'button[aria-expanded]',
    target:'button',expandable:true}), true);
  assert.equal(replayableAction({kind:'click',selector:'a',target:'a'}), false);
  assert.equal(replayableAction({kind:'click',selector:'button',
    target:'button',expandable:false}), false);
  assert.equal(replayableAction({kind:'fill',selector:'input',value:'private'}), false);
});

test('trial scroll reduction preserves click boundaries and distinct containers', () => {
  const events = [
    {kind:'scroll',selector:'html',top:200},
    {kind:'scroll',selector:'html',top:350},
    {kind:'click',selector:'summary',target:'summary'},
    {kind:'scroll',selector:'div:nth-of-type(2)',top:400},
    {kind:'scroll',selector:'html',top:900},
    {kind:'key-activation'},
    {kind:'scroll',selector:'html',top:1100}
  ];
  const actions = consolidateActions(events);
  assert.deepEqual(actions.map(x => [x.kind,x.selector,x.top]), [
    ['scroll','html',350],
    ['click','summary',undefined],
    ['scroll','div:nth-of-type(2)',400],
    ['scroll','html',1100]
  ]);
});
