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
  if (role === 'assistant' && message.channel === 'commentary' &&
      [undefined, null, '', 'all'].includes(message.recipient))
    return 'assistant_commentary';
  if (role === 'assistant' && ![undefined, null, '', 'all'].includes(message.recipient))
    return 'assistant_tool_invocation';
  return 'visible_candidate';
}

function auditNode(ordinal, id, msg, content, kind, found, included) {
  return { ordinal, node_id: id, message_id: msg.id ?? null,
    role: msg.author?.role ?? null, channel: msg.channel ?? null,
    recipient: msg.recipient ?? null, content_type: content.content_type ?? null,
    status: msg.status ?? null, end_turn: msg.end_turn ?? null,
    weight: msg.weight ?? null,
    visually_hidden: msg.metadata?.is_visually_hidden_from_conversation === true,
    thinking_preamble: msg.metadata?.is_thinking_preamble_message === true,
    message_type: msg.metadata?.message_type ?? null,
    is_complete: msg.metadata?.is_complete ?? null,
    classification: kind, included,
    text_length: found.text.length, non_text_parts: found.nonText.length };
}

function publicSurface(entry) {
  return { ordinal: entry.ordinal, node_id: entry.id,
    message_id: entry.msg.id ?? null, role: entry.role,
    channel: entry.msg.channel ?? null,
    content_type: entry.content.content_type ?? null,
    create_time: entry.msg.create_time ?? null, text: entry.found.text,
    non_text_parts: entry.found.nonText };
}

function activitySurface(entry) {
  const text = ['assistant_commentary', 'assistant_tool_invocation']
    .includes(entry.kind) ? entry.found.text : null;
  return { ordinal: entry.ordinal, node_id: entry.id,
    message_id: entry.msg.id ?? null, kind: entry.kind, role: entry.role,
    channel: entry.msg.channel ?? null, recipient: entry.msg.recipient ?? null,
    content_type: entry.content.content_type ?? null,
    text, text_length: entry.found.text.length,
    non_text_parts: entry.found.nonText.length };
}

function deriveTurns(entries) {
  const turns = [];
  let turn = null;
  const close = () => {
    if (!turn) return;
    turn.complete = Boolean(turn.user && turn.assistant);
    turns.push(turn);
    turn = null;
  };
  for (const entry of entries) {
    if (entry.kind === 'visible_candidate' && entry.role === 'user') {
      close();
      turn = { index: turns.length, user: publicSurface(entry),
        activities: [], assistant: null, hidden_nodes: [],
        anomalies: [], complete: false };
      continue;
    }
    if (!turn) continue;
    if (entry.kind === 'visible_candidate' && entry.role === 'assistant') {
      if (!turn.assistant) turn.assistant = publicSurface(entry);
      else turn.anomalies.push({ kind: 'additional_visible_assistant',
        ordinal: entry.ordinal, node_id: entry.id });
      continue;
    }
    if (['assistant_commentary', 'assistant_analysis', 'assistant_tool_invocation',
      'tool_traffic', 'internal_reasoning'].includes(entry.kind)) {
      turn.activities.push(activitySurface(entry));
      continue;
    }
    if (['visually_hidden', 'thinking_preamble', 'zero_weight',
      'empty_assistant_node'].includes(entry.kind)) {
      turn.hidden_nodes.push({ ordinal: entry.ordinal, node_id: entry.id,
        message_id: entry.msg.id ?? null, classification: entry.kind });
    }
  }
  close();
  return turns;
}

export function deriveTranscript(snapshot) {
  const ids = activeBranch(snapshot);
  const visible = [], nonTextParts = [], nodes = [], counts = {}, entries = [];
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
    nodes.push(auditNode(ordinal, id, msg, content, kind, found, included));
    const entry = { ordinal, id, node, msg, role, content, found, kind };
    entries.push(entry);
    if (!included) return;
    visible.push({ ordinal, node_id: id, parent: node.parent ?? null,
      message_id: msg.id ?? null, role, channel: msg.channel ?? null,
      recipient: msg.recipient ?? null, content_type: content.content_type ?? null,
      create_time: msg.create_time ?? null, text: found.text, message: msg });
    for (const item of found.nonText) nonTextParts.push({
      ordinal, node_id: id, message_id: msg.id ?? null, role,
      content_type: content.content_type ?? null, ...item
    });
  });
  const turns = deriveTurns(entries);
  return { ids, visible, nonTextParts, nodes, counts, turns };
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

function fileExtension(file) {
  const name = String(file.file_name || '');
  const fromName = name.match(/(\.[A-Za-z0-9]{1,10})$/);
  if (fromName) return fromName[1].toLowerCase();
  const mime = String(file.mime_type || '').toLowerCase().split(';')[0];
  const known = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'application/pdf': '.pdf',
    'text/markdown': '.md', 'text/plain': '.txt', 'application/json': '.json',
    'application/zip': '.zip'
  };
  return known[mime] || '.bin';
}

function sandboxFileFiles(files) {
  const stored = [], manifest = [], byUri = new Map();
  files.forEach((file,index) => {
    const item = {
      source:file.source || 'assistant-sandbox',
      sandbox_uri:file.sandbox_uri,
      file_path:file.file_path,
      file_name:file.file_name || null,
      message_id:file.message_id || null,
      node_id:file.node_id || null,
      ordinal:file.ordinal ?? null,
      mime_type:file.mime_type ?? null,
      downloaded_size_bytes:file.downloaded_size_bytes ?? null,
      status:file.base64 ? 'downloaded' : 'missing',
      local_path:null, sha256:null,
      attempts:Array.isArray(file.attempts) ? file.attempts : []
    };
    if (file.base64) {
      const bytes = Buffer.from(file.base64,'base64');
      const stem = safeName(file.file_name || ('file-' + String(index + 1)));
      const ext = fileExtension(file);
      const withExt = stem.toLowerCase().endsWith(ext.toLowerCase())
        ? stem : stem + ext;
      const filename = String(index + 1).padStart(3,'0') + '-' + withExt;
      item.local_path = 'files/' + filename;
      item.downloaded_size_bytes = bytes.length;
      item.sha256 = sha(bytes);
      stored.push([item.local_path,bytes]);
      if (typeof item.sandbox_uri === 'string')
        byUri.set(item.sandbox_uri,item.local_path);
    }
    manifest.push(item);
  });
  return { files:stored, manifest, byUri };
}

function rewriteSandboxLinks(text, byUri) {
  let value = String(text || '');
  for (const [uri,local] of byUri)
    value = value.split(uri).join(local);
  return value;
}

function mediaExtension(asset) {
  const mime = String(asset.mime_type || '').toLowerCase().split(';')[0];
  const known = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg' };
  if (known[mime]) return known[mime];
  const match = String(asset.file_name || '').match(/(\.[A-Za-z0-9]{1,8})$/);
  return match ? match[1].toLowerCase() : '.bin';
}

function mediaFiles(assets) {
  const files = [], manifest = [], byPointer = new Map();
  assets.forEach((asset, index) => {
    const uploadOnly = asset.references?.length > 0 &&
      asset.references.every(reference => reference.role === 'user');
    const item = { asset_pointer: asset.asset_pointer,
      asset_pointers: Array.isArray(asset.asset_pointers) ? asset.asset_pointers : [asset.asset_pointer],
      file_id: asset.file_id,
      expected_size_bytes: asset.expected_size_bytes ?? null,
      width: asset.width ?? null, height: asset.height ?? null,
      mime_type: asset.mime_type ?? null, original_file_name: asset.file_name ?? null,
      downloaded_size_bytes: asset.downloaded_size_bytes ?? null,
      status: asset.base64 ? 'downloaded'
        : uploadOnly ? 'deferred-authenticated' : 'missing',
      availability_class: uploadOnly ? 'user-upload' : 'public-image',
      local_path: null,
      sha256: null, references: asset.references || [],
      renderer_references: asset.renderer_references || [],
      attempts: asset.attempts || [] };
    if (asset.base64) {
      const bytes = Buffer.from(asset.base64, 'base64');
      const filename = String(index + 1).padStart(3, '0') + '-' +
        safeName(asset.file_id || 'asset') + mediaExtension(asset);
      item.local_path = 'media/' + filename;
      item.downloaded_size_bytes = bytes.length;
      item.sha256 = sha(bytes);
      files.push([item.local_path, bytes]);
      for (const pointer of item.asset_pointers)
        if (typeof pointer === 'string') byPointer.set(pointer, item.local_path);
    }
    manifest.push(item);
  });
  return { files, manifest, byPointer };
}

export function markdownMessage(item, mediaByPointer, sandboxByUri) {
  const parts = item.message?.content?.parts;
  if (!Array.isArray(parts)) return item.text ||
    '[contenuto non testuale; vedi VISIBLE_MESSAGES.jsonl]';
  const rendered = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      rendered.push(rewriteSandboxLinks(part, sandboxByUri));
      continue;
    }
    if (part?.content_type === 'image_asset_pointer' &&
        typeof part.asset_pointer === 'string') {
      const local = mediaByPointer.get(part.asset_pointer);
      if (local) {
        const dims = part.width && part.height ? ` ${part.width}×${part.height}` : '';
        rendered.push(`![immagine${dims}](${local})`);
      } else rendered.push('[immagine non scaricata; vedi NON_TEXT_PARTS.json]');
      continue;
    }
    rendered.push('[contenuto non testuale; vedi NON_TEXT_PARTS.json]');
  }
  return rendered.join('\n\n');
}

export async function exportSnapshot(
  snapshot, selected, outputRoot, source, method, assets = [], sandboxFiles = []
) {
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
  const media = mediaFiles(assets);
  const files = sandboxFileFiles(sandboxFiles);
  const markdown = transcript.visible.map(item =>
    '## ' + (item.role === 'user' ? 'USER' :
      item.channel === 'commentary' ? 'ASSISTANT — commentary' : 'ASSISTANT') +
    '\n\n' + markdownMessage(item, media.byPointer, files.byUri) +
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
      turns: transcript.turns.length,
      complete_turns: transcript.turns.filter(x => x.complete).length,
      activity_surface_nodes: transcript.turns.reduce((n, x) => n + x.activities.length, 0),
      non_text_parts: transcript.nonTextParts.length, classification_counts: transcript.counts },
    nodes: transcript.nodes
  };
  const acquisition = { source, method, captured_mapping_nodes: audit.conversation.mapping_nodes,
    visible_messages: transcript.visible.length, non_text_parts: transcript.nonTextParts.length,
    media_unique_assets: media.manifest.length,
    media_references: media.manifest.reduce((n, x) => n + x.references.length, 0),
    renderer_image_references: media.manifest.reduce((n, x) => n + x.renderer_references.length, 0),
    media_binary_downloaded_count: media.manifest.filter(x => x.status === 'downloaded').length,
    media_binary_missing_count: media.manifest.filter(x => x.status !== 'downloaded').length,
    media_binary_deferred_authenticated_count:
      media.manifest.filter(x => x.status === 'deferred-authenticated').length,
    media_binary_unresolved_public_count:
      media.manifest.filter(x => x.status === 'missing').length,
    media_binary_downloaded: media.manifest.length > 0 && media.manifest.every(x => x.status === 'downloaded'),
    sandbox_files_referenced: files.manifest.length,
    sandbox_files_downloaded_count: files.manifest.filter(x => x.status === 'downloaded').length,
    sandbox_files_missing_count: files.manifest.filter(x => x.status !== 'downloaded').length,
    sandbox_files_downloaded:
      files.manifest.length > 0 && files.manifest.every(x => x.status === 'downloaded'),
    physical_site_completeness_verified: false };
  const items = [
    ['conversation.raw.json.gz', gzipSync(raw, { level: 9, mtime: 0 })],
    ['VISIBLE_MESSAGES.jsonl', Buffer.from(transcript.visible.map(x => JSON.stringify(x)).join('\n') + '\n')],
    ['TURN_SURFACES.jsonl', Buffer.from(transcript.turns.map(x => JSON.stringify(x)).join('\n') + '\n')],
    ['TRANSCRIPT.md', Buffer.from('# ' + title + '\n\nConversation ID: ' +
      (snapshot.conversation_id || '') + '\n\n' +
      '<!-- Text from structured snapshot; non-text objects in VISIBLE_MESSAGES.jsonl. -->\n\n' + markdown)],
    ['NON_TEXT_PARTS.json', Buffer.from(pretty(transcript.nonTextParts))],
    ['MEDIA.json', Buffer.from(pretty(media.manifest))],
    ['FILES.json', Buffer.from(pretty(files.manifest))],
    ['AUDIT.json', Buffer.from(pretty(audit))],
    ['ACQUISITION.json', Buffer.from(pretty(acquisition))],
    ['README.md', Buffer.from('# ChatGPT conversation export\n\n' +
      'Raw structured snapshot, renderer-visible transcript, turn-surface structure and non-text parts are retained.\n' +
      'TURN_SURFACES.jsonl separates user/final-response surfaces from activity/tool/reasoning metadata.\n' +
      'Internal reasoning text is not promoted into the readable transcript.\n' +
      'MEDIA.json separates public image retrieval from user-upload assets deferred to authenticated export. Downloaded binaries live under media/.\n' +
      'FILES.json records assistant sandbox files; downloaded binaries live under files/.\n' +
      'Missing artifacts remain explicit and do not make the export silently complete.\n')]
  ];
  if (media.files.length)
    await fs.mkdir(path.join(directory, 'media'), { recursive: true, mode: 0o700 });
  if (files.files.length)
    await fs.mkdir(path.join(directory, 'files'), { recursive: true, mode: 0o700 });
  for (const [name, bytes] of [...items, ...media.files, ...files.files])
    await fs.writeFile(path.join(directory, name), bytes, { mode: 0o600, flag: 'wx' });
  const checksums = [sha(raw) + '  conversation.raw.json (uncompressed captured snapshot)',
    ...[...items, ...media.files, ...files.files]
      .map(([name, bytes]) => sha(bytes) + '  ' + name)].join('\n') + '\n';
  const sums = Buffer.from(checksums);
  await fs.writeFile(path.join(directory, 'SHA256SUMS'), sums, { mode: 0o600, flag: 'wx' });
  const archive = path.join(outputRoot, folder + '.zip');
  await fs.writeFile(archive,
    zipFiles([...items, ...media.files, ...files.files, ['SHA256SUMS', sums]]),
    { mode: 0o600, flag: 'wx' });
  return { directory, zip: archive, title, messageCount: transcript.visible.length,
    mappingNodes: audit.conversation.mapping_nodes,
    nonTextParts: transcript.nonTextParts.length,
    imagesReferenced: media.manifest.length,
    imageReferences: media.manifest.reduce((n, x) => n + x.references.length, 0),
    rendererImageReferences: media.manifest.reduce((n, x) => n + x.renderer_references.length, 0),
    imagesDownloaded: media.manifest.filter(x => x.status === 'downloaded').length,
    imagesMissing: media.manifest.filter(x => x.status !== 'downloaded').length,
    imagesDeferredAuthenticated:
      media.manifest.filter(x => x.status === 'deferred-authenticated').length,
    imagesPublicUnresolved:
      media.manifest.filter(x => x.status === 'missing').length,
    filesReferenced: files.manifest.length,
    filesDownloaded: files.manifest.filter(x => x.status === 'downloaded').length,
    filesMissing: files.manifest.filter(x => x.status !== 'downloaded').length,
    method, observationComplete: false };
}
