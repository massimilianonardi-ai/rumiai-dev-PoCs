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
        if (params.expression === "location.origin + '|' + document.readyState")
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

test('page-context media acquisition maps renderer generated images to raw asset identity', async () => {
  const imageSnapshot = { conversation_id: 'conv-1', current_node: 'answer', mapping: {
    user1: { parent: null, message: { id: 'u1', author: { role: 'user' },
      content: { parts: ['prompt one'] }, weight: 1 } },
    toolImage1: { parent: 'user1', message: { id: 't1', author: { role: 'tool' },
      content: { content_type: 'multimodal_text', parts: [{
        content_type: 'image_asset_pointer',
        asset_pointer: 'sediment://file_image1?shared_conversation_id=share-1',
        size_bytes: 3, width: 1536, height: 1024
      }] }, weight: 0 } },
    user2: { parent: 'toolImage1', message: { id: 'u2', author: { role: 'user' },
      content: { parts: ['prompt two'] }, weight: 1 } },
    toolImage2: { parent: 'user2', message: { id: 't2', author: { role: 'tool' },
      content: { content_type: 'multimodal_text', parts: [{
        content_type: 'image_asset_pointer',
        asset_pointer: 'sediment://file_image2?shared_conversation_id=share-1',
        size_bytes: 4, width: 1536, height: 1024
      }] }, weight: 0 } },
    answer: { parent: 'toolImage2', message: { id: 'a', author: { role: 'assistant' },
      channel: 'final', recipient: 'all', content: { parts: ['done'] },
      metadata: { is_complete: true }, end_turn: true, weight: 1 } }
  } };
  let navigated = false;
  const expressions = [];
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
      expressions.push(params.expression);
      if (params.expression === "location.origin + '|' + document.readyState")
        return { result: { result: { value:
          navigated ? 'https://chatgpt.com|complete' : 'data:|complete' } } };
      if (params.expression.includes('generated-image-preview')) {
        return { result: { result: { value: [
          { status: 200, byteLength: 3, mimeType: 'image/png',
            base64: Buffer.from('one').toString('base64'),
            occurrences: [{ occurrence: 0, aria_label: 'generated 1',
              natural_width: 1536, natural_height: 1024 }] },
          { status: 200, byteLength: 4, mimeType: 'image/png',
            base64: Buffer.from('four').toString('base64'),
            occurrences: [{ occurrence: 1, aria_label: 'generated 1',
              natural_width: 1536, natural_height: 1024 }] }
        ] } } };
      }
      if (params.expression.includes('/files/download/'))
        throw new Error('backend-anon file endpoint must not be used when renderer assets match');
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
  assert.equal(result.assets.length, 2);
  assert.deepEqual(result.assets.map(x => x.file_id), ['file_image1', 'file_image2']);
  assert.deepEqual(result.assets.map(x => x.downloaded_size_bytes), [3, 4]);
  assert.deepEqual(result.assets.map(x => x.attempts[0].source),
    ['renderer-generated-image', 'renderer-generated-image']);
  assert.deepEqual(result.assets.map(x => x.references[0].classification),
    ['zero_weight', 'zero_weight']);
  assert.equal(result.stats.rendererImageResources, 2);
  assert.equal(result.stats.rendererImageOccurrences, 2);
  assert.ok(expressions.some(x => x.includes('generated-image-preview')));
  assert.ok(!expressions.some(x => x.includes('/api/auth/session')));
  assert.ok(!expressions.some(x => x.includes('Authorization')));
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
      if (params.expression === "location.origin + '|' + document.readyState")
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
