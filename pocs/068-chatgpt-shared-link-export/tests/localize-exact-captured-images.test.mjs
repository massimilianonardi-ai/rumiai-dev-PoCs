'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {localizeExactCapturedImages}
  from '../localize-exact-captured-images.mjs';
import {inspectOfflineControlProvenance}
  from '../inspect-offline-control-provenance.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const image=Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  Buffer.from('valid-private-favicon-fixture')]);
const url='https://gstatic.example.net/favicon?host=a&size=32';
const sourceControl='<details class="poc068-source-details">'+
  '<summary>OpenAI +1</summary><div class="poc068-source-links">'+
  '<a href="https://example.net/one">example.net · 1</a>'+
  '<a href="https://example.org/two">example.org · 2</a></div></details>';
const htmlWith=(images)=>'<!doctype html><html><head>'+
  '<meta http-equiv="Content-Security-Policy" content="'+
  "default-src 'none'; script-src 'none'; img-src 'self' data:;"+
  '"><style>.kept{font-size:1rem}</style></head><body>'+
  '<main id="cumulative-turns"><div data-turn-id-container="assistant">'+
  sourceControl+images+'</div></main></body></html>';
function fixture(work)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-exact-local-'));
  const source=path.join(root,'source');
  const cap=path.join(root,'capture');
  const output=path.join(root,'output');
  fs.mkdirSync(path.join(source,'assets'),{recursive:true});
  fs.mkdirSync(path.join(cap,'images'),{recursive:true});
  fs.writeFileSync(path.join(source,'assets','existing.css'),'original-css');
  const hash=sha(image);
  const saved='images/'+hash+'.png';
  fs.writeFileSync(path.join(cap,saved),image);
  const rows=[
    {kind:'network.image-response',sessionId:'session-a',requestId:'1',
      initialUrl:url,requestUrl:url,responseUrl:url},
    {kind:'network.image-body',sessionId:'session-a',requestId:'1',
      status:'saved',file:saved,sha256:hash,bytes:image.length,
      mimeType:'image/png'}];
  fs.writeFileSync(path.join(cap,'events.jsonl'),
    rows.map(JSON.stringify).join('\n')+'\n');
  try{return work({source,cap,output,root,saved,hash,rows});}
  finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('exact captured images are localized and source links remain unchanged',()=>
 fixture(({source,cap,output,hash})=>{
   const sourceHtml=htmlWith(
     '<img data-src="https://untrusted.example/decoy" '+
     'src="https://gstatic.example.net/favicon?host=a&amp;size=32" '+
     'srcset="https://untrusted.example/alternate.png 2x">'+
     '<img src="'+url+'">');
   fs.writeFileSync(path.join(source,'index.html'),sourceHtml);
   const report=localizeExactCapturedImages(source,output,[cap]);
   assert.equal(report.imageReferencesLocalized,2);
   assert.equal(report.uniqueVerifiedImageAssets,1);
   assert.equal(report.originalCspPreserved,true);
   const built=fs.readFileSync(path.join(output,'index.html'),'utf8');
   assert.ok(built.includes(sourceControl),'existing source control unchanged');
   assert.ok(built.includes('<style>.kept{font-size:1rem}</style>'));
   assert.ok(built.includes("script-src 'none'"));
   assert.ok(built.includes('data-src="https://untrusted.example/decoy"'));
   assert.equal((built.match(/src="\.\/assets\/poc068-exact-/g)||[]).length,2);
   assert.ok(!built.includes('srcset='));
   assert.ok(built.includes('poc068-exact-image-assets'));
   assert.ok(built.includes('https://example.net/one'));
   assert.ok(fs.readFileSync(path.join(output,'assets','existing.css'),'utf8')==='original-css');
   const localPath=path.join(output,'assets','poc068-exact-'+hash+'.png');
   assert.ok(fs.readFileSync(localPath).equals(image));
   assert.equal(fs.statSync(localPath).mode&0o077,0);
   assert.equal(fs.readFileSync(path.join(source,'index.html'),'utf8'),sourceHtml);
   const verify=inspectOfflineControlProvenance(output,[cap]);
   assert.equal(verify.remoteImageCount,0);
   assert.equal(verify.nativeSourceGroups,1);
   assert.equal(verify.verifiedSourceLinkElements,2);
 })
);
test('missing source icon evidence refuses all output',()=>
 fixture(({source,cap,output})=>{
   fs.writeFileSync(path.join(source,'index.html'),htmlWith(
     '<img src="'+url+'"><img src="https://missing.example/icon.png">'));
   assert.throws(()=>localizeExactCapturedImages(source,output,[cap]),
     /Unmatched remote image/);
   assert.equal(fs.existsSync(output),false);
 })
);
test('corrupt archived body refuses all output',()=>
 fixture(({source,cap,output,saved})=>{
   fs.writeFileSync(path.join(source,'index.html'),htmlWith(
     '<img src="'+url+'">'));
   fs.writeFileSync(path.join(cap,saved),Buffer.from('corrupt PNG'));
   assert.throws(()=>localizeExactCapturedImages(source,output,[cap]),
     /Conflicting or invalid saved image evidence|Unmatched remote image/);
   assert.equal(fs.existsSync(output),false);
 })
);
test('unsupported mime/header combination is not written',()=>
 fixture(({source,cap,output,rows})=>{
   fs.writeFileSync(path.join(source,'index.html'),htmlWith(
     '<img src="'+url+'">'));
   rows[1].mimeType='image/svg+xml';
   fs.writeFileSync(path.join(cap,'events.jsonl'),
     rows.map(JSON.stringify).join('\n')+'\n');
   assert.throws(()=>localizeExactCapturedImages(source,output,[cap]),
     /unsupported format/);
   assert.equal(fs.existsSync(output),false);
 })
);
test('an unrelated decorative favicon conflict does not block content media',()=>
 fixture(({source,cap,output,rows})=>{
   fs.writeFileSync(path.join(source,'index.html'),htmlWith(
     '<img src="'+url+'">'));
   const secondUrl='https://www.google.com/s2/favicons?domain=example.net';
   const secondImage=Buffer.concat([image,Buffer.from('another')]);
   const secondHash=sha(secondImage);
   fs.writeFileSync(path.join(cap,'images',secondHash+'.png'),secondImage);
   const other=[
     {kind:'network.image-response',sessionId:'session-b',requestId:'2',
       initialUrl:secondUrl,requestUrl:secondUrl,responseUrl:secondUrl},
     {kind:'network.image-body',sessionId:'session-b',requestId:'2',
       status:'saved',file:'images/'+secondHash+'.png',
       sha256:secondHash,bytes:secondImage.length,mimeType:'image/png'},
     {kind:'network.image-response',sessionId:'session-b',requestId:'3',
       initialUrl:secondUrl,requestUrl:secondUrl,responseUrl:secondUrl},
     {kind:'network.image-body',sessionId:'session-b',requestId:'3',
       status:'saved',file:rows[1].file,sha256:rows[1].sha256,
       bytes:rows[1].bytes,mimeType:'image/png'}];
   fs.writeFileSync(path.join(cap,'events.jsonl'),
     [...rows,...other].map(JSON.stringify).join('\n')+'\n');
   const result=localizeExactCapturedImages(source,output,[cap]);
   assert.equal(result.imageReferencesLocalized,1);
   assert.ok(fs.readFileSync(path.join(output,'index.html'),'utf8')
     .includes('poc068-exact-'));
 })
);

test('an existing output and a repeated localization are rejected',()=>
 fixture(({source,cap,output,root})=>{
   fs.writeFileSync(path.join(source,'index.html'),htmlWith(
     '<img src="'+url+'">'));
   fs.mkdirSync(output);
   assert.throws(()=>localizeExactCapturedImages(source,output,[cap]),
     /New output/);
   fs.rmdirSync(output);
   localizeExactCapturedImages(source,output,[cap]);
   const second=path.join(root,'second');
   assert.throws(()=>localizeExactCapturedImages(output,second,[cap]),
     /already contains exact image localization marker/);
 })
);
