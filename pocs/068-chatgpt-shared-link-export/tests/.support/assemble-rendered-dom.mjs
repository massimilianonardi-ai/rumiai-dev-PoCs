'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {assemble} from '../../assemble-rendered-dom.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cumulative-dom-'));
const capture = path.join(temp, 'capture');
fs.mkdirSync(path.join(capture, 'turns'), {recursive: true});
const events = [];
function record(ordinal, turn, message, sequence, body) {
  const html = '<div data-turn-id-container="' + turn +
    '"><section data-testid="conversation-turn-' + ordinal +
    '"><article data-message-id="' + message + '">' + body +
    '</article></section></div>';
  const hash = crypto.createHash('sha256').update(html).digest('hex');
  const file = 'turns/' + hash + '.html';
  fs.writeFileSync(path.join(capture, file), html);
  events.push({sequence, kind: 'turn.snapshot', turnId: turn, messageIds: [message],
    file, sha256: hash, bytes: Buffer.byteLength(html)});
}
record(3, 'turn-c', 'msg-c', 2, 'last');
record(1, 'turn-a', 'msg-a', 1, 'old');
record(1, 'turn-a', 'msg-a', 4, 'new <a href="https://example.org/x">link</a>');
record(2, 'turn-b', 'msg-b', 3, 'middle');
const imageOnlyHtml = '<div data-turn-id-container="image-only"><img src="data:image/gif;base64,abc"></div>';
const imageOnlyHash = crypto.createHash('sha256').update(imageOnlyHtml).digest('hex');
const imageOnlyFile = 'turns/' + imageOnlyHash + '.html';
fs.writeFileSync(path.join(capture, imageOnlyFile), imageOnlyHtml);
events.push({sequence: 5, kind: 'turn.unidentified-snapshot', turnId: 'image-only',
  messageIds: [], file: imageOnlyFile, sha256: imageOnlyHash,
  bytes: Buffer.byteLength(imageOnlyHtml)});
// Real image-only wrappers contain an ordinal even without data-message-id.
const imageTurnHtml = '<div data-turn-id-container="turn-image"><section data-testid="conversation-turn-4">' +
  '<img src="https://media.example.test/private/image.png?token=sensitive"></section></div>';
const imageTurnHash = crypto.createHash('sha256').update(imageTurnHtml).digest('hex');
const imageTurnFile = 'turns/' + imageTurnHash + '.html';
fs.writeFileSync(path.join(capture, imageTurnFile), imageTurnHtml);
events.push({sequence:6,kind:'turn.unidentified-snapshot',turnId:'turn-image',
  messageIds:[],file:imageTurnFile,sha256:imageTurnHash,bytes:Buffer.byteLength(imageTurnHtml)});
// An observed later placeholder must not displace the image-bearing frame.
const placeholder = '<div data-turn-id-container="turn-image"><section data-testid="conversation-turn-4"></section></div>';
const placeholderHash = crypto.createHash('sha256').update(placeholder).digest('hex');
const placeholderFile = 'turns/'+placeholderHash+'.html';
fs.writeFileSync(path.join(capture,placeholderFile),placeholder);
events.push({sequence:7,kind:'turn.unidentified-snapshot',turnId:'turn-image',
  messageIds:[],file:placeholderFile,sha256:placeholderHash,bytes:Buffer.byteLength(placeholder)});

fs.writeFileSync(path.join(capture, 'events.jsonl'),
  events.map(row => JSON.stringify(row)).join('\n') + '\n');
const raw = path.join(temp, 'raw.json.gz');
fs.writeFileSync(raw, zlib.gzipSync(JSON.stringify({linear_conversation: [
  {message: {id: 'msg-a', author: {role: 'user'}}},
  {message: {id: 'msg-b', author: {role: 'assistant'}}},
  {message: {id: 'msg-c', author: {role: 'user'}}},
  {message: {id: 'msg-d', author: {role: 'assistant'}}}
]})));
try {
  const output = path.join(temp, 'output');
  const result = assemble(capture, output, raw);
  assert.equal(result.turns, 3);
  assert.equal(result.messages, 3);
  assert.equal(result.resourceReferences, 1);
  const audit = JSON.parse(fs.readFileSync(path.join(output, 'audit.json'), 'utf8'));
  assert.deepEqual(audit.turns.map(turn => turn.ordinal), [1, 2, 3]);
  assert.deepEqual(audit.turns.map(turn => turn.versions.length), [2, 1, 1]);
  assert.deepEqual(audit.rawComparison.missingFromCapture, ['msg-d']);
  assert.deepEqual(audit.rawComparison.notInRaw, []);
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert(html.indexOf('conversation-turn-1') < html.indexOf('conversation-turn-2'));
  assert(html.indexOf('conversation-turn-2') < html.indexOf('conversation-turn-3'));
  assert(html.includes('>new <a href="https://example.org/x">link</a>'));
  assert(!html.includes('data-turn-id-container="image-only"'),
    'unidentified probe evidence must not silently enter the cumulative DOM');
  assert(!html.includes('>old</article>'));
  assert(html.includes("script-src 'none'"));
  const previewOut=path.join(temp,'preview');
  const preview=assemble(capture,previewOut,null,{includeUnidentifiedImages:true});
  assert.equal(preview.turns,4);
  assert.equal(preview.messages,3);
  assert.equal(preview.missingOrdinals,0);
  const previewAudit=JSON.parse(fs.readFileSync(path.join(previewOut,'audit.json'),'utf8'));
  assert.equal(previewAudit.status,'provisional-image-preview-assembly');
  assert.equal(previewAudit.unidentifiedImageTurns,1);
  assert.deepEqual(previewAudit.turns.map(x=>x.ordinal),[1,2,3,4]);
  assert.equal(previewAudit.turns[3].selected.kind,'turn.unidentified-snapshot');
  const previewHtml=fs.readFileSync(path.join(previewOut,'index.html'),'utf8');
  assert(previewHtml.includes('PROVISIONAL IMAGE PREVIEW'));
  assert(previewHtml.includes('media.example.test/private/image.png'));
  assert(!previewHtml.includes('data-turn-id-container="image-only"'));
  assert(!previewHtml.includes(placeholder));
  assert(previewHtml.includes("script-src 'none'"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,'audit.json'),'utf8')).unidentifiedImageTurns,0);
  assert.throws(() => assemble(capture, output), /already exists/);
  const eventsPath = path.join(capture, 'events.jsonl');
  const original = fs.readFileSync(eventsPath, 'utf8');
  fs.writeFileSync(eventsPath, original.replace(
    '"sha256":"' + events[0].sha256 + '"', '"sha256":"' + '0'.repeat(64) + '"'));
  const invalidOutput = path.join(temp, 'invalid');
  assert.throws(() => assemble(capture, invalidOutput), /SHA-256 mismatch/);
  assert(!fs.existsSync(invalidOutput));
  console.log('PASS: cumulative DOM ordering, opt-in image-only turns, latest image frames, RAW gaps, CSP and integrity');
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
