import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const INTERNAL_TYPES = new Set(['thoughts', 'reasoning_recap']);

export function findSnapshot(value, depth = 0) {
  if (depth > 22 || value === null || typeof value !== 'object') return null;
  if (!Array.isArray(value)) {
    const mapping = value.mapping, id = value.current_node;
    if (mapping && typeof mapping === 'object' && !Array.isArray(mapping)
      && typeof id === 'string' && Object.hasOwn(mapping, id)) {
      const seen = new Set();
      let node = id;
      while (typeof node === 'string' && node && !seen.has(node)
        && Object.hasOwn(mapping, node)) {
        seen.add(node);
        const parent = mapping[node];
        if (!parent || typeof parent !== 'object') break;
        node = parent.parent;
      }
      if (node === null || node === undefined || node === '') return value;
    }
  }
  for (const child of Object.values(value)) {
    const found = findSnapshot(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseSnapshot(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 24 * 1024 * 1024) return null;
  try { return findSnapshot(JSON.parse(raw)); }
  catch { return null; }
}

export function activeBranch(snapshot) {
  const mapping = snapshot.mapping || {};
  const ids = [], seen = new Set();
  let id = snapshot.current_node;
  while (id) {
    if (seen.has(id)) throw new Error('snapshot.parent-cycle: active branch contains a cycle');
    if (!Object.hasOwn(mapping, id)) throw new Error('snapshot.parent-gap: missing active node');
    const node = mapping[id];
    if (!node || typeof node !== 'object') throw new Error('snapshot.invalid-node: expected object');
    seen.add(id);
    ids.push(id);
    id = node.parent;
  }
  return ids.reverse();
}

function fragments(content) {
  const texts = [], nonText = [];
  if (Array.isArray(content.parts)) {
    content.parts.forEach((part, index) => {
      if (typeof part === 'string') texts.push(part);
      else nonText.push({ part_index: index, part });
    });
  }
  if (!texts.length) {
    for (const field of ['text', 'code']) {
      if (typeof content[field] === 'string') { texts.push(content[field]); break; }
    }
  }
  return { text: texts.join(''), nonText };
}

function classification(message) {
  const role = message.author?.role;
  if (message.metadata?.is_visually_hidden_from_conversation === true)
    return 'visually_hidden';
  if (message.metadata?.is_thinking_preamble_message === true)
    return 'thinking_preamble';
  if (message.weight === 0) return 'zero_weight';
  if (role === 'tool') return 'tool_traffic';
  if (!['user', 'assistant'].includes(role)) return 'internal_role:' + String(role);
  if (INTERNAL_TYPES.has(message.content?.content_type)) return 'internal_reasoning';
  if (role === 'assistant' && message.channel === 'analysis') return 'assistant_analysis';
  if (role === 'assistant' && ![undefined, null, '', 'all'].includes(message.recipient))
    return 'assistant_tool_invocation';
  return 'visible_candidate';
}

export function deriveTranscript(snapshot) {
  const ids = activeBranch(snapshot);
  const visible = [], nonTextParts = [], nodes = [], counts = {};
  ids.forEach((id, ordinal) => {
    const node = snapshot.mapping[id];
    const msg = node.message;
    if (!msg) {
      counts.no_message = (counts.no_message || 0) + 1;
      nodes.push({ ordinal, node_id: id, classification: 'no_message', included: false });
      return;
    }
    const role = msg.author?.role;
    const content = msg.content || {};
    const found = fragments(content);
    let kind = classification(msg);
    if (kind === 'visible_candidate' && role === 'assistant' && !found.text && !found.nonText.length)
      kind = 'empty_assistant_node';
    const included = kind === 'visible_candidate';
    counts[kind] = (counts[kind] || 0) + 1;
    nodes.push({ ordinal, node_id: id, message_id: msg.id ?? null, role,
      channel: msg.channel ?? null, recipient: msg.recipient ?? null,
      content_type: content.content_type ?? null, status: msg.status ?? null,
      end_turn: msg.end_turn ?? null, weight: msg.weight ?? null,
      visually_hidden: msg.metadata?.is_visually_hidden_from_conversation === true,
      thinking_preamble: msg.metadata?.is_thinking_preamble_message === true,
      message_type: msg.metadata?.message_type ?? null,
      is_complete: msg.metadata?.is_complete ?? null,
      classification: kind, included,
      text_length: found.text.length, non_text_parts: found.nonText.length });
    if (!included) return;
    visible.push({ ordinal, node_id: id, parent: node.parent ?? null,
      message_id: msg.id ?? null, role, channel: msg.channel ?? null,
      recipient: msg.recipient ?? null, content_type: content.content_type ?? null,
      create_time: msg.create_time ?? null, text: found.text, message: msg });
    for (const entry of found.nonText) nonTextParts.push({
      ordinal, node_id: id, message_id: msg.id ?? null, role,
      content_type: content.content_type ?? null, ...entry
    });
  });
  return { ids, visible, nonTextParts, nodes, counts };
}

function sha(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function pretty(value) { return JSON.stringify(value, null, 2) + '\n'; }
function safeName(value) {
  return String(value).replaceAll('/', '-').replaceAll(':', '-')
    .replace(/[\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim()
    .slice(0, 160).replace(/[. ]+$/g, '') || 'Untitled';
}
function dateName(value) {
  let n = Number(value);
  if (!Number.isFinite(n) || n <= 0) n = Date.now();
  else if (n < 10000000000) n *= 1000;
  const d = new Date(n);
  if (!Number.isFinite(d.getTime())) return new Date().toISOString().slice(0, 10);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')].join('-');
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? ((n >>> 1) ^ 0xedb88320) : (n >>> 1);
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipFiles(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [filename, bytes] of files) {
    const name = Buffer.from(filename, 'utf8');
    const packed = deflateRawSync(bytes, { level: 9 });
    const checksum = crc32(bytes);
    const h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(checksum, 14);
    h.writeUInt32LE(packed.length, 18);
    h.writeUInt32LE(bytes.length, 22);
    h.writeUInt16LE(name.length, 26);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(checksum, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(bytes.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    local.push(h, name, packed);
    central.push(c, name);
    offset += h.length + name.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

export async function exportSnapshot(snapshot, selected, outputRoot, source, method) {
  const title = String(snapshot.title || selected.display_title ||
    snapshot.conversation_id || 'Shared conversation');
  const transcript = deriveTranscript(snapshot);
  const base = dateName(snapshot.create_time ?? selected.source_created_at) + ' ' + safeName(title);
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  let folder, directory;
  for (let i = 1; ; i++) {
    folder = base + (i === 1 ? '' : ' (' + i + ')');
    directory = path.join(outputRoot, folder);
    try { await fs.mkdir(directory, { mode: 0o700 }); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const raw = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const markdown = transcript.visible.map(item =>
    '## ' + (item.role === 'user' ? 'USER' :
      item.channel === 'commentary' ? 'ASSISTANT — commentary' : 'ASSISTANT') +
    '\n\n' + (item.text || '[contenuto non testuale; vedi VISIBLE_MESSAGES.jsonl]') +
    '\n\n').join('');
  const audit = {
    source: { kind: 'ChatGPT renderer conversation snapshot via web-control CDP session',
      raw_uncompressed_bytes: raw.length, raw_sha256: sha(raw) },
    conversation: { title, conversation_id: snapshot.conversation_id ?? null,
      create_time: snapshot.create_time ?? null, update_time: snapshot.update_time ?? null,
      current_node: snapshot.current_node, mapping_nodes: Object.keys(snapshot.mapping).length,
      active_branch_nodes: transcript.ids.length,
      nodes_outside_active_branch: Object.keys(snapshot.mapping).length - transcript.ids.length },
    transcript: { visible_messages: transcript.visible.length,
      visible_user_messages: transcript.visible.filter(x => x.role === 'user').length,
      visible_assistant_messages: transcript.visible.filter(x => x.role === 'assistant').length,
      non_text_parts: transcript.nonTextParts.length, classification_counts: transcript.counts },
    nodes: transcript.nodes
  };
  const acquisition = { source, method, captured_mapping_nodes: audit.conversation.mapping_nodes,
    visible_messages: transcript.visible.length, non_text_parts: transcript.nonTextParts.length,
    media_binary_downloaded: false, physical_site_completeness_verified: false };
  const items = [
    ['conversation.raw.json.gz', gzipSync(raw, { level: 9, mtime: 0 })],
    ['VISIBLE_MESSAGES.jsonl', Buffer.from(transcript.visible.map(x => JSON.stringify(x)).join('\n') + '\n')],
    ['TRANSCRIPT.md', Buffer.from('# ' + title + '\n\nConversation ID: ' +
      (snapshot.conversation_id || '') + '\n\n' +
      '<!-- Text from structured snapshot; non-text objects in VISIBLE_MESSAGES.jsonl. -->\n\n' + markdown)],
    ['NON_TEXT_PARTS.json', Buffer.from(pretty(transcript.nonTextParts))],
    ['AUDIT.json', Buffer.from(pretty(audit))],
    ['ACQUISITION.json', Buffer.from(pretty(acquisition))],
    ['README.md', Buffer.from('# ChatGPT conversation export\n\n' +
      'Raw structured snapshot, active-branch transcript and non-text parts are retained.\n' +
      'Image references survive as metadata, but images and rendered charts are NOT downloaded.\n')]
  ];
  for (const [name, bytes] of items)
    await fs.writeFile(path.join(directory, name), bytes, { mode: 0o600, flag: 'wx' });
  const checksums = [sha(raw) + '  conversation.raw.json (uncompressed captured snapshot)',
    ...items.map(([name, bytes]) => sha(bytes) + '  ' + name)].join('\n') + '\n';
  const sums = Buffer.from(checksums);
  await fs.writeFile(path.join(directory, 'SHA256SUMS'), sums, { mode: 0o600, flag: 'wx' });
  const archive = path.join(outputRoot, folder + '.zip');
  await fs.writeFile(archive, zipFiles([...items, ['SHA256SUMS', sums]]),
    { mode: 0o600, flag: 'wx' });
  return { directory, zip: archive, title, messageCount: transcript.visible.length,
    mappingNodes: audit.conversation.mapping_nodes,
    nonTextParts: transcript.nonTextParts.length,
    imagesDownloaded: 0, method, observationComplete: false };
}
