'use strict';
// Experimental offline, inert cumulative DOM assembly from render-probe.mjs evidence.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const snapshotName = /^turns\/([a-f0-9]{64})\.html$/;

function readRawIds(filename) {
  const file = fs.readFileSync(filename);
  const root = JSON.parse((filename.endsWith('.gz') ? zlib.gunzipSync(file) : file).toString('utf8'));
  const linear = Array.isArray(root) ? root : root.linear_conversation;
  const values = Array.isArray(linear) ? linear :
    root.mapping && typeof root.mapping === 'object' ? Object.values(root.mapping) : null;
  if (!values) throw Error('RAW must contain linear_conversation or mapping');
  return [...new Set(values.map(value => value?.message || value)
    .filter(value => value && value.author && typeof value.id === 'string')
    .map(value => value.id))];
}

function refs(html) {
  // Source references only; this is an audit, not a downloader or HTML parser.
  const found = [];
  const attributes = /\b(src|href|poster|srcset)\s*=\s*(["'])([\s\S]*?)\2/gi;
  for (const match of html.matchAll(attributes)) {
    const attribute = match[1].toLowerCase();
    const list = attribute === 'srcset' ? match[3].split(',').map(s => s.trim().split(/\s+/)[0]) : [match[3]];
    for (const value of list) {
      if (!value || value.startsWith('#')) continue;
      found.push({attribute, reference: value});
    }
  }
  return found;
}

export function assemble(captureDir, outputDir, rawPath = null, options = {}) {
  const imagePreview = options.includeUnidentifiedImages === true;
  const preferExpandedPreviews = options.preferExpandedPreviews === true;
  const capture = path.resolve(captureDir);
  const output = path.resolve(outputDir);
  if (output === capture || output.startsWith(capture + path.sep))
    throw Error('Output must not be inside the capture directory');
  if (fs.existsSync(output)) throw Error('Output already exists: ' + output);
  const data = fs.readFileSync(path.join(capture, 'events.jsonl'), 'utf8');
  const observations = data.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {return JSON.parse(line);} catch {throw Error('Invalid JSONL event at line ' + (index + 1));}
  }).filter(e => e.kind === 'turn.snapshot' ||
    (imagePreview && e.kind === 'turn.unidentified-snapshot'));
  if (!observations.length) throw Error('No turn.snapshot events');
  const turns = new Map();
  const sourceReferences = new Map();
  for (const event of observations) {
    if (typeof event.turnId !== 'string' || !Array.isArray(event.messageIds) ||
        !Number.isInteger(event.sequence) || !snapshotName.test(event.file || ''))
      throw Error('Invalid snapshot metadata at event ' + event.sequence);
    const filenameHash = snapshotName.exec(event.file)[1];
    const bytes = fs.readFileSync(path.join(capture, event.file));
    const hash = digest(bytes);
    if (hash !== filenameHash || hash !== event.sha256)
      throw Error('Snapshot SHA-256 mismatch at event ' + event.sequence);
    const html = bytes.toString('utf8');
    const unidentified = event.kind === 'turn.unidentified-snapshot';
    if (unidentified) {
      if (event.messageIds.length) throw Error('Unidentified snapshot has message IDs');
      // Placeholders/early frames are not evidence of a rendered image turn.
      if (!/<img\b[^>]*\bsrc\s*=/i.test(html)) continue;
    }
    const wrapper = /\bdata-turn-id-container="([^"]+)"/.exec(html);
    const ordinalMatches = [...html.matchAll(/\bdata-testid="conversation-turn-(\d+)"/g)]
      .map(m => Number(m[1]));
    const indices = [...new Set(ordinalMatches)];
    // A source frame without a conversation ordinal is not placeable in
    // the cumulative timeline; skip only such unidentified probe evidence.
    if (unidentified && indices.length === 0) continue;
    if (wrapper?.[1] !== event.turnId || indices.length !== 1 ||
        !Number.isSafeInteger(indices[0]))
      throw Error('Ambiguous turn identity or ordinal at event ' + event.sequence);
    for (const messageId of event.messageIds) {
      if (typeof messageId !== 'string' || !html.includes('data-message-id="' + messageId + '"'))
        throw Error('Message ID not present in snapshot at event ' + event.sequence);
    }
    let turn = turns.get(event.turnId);
    if (!turn) {
      turn = {turnId: event.turnId, ordinal: indices[0], versions: [], selected: null};
      turns.set(event.turnId, turn);
    }
    if (turn.ordinal !== indices[0]) throw Error('Changing ordinal for ' + event.turnId);
    const expandedPreview = preferExpandedPreviews && !unidentified &&
      html.includes('data-can-expand') && html.includes('data-expanded') &&
      html.includes('aria-expanded="true"');
    const version = {sequence: event.sequence, file: event.file,
      sha256: hash, bytes: bytes.length, messageIds: event.messageIds,
      ...(imagePreview ? {kind: event.kind} : {}),
      ...(preferExpandedPreviews ? {expandedPreview} : {})};
    turn.versions.push(version);
    const previousUnidentified = turn.selected?.kind === 'turn.unidentified-snapshot';
    if (!turn.selected || (previousUnidentified && !unidentified) ||
        (previousUnidentified === unidentified &&
          ((preferExpandedPreviews && expandedPreview && !turn.selected.expandedPreview) ||
           ((!preferExpandedPreviews || expandedPreview === turn.selected.expandedPreview) &&
            event.sequence > turn.selected.sequence))))
      turn.selected = {...version, html};
  }
  const ordered = [...turns.values()].sort((a, b) => a.ordinal - b.ordinal);
  if (!ordered.length) throw Error('No image-bearing or message-qualified turn snapshots');
  const ordinalSeen = new Set(), seenMessages = new Map();
  for (const turn of ordered) {
    if (ordinalSeen.has(turn.ordinal)) throw Error('Duplicate ordinal ' + turn.ordinal);
    ordinalSeen.add(turn.ordinal);
    for (const id of turn.selected.messageIds) {
      if (seenMessages.has(id) && seenMessages.get(id) !== turn.turnId)
        throw Error('Message ID in multiple turns: ' + id);
      seenMessages.set(id, turn.turnId);
    }
    for (const ref of refs(turn.selected.html))
      sourceReferences.set(ref.attribute + '\0' + ref.reference, ref);
  }
  const ordinals = ordered.map(t => t.ordinal);
  const missingOrdinals = [];
  for (let i = ordinals[0]; i <= ordinals.at(-1); i++)
    if (!ordinalSeen.has(i)) missingOrdinals.push(i);
  const rawIds = rawPath ? readRawIds(rawPath) : null;
  const capturedIds = [...seenMessages.keys()];
  const rawSet = rawIds && new Set(rawIds);
  const capturedSet = new Set(capturedIds);
  const rawComparison = rawIds ? {
    total: rawIds.length, matched: capturedIds.filter(id => rawSet.has(id)).length,
    missingFromCapture: rawIds.filter(id => !capturedSet.has(id)),
    notInRaw: capturedIds.filter(id => !rawSet.has(id))
  } : {status: 'not-compared', reason: 'Original RAW transcript not supplied'};
  const report = {
    evidence: 'render-probe.mjs DOM snapshots',
    status: imagePreview ? 'provisional-image-preview-assembly' : 'partial-offline-reconstruction',
    provisionalImagePreview: imagePreview,
    unidentifiedImageTurns: ordered.filter(t => t.selected.kind === 'turn.unidentified-snapshot').length,
    selection: imagePreview ? 'latest image-bearing unidentified turn snapshot; message-qualified versions preferred' :
      preferExpandedPreviews ? 'most recent expanded preview when available; otherwise latest per turn' :
      'latest snapshot by event sequence for each turn',
    recordedSnapshots: observations.length, capturedTurnCount: ordered.length,
    ...(preferExpandedPreviews ? {selectedExpandedPreviewTurns:
      ordered.filter(turn=>turn.selected.expandedPreview).length} : {}),
    capturedMessageCount: capturedIds.length, ordinalRange: [ordinals[0], ordinals.at(-1)],
    missingOrdinals, rawComparison,
    limitations: ['No live React component state or interactive behavior',
      'Original CSS and external resource bytes not included in the capture',
      'Missing resources and events between snapshots cannot be reconstructed',
      'A contiguous observed ordinal range does not prove whole-conversation coverage',
      ...(imagePreview ? ['Unidentified image turns have no verified original message-ID/assistant role',
        'No captured image body was matched or downloaded during assembly'] : [])],
    turns: ordered.map(({turnId, ordinal, versions, selected}) => ({turnId, ordinal,
      messageIds: selected.messageIds, selected: {sequence: selected.sequence,
        sha256: selected.sha256, file: selected.file, bytes: selected.bytes,
        ...(imagePreview ? {kind: selected.kind} : {})}, versions}))
  };
  const sourceAssets = [...sourceReferences.values()];
  const style = 'body{margin:0 auto;max-width:960px;padding:24px;font:16px/1.55 system-ui,sans-serif;color:#202124;background:#fafafa}' +
    'header{border-bottom:1px solid #aaa;margin-bottom:30px;padding-bottom:14px}h1{font-size:1.5em}' +
    'main>div[data-turn-id-container]{background:white;border:1px solid #ddd;border-radius:8px;margin:16px 0;padding:18px;min-height:0!important;height:auto!important}' +
    'pre{overflow:auto;padding:12px;background:#f4f4f4}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px}' +
    'img{max-width:100%}button,input,a{pointer-events:none}';
  const title = 'Cumulative DOM — captured ChatGPT turns';
  const body = ordered.map(turn => '<!-- captured turn ordinal ' + turn.ordinal +
    ', event ' + turn.selected.sequence + ' -->\n' + turn.selected.html).join('\n');
  // Prevent execution/network loading from untrusted captured markup. URLs remain
  // visible in attributes but will not be fetched by this offline view.
  const csp = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; " +
    "style-src 'unsafe-inline'; font-src data:; frame-src 'none'; object-src 'none'; " +
    "form-action 'none'; base-uri 'none'";
  const document = '<!doctype html>\n<html lang="it"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="' + escapeHtml(csp) + '">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><style>' + style + '</style></head>' +
    '<body><header><h1>' + escapeHtml(title) + '</h1><p>Offline static evidence; ' +
    ordered.length + ' turns, ' + capturedIds.length + ' message IDs. External assets and scripts disabled.</p>' +
    (imagePreview ? '<p><strong>PROVISIONAL IMAGE PREVIEW</strong>: missing message IDs and image ownership remain unverified.</p>' : '') + '</header>' +
    '<main id="cumulative-turns">' + body + '</main></body></html>\n';
  fs.mkdirSync(output, {recursive: true, mode: 0o700});
  fs.writeFileSync(path.join(output, 'index.html'), document, {flag: 'wx', mode: 0o600});
  fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  fs.writeFileSync(path.join(output, 'resource-references.json'), JSON.stringify(sourceAssets, null, 2) + '\n',
    {flag: 'wx', mode: 0o600});
  return {output, turns: ordered.length, messages: capturedIds.length,
    missingOrdinals: missingOrdinals.length, resourceReferences: sourceAssets.length,
    rawComparison};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [capture, output, flag, raw] = process.argv.slice(2);
  const imagePreview = flag === '--include-unidentified-images';
  const isRaw = flag === '--raw';
  if (!capture || !output || (flag !== undefined && !isRaw && !imagePreview) ||
      (isRaw && (!raw || process.argv.length !== 6)) ||
      (imagePreview && process.argv.length !== 5) ||
      (!flag && process.argv.length !== 4)) {
    console.error('Usage: node assemble-rendered-dom.mjs <capture-dir> <new-output-dir> [--raw <raw.json[.gz]> | --include-unidentified-images]');
    process.exitCode = 2;
  } else {
    try {console.log(JSON.stringify(assemble(capture, output, isRaw ? raw : null,
      {includeUnidentifiedImages: imagePreview}), null, 2));}
    catch (error) {console.error(error.message); process.exitCode = 1;}
  }
}
