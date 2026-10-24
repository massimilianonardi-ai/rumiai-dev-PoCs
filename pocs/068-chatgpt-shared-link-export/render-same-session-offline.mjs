'use strict';
// Privacy-preserving report and inert content view from a single CDP capture.
// Requires --capture-image-bodies; never fetches network content during rendering.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {embeddedKatexCss} from './embed-katex-css.mjs';
import {assemble} from './assemble-rendered-dom.mjs';
import {escapeHtml} from './render-readable-image-preview.mjs';
import {renderSemanticMessage,renderSemanticTree,createSemanticStats}
  from './render-semantic-content.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const imageFile = /^images\/([a-f0-9]{64})\.(png|jpg|webp|gif)$/;
const types = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
const signatures = {
  png:bytes => bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
  jpg:bytes => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
  webp:bytes => bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP',
  gif:bytes => ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))
};
function readJsonl(filename)
{
  return fs.readFileSync(filename,'utf8').split(/\r?\n/).filter(Boolean).map((line,index) =>
  {
    try {return JSON.parse(line);}
    catch {throw Error('Invalid capture event at line '+(index+1));}
  });
}
function absoluteUrl(value)
{
  if (typeof value !== 'string' || !value) return null;
  try
  {
    const url = new URL(value);
    if (!['https:','http:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  }
  catch {return null;}
}
function safeBody(capture,event)
{
  const match = imageFile.exec(event.file || '');
  if (!match || match[1] !== event.sha256 ||
      types[event.mimeType] !== match[2])
    throw Error('Unsafe image-body provenance');
  const bytes = fs.readFileSync(path.join(capture,event.file));
  if (bytes.length !== event.bytes || bytes.length > 12*1024*1024 ||
      bytes.length < 12 || sha256(bytes) !== match[1] ||
      !signatures[match[2]](bytes))
    throw Error('Captured image integrity or signature failed');
  return {hash:match[1],mime:event.mimeType,bytes};
}
function mediaIndex(capture,events)
{
  const requests = new Map();
  const bodies = new Map();
  for (const event of events)
  {
    if (event.kind !== 'network.image-response' &&
        event.kind !== 'network.image-body') continue;
    const key = JSON.stringify([event.sessionId,event.requestId]);
    if (event.kind === 'network.image-response')
    {
      if (!requests.has(key)) requests.set(key, []);
      requests.get(key).push(event);
    }
    else if (event.status === 'saved')
    {
      if (bodies.has(key)) throw Error('Duplicate body identity for one CDP request');
      bodies.set(key,safeBody(capture,event));
    }
  }
  const bySession = new Map();
  for (const [key,body] of bodies)
  {
    const rows = requests.get(key) || [];
    if (rows.length !== 1) throw Error('Ambiguous image response identity for captured body');
    const row = rows[0], session = row.sessionId || '';
    if (!bySession.has(session)) bySession.set(session,new Map());
    const urls = [row.initialUrl,row.requestUrl,row.responseUrl]
      .map(absoluteUrl).filter(Boolean);
    if (!urls.length) throw Error('Image response has no usable request URL');
    for (const url of urls)
    {
      const byUrl = bySession.get(session);
      if (!byUrl.has(url)) byUrl.set(url,new Map());
      byUrl.get(url).set(body.hash,body);
    }
  }
  return bySession;
}
function chooseImage(index,session,selection)
{
  // currentSrc is the browser's selected URL. A missing currentSrc may be
  // resolved from src only if an exact CDP request has a verified saved body.
  const current = absoluteUrl(selection?.currentSrc);
  const source = absoluteUrl(selection?.resolvedSrc || selection?.src);
  const url = current || source;
  if (!url) return {status:'not-http-image'};
  const found = index.get(session || '')?.get(url);
  if (!found || !found.size) return {status:'not-captured'};
  if (found.size !== 1) return {status:'ambiguous-url-bodies'};
  return {status:'verified-request-body',body:[...found.values()][0],
    usedSourceFallback:!current};
}

export function renderSameSessionOffline(captureDir,outputDir)
{
  const capture = path.resolve(captureDir), output = path.resolve(outputDir);
  if (capture === output || output.startsWith(capture + path.sep))
    throw Error('Output must not be inside capture directory');
  if (fs.existsSync(output)) throw Error('Output already exists: '+output);
  const events = readJsonl(path.join(capture,'events.jsonl'));
  const media = mediaIndex(capture,events);
  const snapshots = new Map(events
    .filter(e => e.kind === 'turn.snapshot' || e.kind === 'turn.unidentified-snapshot')
    .map(e => [e.sequence,e]));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'poc068-offline-'));
  let audit;
  try
  {
    assemble(capture,path.join(temp,'assembled'),null,{includeUnidentifiedImages:true});
    audit = JSON.parse(fs.readFileSync(path.join(temp,'assembled','audit.json'),'utf8'));
  }
  finally {fs.rmSync(temp,{recursive:true,force:true});}
  const counts = {status:'same-session-offline',turns:0,textTurns:0,
    textTurnsWithContent:0,imageBearingTurns:0,imageTurnsWithVerifiedBodies:0,
    embeddedImageOccurrences:0,distinctVerifiedImageBodies:0,
    unmatchedImageReferences:0,ambiguousImageReferences:0,
    srcFallbackAfterAbsentCurrentSrc:0,
    preservedMathFormulas:0,visualKatexFormulas:0,
    mathSourceFallbacks:0,unavailableMathFormulas:0,
    linkedSources:0,suppressedDecorativeImages:0,
    missingTextOrdinals:[],missingImageOrdinals:[],
    missingTurnOrdinals:audit.missingOrdinals,
    rawMessageAttribution:'not-verified',
    visualAndSemanticFidelity:'requires-operator-verification',
    limitations:[
      'Only observed DOM turn snapshots are represented; original RAW conversation completeness is not established',
      'Image bytes are tied to exact CDP request URLs and session/request identifiers, not merely matching paths',
      'Semantic HTML is rebuilt from captured nodes; KaTeX visual-only formulas use a pinned offline CSS/font rendition that still requires physical visual verification',
      'Browser pixels, image-role ownership and assistant finality are not proven',
      'currentSrc-unavailable snapshots use src only when the exact same-session request body is saved',
      'This independent, inert reading layout does not reproduce ChatGPT styling'
    ]};
  const fragments = [], usedBodies = new Set();
  for (const turn of audit.turns)
  {
    counts.turns++;
    const event = snapshots.get(turn.selected.sequence);
    if (!event || event.file !== turn.selected.file ||
        event.sha256 !== turn.selected.sha256)
      throw Error('Selected turn provenance mismatch');
    const file = /^turns\/([a-f0-9]{64})\.html$/.exec(event.file || '');
    if (!file || file[1] !== event.sha256) throw Error('Unsafe turn snapshot reference');
    const bytes = fs.readFileSync(path.join(capture,event.file));
    if (sha256(bytes) !== event.sha256 || bytes.length !== event.bytes)
      throw Error('Turn snapshot integrity failed');
    const {document} = parseHTML(bytes.toString('utf8'));
    const wrapper = document.querySelector('[data-turn-id-container]');
    if (!wrapper) throw Error('Missing captured turn wrapper');
    const qualified = [...wrapper.querySelectorAll('[data-message-id]')]
      .filter(node => !node.parentElement?.closest('[data-message-id]'));
    const imgs = [...wrapper.querySelectorAll('img')];
    const selections = event.imageSelections;
    if (imgs.length && (!Array.isArray(selections) ||
        imgs.length > selections.length))
      throw Error('Missing browser-selected image URL evidence in turn '+turn.ordinal);
    const lookup = new Map(imgs.map((img,i) =>
      [img,chooseImage(media,event.sessionId,selections[i])]));
    const semantic = createSemanticStats();
    const resolver = img => lookup.get(img) || {status:'not-captured'};
    let contents = '';
    if (qualified.length)
    {
      counts.textTurns++;
      const parts=qualified.map(node => renderSemanticMessage(node,resolver,semantic))
        .filter(x => x.trim());
      if (parts.length)
      {
        counts.textTurnsWithContent++;
        contents+=parts.map(x=>'<div class="message">'+x+'</div>').join('');
      }
      else counts.missingTextOrdinals.push(turn.ordinal);
    }
    else
    {
      contents=renderSemanticTree(wrapper,resolver,semantic);
    }
    // Images/citation links outside message nodes are legitimate in some
    // assistant layouts. Do not discard them or append arbitrary icons.
    if (qualified.length)
    {
      const outside = imgs.filter(img => !qualified.some(m => m.contains(img)));
      const handledAnchors=new Set();
      for (const img of outside)
      {
        const anchor=img.closest('a[href]');
        if (anchor && !qualified.some(m => m.contains(anchor)))
        {
          if (handledAnchors.has(anchor)) continue;
          handledAnchors.add(anchor);
          contents+=renderSemanticTree(anchor,resolver,semantic);
        }
        else contents+=renderSemanticTree(img,resolver,semantic);
      }
    }
    if (semantic.contentImageOccurrences+semantic.unmatchedContentImages)
    {
      counts.imageBearingTurns++;
      if (semantic.contentImageOccurrences) counts.imageTurnsWithVerifiedBodies++;
      else counts.missingImageOrdinals.push(turn.ordinal);
    }
    counts.unmatchedImageReferences+=semantic.unmatchedContentImages;
    counts.embeddedImageOccurrences+=semantic.contentImageOccurrences;
    counts.srcFallbackAfterAbsentCurrentSrc+=semantic.srcFallbackAfterAbsentCurrentSrc;
    counts.preservedMathFormulas+=semantic.mathPreserved;
    counts.visualKatexFormulas+=semantic.mathVisualPreserved;
    counts.mathSourceFallbacks+=semantic.mathFallback;
    counts.unavailableMathFormulas+=semantic.mathUnavailable;
    counts.linkedSources+=semantic.linkedSources;
    counts.suppressedDecorativeImages+=semantic.suppressedDecorativeImages;
    for (const hash of semantic.usedBodies) usedBodies.add(hash);
    fragments.push('<article class="turn"><h2>Turno '+turn.ordinal+'</h2>'+
      (contents || '<p>Contenuto non recuperato negli snapshot selezionati.</p>')+
      '</article>');
  }
  counts.distinctVerifiedImageBodies=usedBodies.size;
  if (counts.missingImageOrdinals.length || counts.unmatchedImageReferences ||
      counts.unavailableMathFormulas || counts.missingTextOrdinals.length)
    counts.status='same-session-offline-partial';
  const css='body{font:16px/1.6 system-ui,sans-serif;max-width:950px;'+
    'margin:0 auto;padding:24px;color:#222;background:#f6f6f6}'+
    'h1{font-size:1.5rem}h2{font-size:1.08rem}.turn{background:white;'+
    'border:1px solid #ddd;border-radius:10px;margin:20px 0;padding:20px}'+
    '.message{overflow-wrap:anywhere}.message+.message{margin-top:1rem}'+
    '.message p{margin:.6em 0}.message h1,.message h2,.message h3{margin:1em 0 .35em}'+
    '.message ul,.message ol{padding-left:1.6em;margin:.5em 0}'+
    '.message blockquote{border-left:3px solid #bbb;padding-left:1em;color:#555}'+
    '.message pre{overflow-x:auto;background:#f4f4f4;padding:12px;border-radius:6px}'+
    '.message code{font:0.92em ui-monospace,monospace}'+
    '.message :not(pre)>code{background:#f4f4f4;padding:1px 4px;border-radius:4px}'+
    '.message table{border-collapse:collapse;display:block;overflow-x:auto}'+
    '.message td,.message th{border:1px solid #ccc;padding:6px 9px}'+
    '.message a{color:#0759aa;text-decoration:underline;overflow-wrap:anywhere}'+
    '.message math{font-size:1.13em}.message .math-missing{color:#8a5400}'+
    '.prewrap{white-space:pre-wrap}figure{margin:16px 0}'+
    'figure img{display:block;max-width:100%;height:auto;border-radius:6px}'+
    'figcaption,small{color:#555;font-size:.85rem}';
  // The source KaTeX HTML is already typeset and needs CSS/font assets, not
  // executable JavaScript. Embed pinned CSS/WOFF2 only when used.
  const katexCss=counts.visualKatexFormulas ? embeddedKatexCss() : '';
  const csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; "+
    "script-src 'none'; connect-src 'none'; font-src data:; frame-src 'none'; "+
    "object-src 'none'; base-uri 'none'; form-action 'none'";
  const html='<!doctype html><html lang="it"><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="'+escapeHtml(csp)+'">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>PoC 068 — archivio offline</title><style>'+css+'\n'+katexCss+'</style></head>'+
    '<body><h1>Conversazione — lettura offline</h1>'+
    '<small>Acquisizione nella stessa sessione Chromium; risorse immagine verificate con SHA-256.'+
    ' La completezza della conversazione e il ruolo dei turni immagine restano da verificare.</small>'+
    '<main>'+fragments.join('\n')+'</main></body></html>\n';
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(output,'index.html'),html,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(counts,null,2)+'\n',
    {flag:'wx',mode:0o600});
  return {output,...counts};
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))
{
  if (process.argv.length !== 4)
  {
    console.error('Usage: node render-same-session-offline.mjs <capture-dir> <new-output-dir>');
    process.exitCode=2;
  }
  else
  {
    try {console.log(JSON.stringify(renderSameSessionOffline(process.argv[2],process.argv[3]),null,2));}
    catch (error) {console.error(error.message);process.exitCode=1;}
  }
}
