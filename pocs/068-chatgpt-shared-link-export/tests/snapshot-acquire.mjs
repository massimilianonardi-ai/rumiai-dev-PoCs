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

test('privacy-safe diagnostics retain shape without values', () => {
  const stats = { jsonShapes: [] };
  recordJsonShape(JSON.stringify({ data: { messages: ['DO NOT PRINT'] }, secret: 'TOKEN' }), stats);
  assert.match(JSON.stringify(stats), /messages/);
  assert.doesNotMatch(JSON.stringify(stats), /DO NOT PRINT|TOKEN/);
});

test('original persistent paused-frame snapshot is captured and resumed', async () => {
  const calls = [];
  let navigations = 0;
  let debuggerEnabled = false;
  let breakpoint = false;
  let scriptDelivered = false;
  let paused = false;
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session send') {
      if (args[4] === 'Debugger.getScriptSource')
        return { result: { scriptSource: 'function z({mergeActiveBranch},t){return mergeActiveBranch(t)}' } };
      if (args[4] === 'Runtime.evaluate') return { result: { result: { value: [] } } };
      if (args[4] === 'Debugger.evaluateOnCallFrame')
        return { result: { result: { value: JSON.stringify(snapshot()) } } };
      if (args[4] === 'Debugger.enable') debuggerEnabled = true;
      if (args[4] === 'Debugger.setBreakpointByUrl') breakpoint = true;
      if (args[4] === 'Page.navigate') navigations++;
      return { result: {} };
    }
    if (cmd === 'debug session events') {
      if (args[6] === '0') return { events: [] };
      if (debuggerEnabled && !scriptDelivered) {
        scriptDelivered = true;
        return { events: [{ sequence: 1, method: 'Debugger.scriptParsed', params: {
          scriptId: '1', url: 'https://chatgpt.com/assets/main.js' } }] };
      }
      if (breakpoint && navigations >= 2 && !paused) {
        paused = true;
        return { events: [{ sequence: 2, method: 'Debugger.paused',
          params: { callFrames: [{ callFrameId: 'frame-1' }] } }] };
      }
      return { events: [] };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'original-breakpoint');
  assert.deepEqual(result.snapshot, snapshot());
  assert.ok(calls.some(x => x[4] === 'Debugger.resume'));
  assert.ok(calls.some(x => x[4] === 'Network.disable'));
  assert.ok(calls.some(x => x[4] === 'Debugger.enable'));
  assert.ok(calls.some(x => x[4] === 'Debugger.setBreakpointByUrl'));
  assert.ok(calls.filter(x => x[4] === 'Page.navigate').length >= 2);
  const firstNavigation = calls.findIndex(x => x[4] === 'Page.navigate');
  const debuggerEnable = calls.findIndex(x => x[4] === 'Debugger.enable');
  assert.ok(debuggerEnable > firstNavigation);
});
