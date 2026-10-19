import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAsset,rewriteCssAssets,validateShareUrl,runDirectory}
  from '../accumulate.mjs';
test('resource capture recognizes CSS, images, fonts and attachments',()=>{
  assert.equal(classifyAsset('text/css','stylesheet').ext,'css');
  assert.equal(classifyAsset('image/svg+xml','image').ext,'svg');
  assert.equal(classifyAsset('image/png','image').allowed,true);
  assert.equal(classifyAsset('font/woff2','font').ext,'woff2');
  assert.equal(classifyAsset('application/pdf','document').ext,'pdf');
  assert.equal(classifyAsset('text/html','document').allowed,false);
});
test('CSS url references become local assets only for captured bytes',()=>{
  const base='https://chatgpt.com/cdn/assets/foo.css';
  const map=new Map([
    ['https://chatgpt.com/cdn/assets/bg.png','assets/bg.png'],
    ['https://chatgpt.com/fonts/font.woff2','assets/font.woff2']
  ]);
  const missing=new Set();
  const css='a{background:url(bg.png)} @font-face{src:url("/fonts/font.woff2")}'+
    ' b{background:url(https://cdn.test/unfetched.png)}';
  const out=rewriteCssAssets(css,base,map,missing);
  assert.match(out,/url\("assets\/bg.png"\)/);
  assert.match(out,/url\("assets\/font.woff2"\)/);
  assert.equal(missing.size,1);
  assert.match(out,/unfetched/);
});
test('share-only URL allowlist rejects unrelated arbitrary navigation',()=>{
  assert.equal(validateShareUrl('https://chatgpt.com/share/abc-def'),
    'https://chatgpt.com/share/abc-def');
  assert.throws(()=>validateShareUrl('https://example.test/share/abc'),/invalid/);
  assert.throws(()=>validateShareUrl(
    'https://chatgpt.com/share/abc?auth=token'),/invalid/);
  assert.throws(()=>runDirectory('../previous'),/invalid-name/);
});
