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

test('structured network snapshot is received via shared web-control commands', async () => {
  const calls = [];
  let batch = false;
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session send') {
      switch (args[4]) {
        case 'Network.getResponseBody': return { result: { body: JSON.stringify({ payload: snapshot() }), base64Encoded: false } };
        default: return { result: {} };
      }
    }
    if (cmd === 'debug session events') {
      if (batch) return { events: [] };
      batch = true;
      return { events: [
        { sequence: 1, method: 'Network.responseReceived', params: {
          requestId: 'one', response: { url: 'https://chatgpt.com/share/abc',
            mimeType: 'application/json' } } },
        { sequence: 2, method: 'Network.loadingFinished', params: { requestId: 'one' } }
      ] };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control, 'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'observed-network');
  assert.deepEqual(result.snapshot, snapshot());
  assert.ok(calls.some(x => x.slice(0, 3).join(' ') === 'debug session open'));
  assert.ok(calls.some(x => x.slice(0, 3).join(' ') === 'debug session close'));
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
  let paused = false;
  let firstScripts = false;
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
      if (args[4] === 'Page.navigate') navigations++;
      return { result: {} };
    }
    if (cmd === 'debug session events') {
      if (!firstScripts) {
        firstScripts = true;
        return { events: [{ sequence: 1, method: 'Debugger.scriptParsed', params: {
          scriptId: '1', url: 'https://chatgpt.com/assets/main.js' } }] };
      }
      if (navigations && !paused) {
        paused = true;
        return { events: [{ sequence: 2, method: 'Debugger.paused',
          params: { callFrames: [{ callFrameId: 'frame-1' }] } }] };
      }
      return { events: [] };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control, 'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'original-breakpoint');
  assert.deepEqual(result.snapshot, snapshot());
  assert.ok(calls.some(x => x[4] === 'Debugger.resume'));
  assert.ok(calls.some(x => x[4] === 'Debugger.setBreakpointByUrl'));
  assert.ok(calls.some(x => x[4] === 'Page.navigate'));
});
