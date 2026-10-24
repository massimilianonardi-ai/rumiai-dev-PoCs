'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {renderReadablePreview} from '../../render-readable-image-preview.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-readable-preview-'));
const original=path.join(temp,'localized'), out=path.join(temp,'readable');
const assets=path.join(original,'assets');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(assets,{recursive:true});
const png=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dVsAAAAASUVORK5CYII=',
  'base64');
const pngHash=hash(png);
fs.writeFileSync(path.join(assets,pngHash+'.png'),png);
const sourceHtml='<!doctype html><html><head><style>'+
  '.shadow{height:50000px;overflow:hidden}.invisible{display:none}</style></head><body>'+
  '<main id="cumulative-turns">'+
  '<div data-turn-id-container="turn-1"><section data-testid="conversation-turn-1">'+
  '<div data-message-id="sensitive-1" style="display:none">'+
  '<div class="whitespace-pre-wrap">Primo prompt</div><button>Modifica</button></div></section></div>'+
  '<div data-turn-id-container="turn-2" class="shadow"><section data-testid="conversation-turn-2">'+
  '<div style="height:50000px"><img src="./assets/'+pngHash+'.png"'+
  ' alt="PNG originale" style="display:none" srcset="https://external.invalid/signed?token=secret 2x"></div>'+
  '</section></div>'+
  '<div data-turn-id-container="turn-3"><section data-testid="conversation-turn-3">'+
  '<div data-message-id="sensitive-3"><div class="whitespace-pre-wrap">Secondo prompt'+
  '\ncon due righe</div></div></section></div>'+
  '</main></body></html>';
fs.writeFileSync(path.join(original,'index.html'),sourceHtml);
const audit={status:'provisional-image-preview-assembly',provisionalImagePreview:true,
  turns:[
    {ordinal:1,selected:{kind:'turn.snapshot'}},
    {ordinal:2,selected:{kind:'turn.unidentified-snapshot'}},
    {ordinal:3,selected:{kind:'turn.snapshot'}}
  ]};
fs.writeFileSync(path.join(original,'audit.json'),JSON.stringify(audit));
fs.writeFileSync(path.join(original,'localization-audit.json'),JSON.stringify({
  status:'offline-image-preview-provisional',provisionalImageCandidates:[{
    identityVerified:false,candidateBodySha256:pngHash
  }]
}));
try {
  const report=renderReadablePreview(original,out);
  assert.equal(report.turns,3);
  assert.equal(report.identifiedTextTurns,2);
  assert.equal(report.identifiedTextTurnsWithContent,2);
  assert.equal(report.imageOnlyTurns,1);
  assert.equal(report.imageTurnsWithPng,1);
  assert.equal(report.distinctVerifiedPngBodies,1);
  assert.deepEqual(report.missingTextOrdinals,[]);
  assert.deepEqual(report.missingImageOrdinals,[]);
  const result=fs.readFileSync(path.join(out,'index.html'),'utf8');
  const resultDom=parseHTML(result).document;
  assert.equal(resultDom.querySelectorAll('article.turn').length,3);
  assert.equal(resultDom.querySelectorAll('article.text .message').length,2);
  assert.equal(resultDom.querySelectorAll('article.image img').length,1);
  assert(result.includes('Primo prompt'));
  assert(result.includes('Secondo prompt\ncon due righe'));
  assert(result.indexOf('Primo prompt') < result.indexOf('data:image/png;base64,'));
  assert(result.indexOf('data:image/png;base64,') < result.indexOf('Secondo prompt'));
  assert(result.includes('data:image/png;base64,'+png.toString('base64')));
  for(const forbidden of ['height:50000px','sensitive-1','sensitive-3',
      'https://external.invalid','token=secret','Modifica','srcset=',
      'PNG originale','<script'])
    assert(!result.includes(forbidden),'Unexpected source/private markup '+forbidden);
  assert(result.includes("img-src data:"));
  assert(result.includes("script-src 'none'"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'audit.json'),'utf8')).status,
    'readable-provisional-offline');
  assert(!fs.existsSync(path.join(out,'assets')));
  assert.throws(()=>renderReadablePreview(original,out),/already exists/);

  fs.writeFileSync(path.join(original,'index.html'),sourceHtml.replace(
    'Secondo prompt\ncon due righe',''));
  const missing=renderReadablePreview(original,path.join(temp,'missing'));
  assert.deepEqual(missing.missingTextOrdinals,[3]);
  assert.equal(missing.identifiedTextTurnsWithContent,1);
  fs.writeFileSync(path.join(original,'index.html'),sourceHtml);

  fs.appendFileSync(path.join(assets,pngHash+'.png'),Buffer.from('tampered'));
  const damaged=path.join(temp,'damaged');
  assert.throws(()=>renderReadablePreview(original,damaged),/integrity/);
  assert(!fs.existsSync(damaged));
  console.log('PASS: readable user prompts and embedded local PNG, no React CSS, privacy, CSP, integrity');
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
