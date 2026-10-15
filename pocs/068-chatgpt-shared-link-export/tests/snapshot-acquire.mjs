import assert from 'node:assert/strict';
import test from 'node:test';
import { captureStructuredSnapshot, recordJsonShape,
  shareUrl } from '../snapshot-acquire.mjs';

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

test('page-context fetch returns structured shared conversation without event domains', async () => {
  const calls = [];
  let navigated = false;
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session close') return { closed: true };
    if (cmd === 'debug session events')
      throw new Error('event polling must not be used');
    if (cmd === 'debug session send') {
      if (args[4] === 'Page.navigate') {
        navigated = true;
        return { result: { frameId: 'frame-1' } };
      }
      if (args[4] === 'Runtime.evaluate') {
        const params = JSON.parse(args[5]);
        if (params.expression.includes('location.origin'))
          return { result: { result: { value:
            navigated ? 'https://chatgpt.com|complete' : 'data:|complete' } } };
        if (params.expression.includes('backend-anon')) {
          assert.equal(params.awaitPromise, true);
          return { result: { result: { value: {
            attempts: [{ source: 'backend-anon', status: 200 }],
            snapshot: JSON.stringify(snapshot())
          } } } };
        }
        return { result: { result: { value: [] } } };
      }
      return { result: {} };
    }
    return {};
  };

  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'page-fetch');
  assert.deepEqual(result.snapshot, snapshot());
  assert.deepEqual(result.stats.sourceAttempts,
    [{ source: 'backend-anon', status: 200 }]);
  assert.ok(calls.some(x => x[4] === 'Page.navigate'));
  for (const method of ['Network.enable', 'Debugger.enable',
    'Page.addScriptToEvaluateOnNewDocument', 'Debugger.setBreakpointByUrl']) {
    assert.ok(!calls.some(x => x[4] === method));
  }
  assert.ok(!calls.some(x => x.slice(0, 3).join(' ') === 'debug session events'));
});

test('page-context media acquisition resolves public share image bytes', async () => {
  const imageSnapshot = { conversation_id: 'conv-1', current_node: 'u', mapping: {
    u: { parent: null, message: { author: { role: 'user' }, content: {
      content_type: 'multimodal_text', parts: [
        { content_type: 'image_asset_pointer',
          asset_pointer: 'sediment://file_abc123?shared_conversation_id=share-1',
          size_bytes: 3, width: 1, height: 1 },
        'hello'
      ] } } }
  } };
  let navigated = false;
  const control = async (...args) => {
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session close') return { closed: true };
    if (cmd === 'debug session send' && args[4] === 'Page.navigate') {
      navigated = true; return { result: {} };
    }
    if (cmd === 'debug session send' && args[4] === 'Runtime.evaluate') {
      const params = JSON.parse(args[5]);
      if (params.expression.includes('location.origin'))
        return { result: { result: { value:
          navigated ? 'https://chatgpt.com|complete' : 'data:|complete' } } };
      if (params.expression.includes('/files/download/'))
        return { result: { result: { value: {
          attempts: [{ source: 'backend-anon', metadataStatus: 200, binaryStatus: 200 }],
          base64: Buffer.from('png').toString('base64'), byteLength: 3,
          mimeType: 'image/png', fileName: 'upload.png'
        } } } };
      if (params.expression.includes('backend-anon'))
        return { result: { result: { value: {
          attempts: [{ source: 'backend-anon', status: 200 }],
          snapshot: JSON.stringify(imageSnapshot)
        } } } };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/share-1', { seconds: 1 });
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].file_id, 'file_abc123');
  assert.equal(result.assets[0].mime_type, 'image/png');
  assert.equal(result.assets[0].base64, Buffer.from('png').toString('base64'));
  assert.equal(result.stats.assetAttempts.length, 1);
});

test('backend-api is represented as safe fallback evidence', async () => {
  const control = async (...args) => {
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session close') return { closed: true };
    if (cmd === 'debug session send' && args[4] === 'Page.navigate')
      return { result: {} };
    if (cmd === 'debug session send' && args[4] === 'Runtime.evaluate') {
      const params = JSON.parse(args[5]);
      if (params.expression.includes('location.origin'))
        return { result: { result: { value: 'https://chatgpt.com|interactive' } } };
      if (params.expression.includes('backend-anon'))
        return { result: { result: { value: {
          attempts: [
            { source: 'backend-anon', status: 404 },
            { source: 'backend-api', status: 200 }
          ],
          snapshot: JSON.stringify(snapshot())
        } } } };
      return { result: { result: { value: [] } } };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'page-fetch');
  assert.deepEqual(result.stats.sourceAttempts, [
    { source: 'backend-anon', status: 404 },
    { source: 'backend-api', status: 200 }
  ]);
});

test('privacy-safe diagnostics retain shape without values', () => {
  const stats = { jsonShapes: [] };
  recordJsonShape(JSON.stringify({ data: { messages: ['DO NOT PRINT'] }, secret: 'TOKEN' }), stats);
  assert.match(JSON.stringify(stats), /messages/);
  assert.doesNotMatch(JSON.stringify(stats), /DO NOT PRINT|TOKEN/);
});
