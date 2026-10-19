import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startViewer} from '../serve.mjs';

test('evidence viewer serves past comparisons and denies MHTML/file portal downloads',async()=>{
  const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
  const evidence=path.join(root,'evidence');
  await fs.mkdir(evidence,{recursive:true});
  const directory=await fs.mkdtemp(path.join(evidence,'viewer-test-'));
  let server;
  try{
    const amazon=path.join(directory,'amazon-wishlist');
    const state=path.join(amazon,'states','0000');
    await fs.mkdir(state,{recursive:true});
    await fs.writeFile(path.join(amazon,'comparison.html'),
      '<!doctype html><img src="states/0000/original.png">');
    await fs.writeFile(path.join(amazon,'collage.html'),
      '<!doctype html><p>collage</p>');
    await fs.writeFile(path.join(state,'original.png'),Buffer.from([137,80,78,71]));
    await fs.writeFile(path.join(state,'page.mhtml'),'raw private archive');
    const manual=path.join(amazon,'manual');
    await fs.mkdir(manual);
    await fs.writeFile(path.join(manual,'manual.html'),
      '<!doctype html><img src="0000.png">');
    await fs.writeFile(path.join(manual,'source-review.html'),
      '<!doctype html><h1>Original human browser</h1>');
    await fs.writeFile(path.join(manual,'0000.png'),Buffer.from([137,80,78,71]));
    await fs.writeFile(path.join(manual,'0000.json'),'{}');
    await fs.writeFile(path.join(manual,'page.mhtml'),'private manual');
    const viewed=await startViewer(path.basename(directory));
    server=viewed.server;
    const original=await fetch(viewed.url+'amazon-wishlist/comparison.html');
    assert.equal(original.status,200);
    assert.match(await original.text(),/states\/0000\/original.png/);
    const image=await fetch(viewed.url+'amazon-wishlist/states/0000/original.png');
    assert.equal(image.status,200);
    assert.equal(image.headers.get('content-type'),'image/png');
    const collage=await fetch(viewed.url+'amazon-wishlist/collage.html');
    assert.equal(collage.status,200);
    assert.match(await collage.text(),/collage/);
    const manualView=await fetch(viewed.url+'amazon-wishlist/manual/manual.html');
    assert.equal(manualView.status,200);
    assert.match(await manualView.text(),/0000.png/);
    const firstPartyReview=await fetch(
      viewed.url+'amazon-wishlist/manual/source-review.html');
    assert.equal(firstPartyReview.status,404);
    // The allowlist is ChatGPT-specific; create the corresponding artifact
    // without exposing unrelated private site files.
    const chat=path.join(directory,'chatgpt-share','manual');
    await fs.mkdir(chat,{recursive:true});
    await fs.writeFile(path.join(chat,'source-review.html'),
      '<!doctype html><h1>ChatGPT original</h1>');
    const primary=await fetch(
      viewed.url+'chatgpt-share/manual/source-review.html');
    assert.equal(primary.status,200);
    assert.match(await primary.text(),/ChatGPT original/);
    const rootPage=await fetch(viewed.url);
    assert.match(await rootPage.text(),/Sorgente originale ChatGPT/);
    assert.equal((await fetch(viewed.url+'amazon-wishlist/manual/0000.png')).status,200);
    assert.equal((await fetch(viewed.url+'amazon-wishlist/manual/0000.json')).status,200);
    for(const relative of [
      'amazon-wishlist/states/0000/page.mhtml',
      'amazon-wishlist/manual/page.mhtml',
      'amazon-wishlist/states/0000/unsupported.json',
      'chatgpt-share/../../.runtime/pwc/package.json'
    ]){
      const result=await fetch(viewed.url+relative);
      assert.equal(result.status,404);
    }
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await fs.rm(directory,{recursive:true,force:true});
  }
});
