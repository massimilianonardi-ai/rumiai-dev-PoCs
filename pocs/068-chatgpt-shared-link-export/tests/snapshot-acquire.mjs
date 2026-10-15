import assert from 'node:assert/strict';
import test from 'node:test';
import { captureStructuredSnapshot, injectedCaptureSource,
  recordJsonShape, shareUrl } from '../snapshot-acquire.mjs';

function snapshot() {
  return { conversation_id: 'abc', current_node: 'one',
    mapping: { one: { parent: null, message: {
      author: { role: 'user' }, content: { parts: ['a'] }
    } } } };
}

test('share URL validation remains restricted to ChatGPT shared links', () => {
  assert.equal(shareUrl('https://chatgpt.com/share/abc'), 'https://chatgpt.com/share/abc');
  for (const url of ['http://chatgpt.com/share/a', 'https://bad.invalid/share/a',
    'https://chatgpt.com/share/a?auth=secret']) {
    assert.throws(() => shareUrl(url), /share.invalid-url/);
  }
});

test('injected capture observes structured snapshot without debugger event domains', async () => {
  const calls = [];
  let navigated = false;
  let installed = false;
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session close') return { closed: true };
    if (cmd === 'page navigate')
      throw new Error('ordinary page navigation must not be used');
    if (cmd === 'debug session events')
      throw new Error('event polling must not be used');
    if (cmd === 'debug session send') {
      if (args[4] === 'Page.addScriptToEvaluateOnNewDocument') {
        const params = JSON.parse(args[5]);
        assert.match(params.source, /globalThis\.fetch/);
        assert.match(params.source, /XMLHttpRequest/);
        assert.match(params.source, /mapping/);
        installed = true;
        return { result: { identifier: 'script-1' } };
      }
      if (args[4] === 'Page.navigate') {
        assert.equal(installed, true);
        navigated = true;
        return { result: { frameId: 'frame-1' } };
      }
      if (args[4] === 'Runtime.evaluate') {
        const params = JSON.parse(args[5]);
        if (params.expression.includes('__rumiaiChatgptShareSnapshot')) {
          return { result: { result: {
            value: navigated ? JSON.stringify(snapshot()) : null
          } } };
        }
        return { result: { result: { value: [] } } };
      }
      return { result: {} };
    }
    return {};
  };

  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'injected-page');
  assert.deepEqual(result.snapshot, snapshot());
  assert.ok(calls.some(x => x[4] === 'Page.addScriptToEvaluateOnNewDocument'));
  assert.ok(calls.some(x => x[4] === 'Page.navigate'));
  for (const method of ['Network.enable', 'Debugger.enable', 'Page.getResourceTree',
    'Page.getResourceContent', 'Debugger.setBreakpointByUrl']) {
    assert.ok(!calls.some(x => x[4] === method));
  }
  assert.ok(!calls.some(x => x.slice(0, 3).join(' ') === 'debug session events'));
});

test('capture bootstrap installs fetch and XHR observation before navigation', () => {
  const source = injectedCaptureSource();
  assert.match(source, /nativeFetch/);
  assert.match(source, /response\.clone\(\)/);
  assert.match(source, /XMLHttpRequest/);
  assert.match(source, /DOMContentLoaded/);
  assert.doesNotMatch(source, /Debugger\./);
});

test('privacy-safe diagnostics retain shape without values', () => {
  const stats = { jsonShapes: [] };
  recordJsonShape(JSON.stringify({ data: { messages: ['DO NOT PRINT'] }, secret: 'TOKEN' }), stats);
  assert.match(JSON.stringify(stats), /messages/);
  assert.doesNotMatch(JSON.stringify(stats), /DO NOT PRINT|TOKEN/);
});
