import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { activeBranch, deriveTranscript, exportSnapshot, findSnapshot, parseSnapshot } from '../snapshot-export.mjs';

function snapshot() {
  return { conversation_id: 'abc', title: 'Test / conversation', create_time: 1792100000,
    current_node: 'assistant', mapping: {
      user: { parent: null, message: { id: 'u', author: { role: 'user' },
        content: { parts: ['Hello'] } } },
      assistant: { parent: 'user', message: { id: 'a', author: { role: 'assistant' },
        content: { parts: ['Chart ', { content_type: 'image_asset_pointer', asset_pointer: 'ref-1' }] } } },
      other: { parent: null, message: { id: 'not-current', author: { role: 'assistant' },
        content: { parts: ['Inactive branch'] } } }
    } };
}

function readZip(zip) {
  const files = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const compressed = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, inflateRawSync(zip.subarray(start, start + compressed)));
    offset = start + compressed;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  return files;
}

test('preserves original mapping/current_node active branch and multimodal objects', () => {
  const data = snapshot();
  assert.deepEqual(activeBranch(data), ['user', 'assistant']);
  assert.equal(findSnapshot({ props: { payload: data } }), data);
  assert.deepEqual(parseSnapshot(JSON.stringify(data)), data);
  assert.equal(parseSnapshot('{"mapping":{}}'), null);
  const derived = deriveTranscript(data);
  assert.equal(derived.visible.length, 2);
  assert.equal(derived.nonTextParts[0].part.asset_pointer, 'ref-1');
  assert.equal(derived.visible[1].message.content.parts[1].asset_pointer, 'ref-1');
  assert.equal(derived.counts.visible_candidate, 2);
  assert.ok(!derived.visible.some(x => x.text === 'Inactive branch'));
});

test('omits renderer-hidden assistant nodes before transcript rendering', () => {
  const data = { current_node: 'visible', mapping: {
    user: { parent: null, message: { id: 'u', author: { role: 'user' },
      content: { parts: ['Question'] }, weight: 1 } },
    hidden: { parent: 'user', message: { id: 'h', author: { role: 'assistant' },
      channel: 'final', recipient: 'all', content: { parts: ['Hidden duplicate'] },
      metadata: { is_visually_hidden_from_conversation: true }, weight: 1 } },
    preamble: { parent: 'hidden', message: { id: 'p', author: { role: 'assistant' },
      channel: 'final', recipient: 'all', content: { parts: ['Transient preamble'] },
      metadata: { is_thinking_preamble_message: true }, weight: 1 } },
    zero: { parent: 'preamble', message: { id: 'z', author: { role: 'assistant' },
      channel: 'final', recipient: 'all', content: { parts: ['Zero weight'] },
      metadata: {}, weight: 0 } },
    visible: { parent: 'zero', message: { id: 'a', author: { role: 'assistant' },
      channel: 'final', recipient: 'all', content: { parts: ['Answer'] },
      metadata: { message_type: 'next', is_complete: true }, weight: 1,
      status: 'finished_successfully', end_turn: true } }
  } };
  const derived = deriveTranscript(data);
  assert.deepEqual(derived.visible.map(x => x.text), ['Question', 'Answer']);
  assert.equal(derived.counts.visually_hidden, 1);
  assert.equal(derived.counts.thinking_preamble, 1);
  assert.equal(derived.counts.zero_weight, 1);
  const hidden = derived.nodes.find(x => x.node_id === 'hidden');
  assert.equal(hidden.included, false);
  assert.equal(hidden.visually_hidden, true);
  const visible = derived.nodes.find(x => x.node_id === 'visible');
  assert.equal(visible.status, 'finished_successfully');
  assert.equal(visible.end_turn, true);
  assert.equal(visible.weight, 1);
  assert.equal(visible.message_type, 'next');
  assert.equal(visible.is_complete, true);
});

test('rejects invalid or cycling parent chains', () => {
  const broken = snapshot();
  broken.mapping.user.parent = 'missing';
  assert.equal(parseSnapshot(JSON.stringify(broken)), null);
  assert.throws(() => activeBranch(broken), /snapshot.parent-gap/);
  broken.mapping.user.parent = 'assistant';
  assert.equal(parseSnapshot(JSON.stringify(broken)), null);
  assert.throws(() => activeBranch(broken), /snapshot.parent-cycle/);
});

test('writes immutable forensic export, gzip, multimodal JSONL and readable ZIP', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-node-snapshot-'));
  try {
    for (const index of [1, 2]) {
      const result = await exportSnapshot(snapshot(), {}, dir,
        'https://chatgpt.com/share/example', 'test-fixture');
      const raw = JSON.parse(gunzipSync(await fs.readFile(path.join(result.directory,
        'conversation.raw.json.gz'))));
      assert.deepEqual(raw, snapshot());
      const zip = readZip(await fs.readFile(result.zip));
      assert.ok(zip.has('TRANSCRIPT.md'));
      assert.ok(zip.has('SHA256SUMS'));
      assert.equal(JSON.parse(zip.get('NON_TEXT_PARTS.json')).length, 1);
      assert.equal(result.messageCount, 2);
      assert.equal(result.imagesDownloaded, 0);
      assert.match(result.directory, new RegExp(index === 1 ? 'Test - conversation$' : 'Test - conversation \\(2\\)$'));
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
