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
  assert(!html.includes('>old</article>'));
  assert(html.includes("script-src 'none'"));
  assert.throws(() => assemble(capture, output), /already exists/);
  const eventsPath = path.join(capture, 'events.jsonl');
  const original = fs.readFileSync(eventsPath, 'utf8');
  fs.writeFileSync(eventsPath, original.replace(
    '"sha256":"' + events[0].sha256 + '"', '"sha256":"' + '0'.repeat(64) + '"'));
  const invalidOutput = path.join(temp, 'invalid');
  assert.throws(() => assemble(capture, invalidOutput), /SHA-256 mismatch/);
  assert(!fs.existsSync(invalidOutput));
  console.log('PASS: cumulative DOM ordering, latest versions, RAW gaps, CSP, integrity, overwrite refusal');
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
