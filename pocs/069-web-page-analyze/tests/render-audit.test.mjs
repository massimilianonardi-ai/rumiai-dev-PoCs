import test from 'node:test';
import assert from 'node:assert/strict';
import {auditRenderingEvidence} from '../render-audit.mjs';
test('reference to image is not export until fetched byte evidence exists',()=>{
  const model={visible:[{messageId:'m1',resources:{references:[
    {value:'https://cdn.test/image.png?secret=1',kind:'uri',path:'metadata/image'},
    {value:'file-service://attachment',kind:'uri',path:'content/parts/0'}
  ]}}]};
  const assets=[{url:'https://cdn.test/image.png',file:'render-assets/00001.png',
    bytes:123,mime:'image/png',sha256:'a'}];
  const r=auditRenderingEvidence(model,assets,[{fragments:[
    {tag:'table'},{tag:'svg'},{tag:'canvas'}],
    canvases:[{status:'tainted-or-inaccessible'}]}]);
  assert.equal(r.indexedReferences,2);
  assert.equal(r.resolvedByLoadedBrowserResource,1);
  assert.equal(r.unresolvedReferences,1);
  assert.equal(r.byMime.images,1);
  assert.equal(r.rich.tables,1);
  assert.equal(r.rich.svgs,1);
  assert.equal(r.rich.unavailableCanvas,1);
  assert.equal(r.completeRenderingVerified,false);
  assert.ok(r.references.every(x=>!JSON.stringify(x).includes('secret=1')));
});
test('no snapshot and no assets cannot certify complete rendering',()=>{
  const r=auditRenderingEvidence(null,[],[]);
  assert.equal(r.sourceMessageCount,0);
  assert.equal(r.assetsFetched,0);
  assert.equal(r.completeRenderingVerified,false);
});
