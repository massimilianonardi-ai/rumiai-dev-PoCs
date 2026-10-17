import test from 'node:test';
import assert from 'node:assert/strict';
import { replayableAction, consolidateActions, resetReplayToStart, main } from '../experiments/two-site-observation.mjs';

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

test('demonstration teaches scan container, not raw back-and-forth scrolling', () => {
  const events = [
    {kind:'scroll',selector:'html',top:200},
    {kind:'scroll',selector:'html',top:350},
    {kind:'scroll',selector:'html',top:140},
    {kind:'click',selector:'summary',target:'summary',expandable:false},
    {kind:'scroll',selector:'div:nth-of-type(2)',top:40},
    {kind:'scroll',selector:'html',top:900},
    {kind:'scroll',selector:'html',top:450},
    {kind:'click',selector:'summary',target:'summary',expandable:false},
    {kind:'key-activation'}
  ];
  const actions = consolidateActions(events);
  assert.deepEqual(actions.map(x => x.kind),
    ['forward-scan','click','key-activation']);
  assert.equal(actions[0].selector,'html');
  assert.equal(actions[0].maxObservedTop,900);
  assert.equal(actions[0].recordedScrollSamples,6);
  assert.equal(actions.filter(x => x.kind === 'click').length,1);
});

test('prefer scrollable inner container observed to move further than document', () => {
  const actions = consolidateActions([
    {kind:'scroll',selector:'html',top:2},
    {kind:'scroll',selector:'main > div:nth-of-type(2)',top:400},
    {kind:'scroll',selector:'main > div:nth-of-type(2)',top:900}
  ]);
  assert.equal(actions[0].kind,'forward-scan');
  assert.equal(actions[0].selector,'main > div:nth-of-type(2)');
});

test('replay resets both document and selected scroll container before first checkpoint', async () => {
  let source = '';
  const client = {
    async cdp(_page, method, params) {
      assert.equal(method, 'Runtime.evaluate');
      source = params.expression;
      return { result: { value: { found: true, documentTop: 0,
        containerTop: 0 } } };
    },
    async call() {
      return { scrollY: 0, documentHeight: 8000,
        viewportHeight: 1000, atBottom: false };
    }
  };
  const result = await resetReplayToStart(client, 'page-1', 'html');
  assert.equal(result.atStart, true);
  assert.equal(result.observedTop, 0);
  assert.match(source, /scrollTo/);
  assert.match(source, /behavior:"instant"/);
});

test('replay refuses to consider an automatically restored midpage scroll as top', async () => {
  const client = {
    async cdp() {
      return { result: { value: { found: true, documentTop: 0,
        containerTop: 0 } } };
    },
    async call() {
      return { scrollY: 15553, documentHeight: 30000,
        viewportHeight: 1000, atBottom: false };
    }
  };
  const result = await resetReplayToStart(client, 'page-2', 'html');
  assert.equal(result.atStart, false);
  assert.equal(result.observedTop, 15553);
});

test('rejects /run/user and every other output outside the PoC before contacting browser', async () => {
  let calls=0;
  const client={async call(){calls++;throw new Error('unexpected browser operation');}};
  assert.equal(await main(['/run/user/1000/doc/trial'], client),2);
  assert.equal(await main(['/tmp/web-export'], client),2);
  assert.equal(calls,0);
});
