'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {renderSameSessionOffline} from '../../render-same-session-offline.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-same-session-offline-'));
const capture=path.join(tmp,'capture'), turns=path.join(capture,'turns');
const images=path.join(capture,'images'),out=path.join(tmp,'reading');
fs.mkdirSync(turns,{recursive:true});fs.mkdirSync(images);
const png=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dVsAAAAASUVORK5CYII=',
  'base64');
const bodyHash=sha(png);
const imageUrl='https://media.example.test/image.png?token=private-signature';
const records=[];
let sequence=0;
function append(row) {records.push({sequence:++sequence,...row});}
function snapshot(n,kind,html,ids,selected=[])
{
  const bytes=Buffer.from(html);
  const digest=sha(bytes),file='turns/'+digest+'.html';
  fs.writeFileSync(path.join(capture,file),bytes);
  append({kind,turnId:'private-turn-'+n,sessionId:'capture-1',
    messageIds:ids,bytes:bytes.length,sha256:digest,file,imageSelections:selected});
}
try
{
  snapshot(1,'turn.snapshot',
    '<section data-turn-id-container="private-turn-1"><div data-testid="conversation-turn-1">'+
    '<div data-message-id="private-message-1" style="display:none">'+
    '<div class="whitespace-pre-wrap">Prima domanda</div>'+
    '<div class="markdown"><p><strong>Risposta forte</strong> con '+
    '<a href="https://source.example.org/document"><img width="16" height="16" '+
    'src="https://source.example.org/favicon.ico">Fonte ufficiale</a></p></div>'+
    '<button>Copy</button></div></div></section>',
    ['private-message-1'],
    [{src:'https://source.example.org/favicon.ico',
      resolvedSrc:'https://source.example.org/favicon.ico',currentSrc:null}]);
  snapshot(2,'turn.unidentified-snapshot',
    '<section data-turn-id-container="private-turn-2" class="shadow">'+
    '<div data-testid="conversation-turn-2"><img src="'+imageUrl+
    '" style="display:none" srcset="https://evil.invalid/remote?private-token 2x"></div></section>',
    [],[{src:imageUrl,resolvedSrc:imageUrl,currentSrc:imageUrl}]);
  snapshot(3,'turn.snapshot',
    '<section data-turn-id-container="private-turn-3"><div data-testid="conversation-turn-3">'+
    '<div data-message-id="private-message-3"><div class="markdown">'+
    '<p>Seconda domanda</p><span class="katex"><math><mfrac><mi>x</mi>'+
    '<mi>y</mi></mfrac></math></span>'+
    '<span class="katex"><span class="katex-html" aria-hidden="true">'+
    '<span class="base"><span class="mord mathnormal">z</span>'+
    '<span class="msupsub"><span class="vlist-t"><span class="vlist-r">'+
    '<span class="vlist" style="height:0.9em">'+
    '<span style="top:-2.5em"><span class="mord">2</span></span>'+
    '</span></span></span></span></span></span></span>'+
    '</div></div></div></section>',
    ['private-message-3']);
  fs.writeFileSync(path.join(images,bodyHash+'.png'),png);
  append({kind:'network.image-response',sessionId:'capture-1',requestId:'private-request',
    initialUrl:imageUrl,requestUrl:imageUrl,responseUrl:imageUrl,
    mimeType:'image/png',status:200});
  append({kind:'network.image-body',sessionId:'capture-1',requestId:'private-request',
    status:'saved',file:'images/'+bodyHash+'.png',sha256:bodyHash,bytes:png.length,
    mimeType:'image/png'});
  const persist=()=>fs.writeFileSync(path.join(capture,'events.jsonl'),
    records.map(JSON.stringify).join('\n')+'\n');
  persist();

  const result=renderSameSessionOffline(capture,out);
  assert.equal(result.status,'same-session-offline');
  assert.equal(result.turns,3);
  assert.equal(result.textTurnsWithContent,2);
  assert.equal(result.imageBearingTurns,1);
  assert.equal(result.imageTurnsWithVerifiedBodies,1);
  assert.equal(result.distinctVerifiedImageBodies,1);
  assert.equal(result.unmatchedImageReferences,0);
  assert.equal(result.preservedMathFormulas,1);
  assert.equal(result.visualKatexFormulas,1);
  assert.equal(result.linkedSources,1);
  assert.equal(result.suppressedDecorativeImages,1);
  assert.deepEqual(result.missingTurnOrdinals,[]);
  const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  assert(html.includes('Prima domanda'));
  assert(html.includes('Seconda domanda'));
  assert(html.includes('<strong>Risposta forte</strong>'));
  assert(html.includes('<math><mfrac><mi>x</mi><mi>y</mi></mfrac></math>'));
  assert(html.includes('class="katex-html"'));
  assert(html.includes('class="vlist-t"'));
  assert(html.includes('data:font/woff2;base64,'),
    'KaTeX offline font bytes must be embedded in standalone HTML');
  assert(!html.includes('url(fonts/'), 'KaTeX output may not fetch local/external fonts');
  assert(html.includes('href="https://source.example.org/document"'));
  assert(html.includes('data:image/png;base64,'+png.toString('base64')));
  assert(html.indexOf('Prima domanda')<html.indexOf('data:image/png;base64,'));
  assert(html.indexOf('data:image/png;base64,')<html.indexOf('Seconda domanda'));
  for (const token of ['private-message','private-turn','private-request',
    'private-signature','private-token','evil.invalid','display:none','<script','srcset=','Copy'])
    assert(!html.includes(token),'Leaked captured markup or URL: '+token);
  const doc=parseHTML(html).document;
  assert.equal(doc.querySelectorAll('article.turn').length,3);
  assert.equal(doc.querySelectorAll('img').length,1);
  assert(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute('content').includes("script-src 'none'"));
  assert(!fs.existsSync(path.join(out,'images')));
  assert.throws(()=>renderSameSessionOffline(capture,out),/already exists/);

  // A second exact request with unavailable bytes is *not* guessed from the
  // first URL's path, even when the origin and path are identical.
  const otherUrl='https://media.example.test/image.png?token=other-signature';
  snapshot(4,'turn.unidentified-snapshot',
    '<section data-turn-id-container="private-turn-4"><div data-testid="conversation-turn-4">'+
    '<img src="'+otherUrl+'"></div></section>',
    [],[{src:otherUrl,resolvedSrc:otherUrl,currentSrc:null}]);
  persist();
  const partial=renderSameSessionOffline(capture,path.join(tmp,'partial'));
  assert.equal(partial.status,'same-session-offline-partial');
  assert.deepEqual(partial.missingImageOrdinals,[4]);
  assert.equal(partial.unmatchedImageReferences,1);

  // A text-only capture must render without requiring any image response.
  const plain=path.join(tmp,'text-capture');
  fs.mkdirSync(path.join(plain,'turns'),{recursive:true});
  const simple=Buffer.from('<section data-turn-id-container="private-turn-t">'+
    '<div data-testid="conversation-turn-0"><div data-message-id="message-t">'+
    '<p>Solo testo</p></div></div></section>');
  const sh=sha(simple);
  fs.writeFileSync(path.join(plain,'turns',sh+'.html'),simple);
  fs.writeFileSync(path.join(plain,'events.jsonl'),JSON.stringify({
    kind:'turn.snapshot',sequence:1,turnId:'private-turn-t',sessionId:'s',
    file:'turns/'+sh+'.html',sha256:sh,bytes:simple.length,
    messageIds:['message-t'],imageSelections:[]
  })+'\n');
  const plainResult=renderSameSessionOffline(plain,path.join(tmp,'plain-reading'));
  assert.equal(plainResult.status,'same-session-offline');
  assert.equal(plainResult.textTurnsWithContent,1);
  assert.equal(plainResult.imageBearingTurns,0);

  // Byte corruption must be detected before writing any artifact.
  fs.appendFileSync(path.join(images,bodyHash+'.png'),Buffer.from('tamper'));
  const broken=path.join(tmp,'tampered');
  assert.throws(()=>renderSameSessionOffline(capture,broken),/integrity/);
  assert(!fs.existsSync(broken));
  console.log('PASS: same-session offline text, exact CDP-request image bytes, CSP, privacy, partial and tamper');
}
finally {fs.rmSync(tmp,{recursive:true,force:true});}
