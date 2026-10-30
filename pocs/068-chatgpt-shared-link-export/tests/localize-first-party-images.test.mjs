import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {localizeFirstPartyImages} from '../localize-first-party-images.mjs';

const image=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9r3FEAAAAASUVORK5CYII=',
  'base64');
const imageUrl='https://chatgpt.com/images/ecosystem/apps/github/icon.png';
function fixture(html)
{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-first-party-'));
  fs.writeFileSync(path.join(dir,'index.html'),
    "<meta content=\"script-src 'none'\">"+html);
  return {dir,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('localizes exact root-relative same-origin IMG with SHA-verified PNG and no remote srcset',async()=>{
  const f=fixture('<img src="/images/ecosystem/apps/github/icon.png" '+
    'srcset="/images/ecosystem/apps/github/icon.png 2x">');
  const urls=[];
  try
  {
    const r=await localizeFirstPartyImages(f.dir,{fetcher:async(url,options)=>{
      assert.match(options.headers?.['User-Agent']||'',/Chrome\/140/);
      urls.push({url,redirect:options.redirect});
      return new Response(image,{headers:{'content-type':'image/png'}});
    }});
    assert.deepEqual(urls,[{url:imageUrl,redirect:'error'}]);
    assert.deepEqual(r,{localized:1,assets:1});
    const html=fs.readFileSync(path.join(f.dir,'index.html'),'utf8');
    assert.match(html,/src="\./);
    assert.doesNotMatch(html,/\bsrcset=/);
    assert.doesNotMatch(html,/src="\/images/);
    const files=fs.readdirSync(path.join(f.dir,'assets'));
    assert.equal(files.length,1);
    assert.match(files[0],/^poc068-first-party-[a-f0-9]{64}\.png$/);
    assert.deepEqual(fs.readFileSync(path.join(f.dir,'assets',files[0])),image);
  }
  finally{f.close();}
});
test('missing first-party image refuses changes rather than inventing a substitute',async()=>{
  const original='<img src="/images/ecosystem/apps/github/icon.png">';
  const f=fixture(original);
  try
  {
    await assert.rejects(localizeFirstPartyImages(f.dir,{fetcher:async()=>new Response(
      'not found',{status:404})}),/not retrievable/);
    assert.equal(fs.readFileSync(path.join(f.dir,'index.html'),'utf8'),
      "<meta content=\"script-src 'none'\">"+original);
    assert.equal(fs.existsSync(path.join(f.dir,'assets')),false);
  }
  finally{f.close();}
});
test('rejects MIME and image signature mismatch before writing',async()=>{
  const f=fixture('<img src="/images/ecosystem/apps/github/icon.png">');
  try
  {
    await assert.rejects(localizeFirstPartyImages(f.dir,{fetcher:async()=>new Response(
      'not a PNG',{headers:{'content-type':'image/png'}})}),/signature mismatch/);
    assert.equal(fs.existsSync(path.join(f.dir,'assets')),false);
  }
  finally{f.close();}
});
test('ordinary local IMG references do not trigger network fetches',async()=>{
  const f=fixture('<img src="./assets/preexisting.png">');
  try
  {
    const r=await localizeFirstPartyImages(f.dir,{fetcher:async()=>{
      throw Error('network should not be used');
    }});
    assert.deepEqual(r,{localized:0,assets:0});
  }
  finally{f.close();}
});
