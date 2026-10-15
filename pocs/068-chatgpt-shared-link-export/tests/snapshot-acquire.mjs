import assert from 'node:assert/strict';
import test from 'node:test';
import { AcquisitionError, captureStructuredSnapshot,
  discoverHook, recordJsonShape, shareUrl, splitTopLevelParams } from '../snapshot-acquire.mjs';

function snapshot() {
  return { conversation_id: 'abc', current_node: 'one',
    mapping: { one: { parent: null, message: {
      author: { role: 'user' }, content: { parts: ['a'] }
    } } } };
}

test('share URL validation and exact original semantic hook detection', () => {
  assert.equal(shareUrl('https://chatgpt.com/share/abc'), 'https://chatgpt.com/share/abc');
  for (const url of ['http://chatgpt.com/share/a', 'https://bad.invalid/share/a',
    'https://chatgpt.com/share/a?auth=secret']) {
    assert.throws(() => shareUrl(url), /share.invalid-url/);
  }
  assert.deepEqual(splitTopLevelParams('{mergeActiveBranch},t'), ['{mergeActiveBranch}', 't']);
  const hook = discoverHook('function z({mergeActiveBranch},t){return mergeActiveBranch(t)}',
    'https://chatgpt.com/assets/main.js');
  assert.equal(hook.arg, 't');
  assert.equal(hook.lineNumber, 0);
  assert.equal(discoverHook('const x=1', 'https://chatgpt.com/assets/main.js'), null);
});

test('structured network snapshot drains before navigation to avoid event overflow', async () => {
  const calls = [];
  let navigated = false;
  let waiting = null;
  const networkEvents = [
    { sequence: 1, method: 'Network.responseReceived', params: {
      requestId: 'one', response: { url: 'https://chatgpt.com/share/abc',
        mimeType: 'application/json' } } },
    { sequence: 2, method: 'Network.loadingFinished', params: { requestId: 'one' } }
  ];
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'page navigate')
      throw new Error('debug.events-overflow: navigation completed before event drain');
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session send') {
      if (args[4] === 'Page.navigate') {
        if (!waiting)
          throw new Error('debug.events-overflow: no event poll active during navigation');
        navigated = true;
        const resolve = waiting;
        waiting = null;
        queueMicrotask(() => resolve({ events: networkEvents }));
        return { result: {} };
      }
      if (args[4] === 'Network.getResponseBody')
        return { result: { body: JSON.stringify({ payload: snapshot() }), base64Encoded: false } };
      return { result: {} };
    }
    if (cmd === 'debug session events') {
      if (args[6] === '0') return { events: [] };
      if (!navigated)
        return new Promise((resolve) => { waiting = resolve; });
      return { events: [] };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'observed-network');
  assert.deepEqual(result.snapshot, snapshot());
  assert.ok(calls.some(x => x.slice(0, 3).join(' ') === 'debug session open'));
  assert.ok(calls.some(x => x.slice(0, 3).join(' ') === 'debug session close'));
  const navigation = calls.findIndex(x => x[4] === 'Page.navigate');
  assert.ok(navigation > 0);
  assert.ok(calls.slice(0, navigation).some(x => x[4] === 'Network.enable'));
  for (const method of ['Runtime.enable', 'Debugger.enable', 'Page.enable'])
    assert.ok(!calls.slice(0, navigation).some(x => x[4] === method));
  assert.ok(!calls.some(x => x.slice(0, 2).join(' ') === 'page navigate'));
  assert.ok(!calls.some(x => x.slice(0, 2).join(' ') === 'debug cdp'));
});

test('initial Network overflow reopens the session and continues with embedded JSON', async () => {
  const calls = [];
  let opens = 0;
  let navigated = false;
  let overflowed = false;
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-' + (++opens) };
    if (cmd === 'debug session close') return { closed: true };
    if (cmd === 'debug session send') {
      if (args[4] === 'Page.navigate') {
        navigated = true;
        return { result: {} };
      }
      if (args[4] === 'Runtime.evaluate') {
        const params = JSON.parse(args[5]);
        if (params.expression === 'document.readyState')
          return { result: { result: { value: 'complete' } } };
        return { result: { result: { value: [JSON.stringify(snapshot())] } } };
      }
      return { result: {} };
    }
    if (cmd === 'debug session events') {
      if (args[6] === '0') return { events: [] };
      if (navigated && !overflowed) {
        overflowed = true;
        const error = new Error('share.web-control-command-failed');
        error.providerDiagnostic =
          'web-control: debug.events-overflow: events were discarded; reopen or resynchronize the session';
        throw error;
      }
      return { events: [] };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'embedded-json');
  assert.deepEqual(result.snapshot, snapshot());
  assert.equal(opens, 2);
  assert.ok(calls.some(x => x.slice(0, 3).join(' ') === 'debug session close'));
  assert.ok(calls.some(x => x[4] === 'Runtime.evaluate' &&
    JSON.parse(x[5]).expression === 'document.readyState'));
});

test('privacy-safe diagnostics retain shape without values', () => {
  const stats = { jsonShapes: [] };
  recordJsonShape(JSON.stringify({ data: { messages: ['DO NOT PRINT'] }, secret: 'TOKEN' }), stats);
  assert.match(JSON.stringify(stats), /messages/);
  assert.doesNotMatch(JSON.stringify(stats), /DO NOT PRINT|TOKEN/);
});

test('resource-tree hook discovery survives debugger event burst and captures paused frame', async () => {
  const calls = [];
  let navigations = 0;
  let breakpoint = false;
  let resynchronized = false;
  let paused = false;
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session send') {
      if (args[4] === 'Page.getResourceTree')
        return { result: { frameTree: {
          frame: { id: 'frame-1' },
          resources: [{ type: 'Script', url: 'https://chatgpt.com/assets/main.js' }]
        } } };
      if (args[4] === 'Page.getResourceContent')
        return { result: {
          content: 'function z({mergeActiveBranch},t){return mergeActiveBranch(t)}',
          base64Encoded: false
        } };
      if (args[4] === 'Runtime.evaluate') return { result: { result: { value: [] } } };
      if (args[4] === 'Debugger.evaluateOnCallFrame')
        return { result: { result: { value: JSON.stringify(snapshot()) } } };
      if (args[4] === 'Debugger.setBreakpointByUrl') breakpoint = true;
      if (args[4] === 'Page.navigate') navigations++;
      return { result: {} };
    }
    if (cmd === 'debug session events') {
      if (args[4] === String(Number.MAX_SAFE_INTEGER)) {
        resynchronized = true;
        return { after: Number.MAX_SAFE_INTEGER, lastSequence: 240, events: [] };
      }
      if (args[6] === '0') return { after: Number(args[4]), lastSequence: Number(args[4]), events: [] };
      if (breakpoint && resynchronized && navigations >= 2 && !paused) {
        paused = true;
        return { after: Number(args[4]), lastSequence: 241,
          events: [{ sequence: 241, method: 'Debugger.paused',
            params: { callFrames: [{ callFrameId: 'frame-1' }] } }] };
      }
      return { after: Number(args[4]), lastSequence: Number(args[4]), events: [] };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'original-breakpoint');
  assert.deepEqual(result.snapshot, snapshot());
  assert.equal(result.stats.scriptCount, 1);
  assert.ok(calls.some(x => x[4] === 'Page.getResourceTree'));
  assert.ok(calls.some(x => x[4] === 'Page.getResourceContent'));
  assert.ok(calls.some(x => x[4] === 'Debugger.enable'));
  assert.ok(calls.some(x => x.slice(0, 3).join(' ') === 'debug session events' &&
    x[4] === String(Number.MAX_SAFE_INTEGER)));
  assert.ok(calls.some(x => x[4] === 'Debugger.resume'));
  assert.ok(calls.some(x => x[4] === 'Debugger.setBreakpointByUrl'));
  assert.ok(calls.filter(x => x[4] === 'Page.navigate').length >= 2);
});
