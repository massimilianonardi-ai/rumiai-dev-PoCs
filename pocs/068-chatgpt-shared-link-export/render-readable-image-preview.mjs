'use strict';
// Readable, offline evidence view for an explicitly provisional PoC 068 image
// assembly. Intentionally does not replay React DOM or ChatGPT CSS.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pngName = /^\.\/assets\/([a-f0-9]{64})\.png$/;
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
const ignoredTags = new Set(['button','svg','script','style','noscript','template','input','select','textarea']);
const blockTags = new Set(['div','section','article','p','pre','blockquote','li','ul','ol','h1','h2','h3','h4','h5','h6']);

function readText(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const name = node.localName?.toLowerCase();
  if (ignoredTags.has(name) || node.getAttribute('aria-hidden') === 'true' ||
      node.hasAttribute('hidden')) return '';
  if (name === 'br') return '\n';
  if (name === 'img') return '';
  const text = [...node.childNodes].map(readText).join('');
  return blockTags.has(name) ? text + '\n' : text;
}

function messageText(node) {
  const target = node.querySelector('[data-testid="message-content"]') ||
    node.querySelector('.whitespace-pre-wrap') ||
    node.querySelector('.markdown') || node;
  return readText(target).replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function localPng(root, src, cache) {
  const match = pngName.exec(src || '');
  if (!match) return null;
  if (cache.has(match[1])) return cache.get(match[1]);
  const bytes = fs.readFileSync(path.join(root, 'assets', match[1] + '.png'));
  if (bytes.length > 12 * 1024 * 1024 || bytes.length < 24 ||
      hash(bytes) !== match[1] || !bytes.subarray(0,8).equals(pngSignature))
    throw Error('Localized PNG failed integrity or signature verification');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 16384 || height > 16384)
    throw Error('Localized PNG has invalid dimensions');
  const value = {src:'data:image/png;base64,' + bytes.toString('base64'), width, height};
  cache.set(match[1], value);
  return value;
}

export function renderReadablePreview(localizedDir, newOutputDir) {
  const source = path.resolve(localizedDir), output = path.resolve(newOutputDir);
  if (source === output || output.startsWith(source + path.sep))
    throw Error('Output must be outside the source directory');
  if (fs.existsSync(output)) throw Error('Output already exists: ' + output);
  const audit = JSON.parse(fs.readFileSync(path.join(source,'audit.json'), 'utf8'));
  const localization = JSON.parse(fs.readFileSync(path.join(source,'localization-audit.json'), 'utf8'));
  if (audit.status !== 'provisional-image-preview-assembly' ||
      audit.provisionalImagePreview !== true ||
      localization.status !== 'offline-image-preview-provisional')
    throw Error('Readable view requires an explicitly provisional localized image preview');
  if (!Array.isArray(audit.turns) || !audit.turns.length)
    throw Error('Source audit has no turns');
  const {document} = parseHTML(fs.readFileSync(path.join(source,'index.html'),'utf8'));
  const main = document.querySelector('#cumulative-turns');
  if (!main) throw Error('No cumulative turn container');
  const wrappers = [...main.children].filter(node =>
    node.hasAttribute('data-turn-id-container'));
  if (wrappers.length !== audit.turns.length)
    throw Error('Source HTML turn count disagrees with capture audit');
  const cache = new Map(), fragments = [];
  const result = {status:'readable-provisional-offline', turns:0, identifiedTextTurns:0,
    identifiedTextTurnsWithContent:0, imageOnlyTurns:0, imageTurnsWithPng:0,
    distinctVerifiedPngBodies:0, missingTextOrdinals:[], missingImageOrdinals:[],
    limitations:['This is a diagnostic reading view, not a faithful ChatGPT layout',
      'Unidentified image turns are not linked to RAW assistant message IDs',
      'Same-path PNG substitutions are provisional; signed query values differ',
      'Absent text in captured snapshots cannot be reconstructed',
      'Local-only image bytes are embedded as data URIs; no network access']};
  const embedded = new Set();
  for (let i=0;i<audit.turns.length;i++) {
    const turn = audit.turns[i], wrapper = wrappers[i];
    const testids = [...wrapper.querySelectorAll('[data-testid]')].map(node =>
      /^conversation-turn-(\d+)$/.exec(node.getAttribute('data-testid')||''))
      .filter(Boolean).map(match => Number(match[1]));
    if (new Set(testids).size !== 1 || testids[0] !== turn.ordinal)
      throw Error('Turn ordinal mismatch between audit and localized HTML');
    const ordinal = turn.ordinal;
    const imageOnly = turn.selected?.kind === 'turn.unidentified-snapshot';
    result.turns++;
    if (imageOnly) {
      result.imageOnlyTurns++;
      const images = [];
      const used = new Set();
      for (const img of wrapper.querySelectorAll('img')) {
        const src = img.getAttribute('src') || '';
        const found = pngName.exec(src);
        if (!found || used.has(found[1])) continue;
        const body = localPng(source, src, cache);
        if (body) {
          used.add(found[1]);
          embedded.add(found[1]);
          images.push('<figure><img src="' + body.src + '" width="' + body.width +
            '" height="' + body.height + '" alt="Immagine acquisita dal turno ' +
            ordinal + '"><figcaption>PNG locale candidato; identità non verificata</figcaption></figure>');
        }
      }
      if (images.length) result.imageTurnsWithPng++;
      else result.missingImageOrdinals.push(ordinal);
      fragments.push('<article class="turn image"><h2>Turno ' + ordinal +
        ' — immagine (associazione provvisoria)</h2>' +
        (images.length ? images.join('') : '<p>Immagine non recuperata dall’archivio locale.</p>') +
        '</article>');
      continue;
    }
    result.identifiedTextTurns++;
    const nodes = [...wrapper.querySelectorAll('[data-message-id]')].filter(node =>
      !node.parentElement?.closest('[data-message-id]'));
    const texts = nodes.map(messageText).filter(Boolean);
    if (texts.length) result.identifiedTextTurnsWithContent++;
    else result.missingTextOrdinals.push(ordinal);
    fragments.push('<article class="turn text"><h2>Turno ' + ordinal +
      ' — messaggio identificato</h2>' +
      (texts.length ? texts.map(t => '<div class="message">' + escapeHtml(t) +
        '</div>').join('') :
        '<p>Testo assente nello snapshot selezionato: non ricostruito.</p>') +
      '</article>');
  }
  result.distinctVerifiedPngBodies = embedded.size;
  const css = 'body{font:16px/1.55 system-ui,sans-serif;background:#f6f6f6;color:#222;'+
    'max-width:900px;margin:0 auto;padding:24px}h1{font-size:1.5rem}h2{font-size:1.08rem}'+
    '.turn{background:white;border:1px solid #ddd;border-radius:10px;margin:20px 0;padding:20px}'+
    '.message{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}'+
    'figure{margin:16px 0}img{display:block;max-width:100%;height:auto;border-radius:6px}'+
    'figcaption,small{color:#555;font-size:.85rem}';
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; " +
    "script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'";
  const html = '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="' + escapeHtml(csp) + '">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>PoC 068 — lettura offline provvisoria</title><style>' + css + '</style></head>' +
    '<body><h1>Conversazione — vista di lettura sperimentale</h1>' +
    '<small>Testo estratto dai turni identificati; immagini dai PNG locali con associazioni non verificate.' +
    ' Questa vista non riproduce l’interfaccia originale di ChatGPT.</small><main>' +
    fragments.join('\n') + '</main></body></html>\n';
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(output,'index.html'),html,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(result,null,2)+'\n',
    {flag:'wx',mode:0o600});
  return {output,...result};
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (process.argv.length !== 4) {
    console.error('Usage: node render-readable-image-preview.mjs <localized-image-preview-dir> <new-output-dir>');
    process.exitCode=2;
  } else {
    try {console.log(JSON.stringify(renderReadablePreview(process.argv[2],process.argv[3]),null,2));}
    catch (error) {console.error(error.message);process.exitCode=1;}
  }
}
