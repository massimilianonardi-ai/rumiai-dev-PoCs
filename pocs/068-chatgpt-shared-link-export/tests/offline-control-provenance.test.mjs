'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectOfflineControlProvenance}
  from '../inspect-offline-control-provenance.mjs';

function temporary(callback)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-control-provenance-'));
  try{return callback(root);}
  finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('keeps standalone sources and singleton candidates separate, and matches only saved exact image bytes',()=>
 temporary(root=>{
   const out=path.join(root,'output');
   const capture=path.join(root,'capture');
   fs.mkdirSync(out);
   fs.mkdirSync(path.join(capture,'images'),{recursive:true});
   const url='https://assets.example/private/favicon.png';
   const missing='https://missing.example/unknown.png';
   fs.writeFileSync(path.join(out,'index.html'),
     '<html><head><meta http-equiv="Content-Security-Policy" '+
     'content="script-src &#39;none&#39;; img-src &#39;self&#39;;"></head>'+
     '<body><div data-turn-id-container="m">'+
     '<div data-testid="conversation-turn-2">'+
     '<details class="poc068-source-details"><summary>OpenAI +1</summary>'+
     '<div class="poc068-source-links">'+
     '<a href="https://private.example/one">one</a>'+
     '<a href="https://private.example/two">two</a></div></details>'+
     '<button>Fonti</button>'+
     '<span aria-haspopup="dialog"><span>External citation</span></span>'+
     '<img src="'+url+'"><img src="'+missing+'">'+
     '</div></div></body></html>');
   const content=Buffer.from('some-example-image-body-verifiable');
   const hash=crypto.createHash('sha256').update(content).digest('hex');
   const file='images/'+hash+'.png';
   fs.writeFileSync(path.join(capture,file),content);
   fs.writeFileSync(path.join(capture,'events.jsonl'),[
     {kind:'network.image-response',sessionId:'s1',requestId:'r1',
       initialUrl:url,requestUrl:url,responseUrl:url},
     {kind:'network.image-body',sessionId:'s1',requestId:'r1',
       file,sha256:hash,bytes:content.length,status:'saved',mimeType:'image/png'}
   ].map(JSON.stringify).join('\n')+'\n');
   const report=inspectOfflineControlProvenance(out,[capture]);
   assert.equal(report.nativeSourceGroups,1);
   assert.equal(report.verifiedSourceLinkElements,2);
   assert.equal(report.linksWithoutInlineIcons,2);
   assert.equal(report.standaloneSources.length,1);
   assert.equal(report.standaloneSources[0].ordinal,2);
   assert.equal(report.singletonTriggerCandidates.length,1);
   assert.equal(report.remoteImageCount,2);
   assert.equal(report.remoteImagesWithExactSavedBody,1);
   assert.equal(report.remoteImagesMissingSavedBody,1);
   assert.equal(report.verifiedImageBodies,1);
   assert.equal(report.imageEvidenceConflicts,0);
   const publicReport=JSON.stringify(report);
   assert.ok(!publicReport.includes('private.example'));
   assert.ok(!publicReport.includes('assets.example'));
   assert.ok(!publicReport.includes(hash));
   assert.ok(!publicReport.includes('External citation'));
 })
);
test('invalid image hash is not promoted to matching archived image',()=>
 temporary(root=>{
   const out=path.join(root,'output');
   const capture=path.join(root,'capture');
   fs.mkdirSync(out);
   fs.mkdirSync(path.join(capture,'images'),{recursive:true});
   const uri='https://example.org/private/icon.png';
   fs.writeFileSync(path.join(out,'index.html'),
     '<html><body><img src="'+uri+'"></body></html>');
   const bytes=Buffer.from('body-to-be-corrupted');
   const hash=crypto.createHash('sha256').update(bytes).digest('hex');
   const file='images/'+hash+'.png';
   fs.writeFileSync(path.join(capture,file),Buffer.from('incorrect bytes'));
   fs.writeFileSync(path.join(capture,'events.jsonl'),[
     {kind:'network.image-response',sessionId:'a',requestId:'b',
       initialUrl:uri,requestUrl:uri,responseUrl:uri},
     {kind:'network.image-body',sessionId:'a',requestId:'b',
       file,sha256:hash,bytes:bytes.length,status:'saved'}
   ].map(JSON.stringify).join('\n')+'\n');
   const report=inspectOfflineControlProvenance(out,[capture]);
   assert.equal(report.remoteImagesWithExactSavedBody,0);
   assert.equal(report.remoteImagesMissingSavedBody,1);
   assert.equal(report.verifiedImageBodies,0);
   assert.equal(report.imageEvidenceConflicts,1);
 })
);
