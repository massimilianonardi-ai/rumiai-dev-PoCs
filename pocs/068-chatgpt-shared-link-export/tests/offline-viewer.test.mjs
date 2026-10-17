import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreview } from '../experiments/serve-evidence.mjs';

test('localhost viewer loads PoC-local styles and prevents raw portal downloads', async () => {
  const poc = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const evidence = path.join(poc, 'experiments', 'evidence');
  await fs.mkdir(evidence, { recursive:true });
  const root = await fs.mkdtemp(path.join(evidence, 'offline-viewer-test-'));
  let preview;
  try {
    const site = path.join(root, 'chatgpt-share');
    const state = path.join(site, 'replay', '0000');
    const assets = path.join(state, 'offline-assets');
    await fs.mkdir(assets, { recursive:true });
    await fs.writeFile(path.join(site, 'review-offline.html'),
      '<!doctype html><a href="replay/0000/offline.html">View</a>');
    await fs.writeFile(path.join(site, 'review.html'), 'OLD VIEW');
    await fs.writeFile(path.join(state, 'offline.html'),
      '<!doctype html><link rel="stylesheet" href="offline-assets/style.css">');
    await fs.writeFile(path.join(assets, 'style.css'), 'body{color:red}');
    await fs.writeFile(path.join(state, 'page.html'), 'UNSTYLED');
    await fs.writeFile(path.join(state, 'page.mhtml'), 'MIME RAW');
    preview = await createPreview(root);
    const csp = await fetch(preview.origin +
      'chatgpt-share/replay/0000/offline.html');
    assert.equal(csp.status, 200);
    assert.match(csp.headers.get('content-security-policy'), /style-src 'self'/);
    assert.match(csp.headers.get('content-security-policy'), /font-src 'self'/);
    const stylesheet = await fetch(preview.origin +
      'chatgpt-share/replay/0000/offline-assets/style.css');
    assert.equal(stylesheet.status, 200);
    assert.match(await stylesheet.text(), /color:red/);
    assert.match(stylesheet.headers.get('content-type'), /text\/css/);
    const oldLink = await fetch(preview.origin + 'chatgpt-share/review.html',
      {redirect:'manual'});
    assert.equal(oldLink.status, 302);
    assert.match(oldLink.headers.get('location'), /review-offline\.html$/);
    for (const basename of ['page.html', 'page.mhtml']) {
      const raw = await fetch(preview.origin +
        'chatgpt-share/replay/0000/' + basename);
      assert.equal(raw.status, 409);
      assert.doesNotMatch(await raw.text(), /file:\/\/\/run\/user/);
    }
  } finally {
    if (preview)
      await new Promise(resolve => preview.server.close(resolve));
    await fs.rm(root, { recursive:true, force:true });
  }
});
