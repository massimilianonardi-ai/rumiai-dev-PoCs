// JavaScript port of the data and archive stages in the user-supplied
// chatgpt-export.py. The macOS catalog and renderer breakpoint are NOT part
// of this module: a shared URL identifies the source conversation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync, deflateRawSync} from 'node:zlib';

const internalContentTypes = new Set(['thoughts', 'reasoning_recap']);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const jsonPretty = value => JSON.stringify(value, null, 2);
const utf8 = value => Buffer.from(value, 'utf8');

function _pythonTextLength(value)
{
  return Array.from(value).length;
}

export function textualFragments(content)
{
  const fragments = [];
  const nonText = [];
  if (Array.isArray(content?.parts))
  {
    content.parts.forEach((part, index) =>
    {
      if (typeof part === 'string')
        fragments.push(part);
      else
        nonText.push({part_index: index, part});
    });
  }
  if (!fragments.length)
  {
    for (const key of ['text', 'code'])
    {
      if (typeof content?.[key] === 'string')
      {
        fragments.push(content[key]);
        break;
      }
    }
  }
  return {text: fragments.join(''), nonText};
}

export function classifyMessage(message)
{
  const role = message?.author?.role;
  const channel = message?.channel;
  const recipient = message?.recipient;
  const type = message?.content?.content_type;
  if (role === 'tool')
    return {included: false, classification: 'tool_traffic'};
  if (role !== 'user' && role !== 'assistant')
    return {included: false, classification: 'internal_role:' + String(role ?? 'None')};
  if (internalContentTypes.has(type))
    return {included: false, classification: 'internal_reasoning'};
  if (role === 'assistant' && channel === 'analysis')
    return {included: false, classification: 'assistant_analysis'};
  if (role === 'assistant' && recipient !== null && recipient !== undefined &&
      recipient !== '' && recipient !== 'all')
    return {included: false, classification: 'assistant_tool_invocation'};
  return {included: true, classification: 'visible_candidate'};
}

export function activeBranch(snapshot)
{
  if (!snapshot || !snapshot.mapping ||
      typeof snapshot.mapping !== 'object' ||
      Array.isArray(snapshot.mapping))
    throw new Error('python-export.invalid-mapping');
  const chain = [];
  const seen = new Set();
  let id = snapshot.current_node;
  while (id)
  {
    if (seen.has(id))
      throw new Error('python-export.parent-cycle: ' + id);
    seen.add(id);
    if (!Object.hasOwn(snapshot.mapping, id))
      throw new Error('python-export.parent-missing: ' + id);
    const node = snapshot.mapping[id];
    if (!node || typeof node !== 'object')
      throw new Error('python-export.invalid-node: ' + id);
    chain.push({id, node});
    id = node.parent;
  }
  return chain.reverse();
}

function _buildVisible(chain)
{
  const visible = [];
  const auditRows = [];
  const nonTextParts = [];
  const counts = {};
  function count(classification)
  {
    counts[classification] = (counts[classification] || 0) + 1;
  }
  chain.forEach(({id, node}, ordinal) =>
  {
    const message = node.message;
    if (!message)
    {
      count('no_message');
      auditRows.push({ordinal, node_id: id, classification: 'no_message', included: false});
      return;
    }
    const role = message.author?.role ?? null;
    const channel = message.channel ?? null;
    const recipient = message.recipient ?? null;
    const content = message.content || {};
    const type = content.content_type ?? null;
    const {text, nonText} = textualFragments(content);
    let {included, classification} = classifyMessage(message);
    if (included && role === 'assistant' && !text && !nonText.length)
    {
      included = false;
      classification = 'empty_assistant_node';
    }
    count(classification);
    auditRows.push
    ({
      ordinal,
      node_id: id,
      message_id: message.id ?? null,
      role, channel, recipient,
      content_type: type,
      classification, included,
      text_length: _pythonTextLength(text),
      non_text_parts: nonText.length
    });
    if (!included)
      return;
    visible.push
    ({
      ordinal,
      node_id: id,
      parent: node.parent ?? null,
      message_id: message.id ?? null,
      role, channel, recipient,
      content_type: type,
      create_time: message.create_time ?? null,
      text,
      message // Full original message, never a text-only projection.
    });
    for (const part of nonText)
    {
      nonTextParts.push
      ({
        ordinal,
        node_id: id,
        message_id: message.id ?? null,
        role,
        content_type: type,
        ...part
      });
    }
  });
  return {visible, auditRows, nonTextParts, counts};
}

// The ZIP format is implemented in Node, avoiding Python and OS-specific zip
// utilities. Timestamps are fixed for reproducible archives.
function _crc32(bytes)
{
  let crc = 0xffffffff;
  for (const byte of bytes)
  {
    crc ^= byte;
    for (let i = 0; i < 8; i++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipFiles(entries)
{
  const local = [];
  const central = [];
  let offset = 0;
  for (const [filename, bytes] of entries)
  {
    const name = utf8(filename);
    const data = deflateRawSync(bytes, {level: 9});
    const crc = _crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    header.writeUInt16LE(8, 8); // DEFLATE
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function _markdown(title, conversationId, visible, sourceKind)
{
  let result = '# ' + title + '\n\nConversation ID: `' + conversationId + '`\n\n' +
    (sourceKind.includes('renderer conversation snapshot') ?
      '<!-- Derived from a captured ChatGPT conversation snapshot. -->\n' :
      '<!-- Derived from retained shared-page DOM; this is not a renderer snapshot. -->\n') +
    '<!-- Text strings are not stripped, rewritten or normalized. -->\n' +
    '<!-- Non-text multimodal parts are preserved in VISIBLE_MESSAGES.jsonl ' +
    'and NON_TEXT_PARTS.json. -->\n\n';
  for (const item of visible)
  {
    const heading = item.role === 'user' ? 'USER' :
      item.role === 'assistant' && item.channel === 'commentary' ?
        'ASSISTANT — commentary' :
      item.role === 'assistant' ? 'ASSISTANT' : 'OBSERVED — ' + (item.role ?? 'unknown');
    result += '## ' + heading + '\n\n' +
      (item.text || '[contenuto non testuale; vedi VISIBLE_MESSAGES.jsonl]') + '\n\n';
  }
  return result;
}

async function _writeBundle(outdir, rawJson, snapshot, result, sourceKind, notes)
{
  const raw = utf8(rawJson);
  const visible = result.visible;
  const nonText = result.nonTextParts;
  const title = snapshot.title || snapshot.conversation_id || 'Untitled';
  const id = snapshot.conversation_id ?? '';
  const mappingCount = snapshot.mapping ? Object.keys(snapshot.mapping).length : null;
  const branchCount = snapshot.active_nodes ?? null;
  const audit =
  {
    source:
    {
      kind: sourceKind,
      raw_uncompressed_bytes: raw.length,
      raw_sha256: sha256(raw),
      ...notes
    },
    conversation:
    {
      title,
      conversation_id: id,
      create_time: snapshot.create_time ?? null,
      update_time: snapshot.update_time ?? null,
      current_node: snapshot.current_node ?? null,
      mapping_nodes: mappingCount,
      active_branch_nodes: branchCount,
      nodes_outside_active_branch: mappingCount === null ? null : mappingCount - branchCount
    },
    transcript:
    {
      visible_messages: visible.length,
      visible_user_messages: visible.filter(item => item.role === 'user').length,
      visible_assistant_messages: visible.filter(item => item.role === 'assistant').length,
      non_text_parts: nonText.length,
      classification_counts: result.counts
    },
    nodes: result.auditRows
  };
  const snapshotSource = sourceKind.includes('renderer conversation snapshot');
  const readme = snapshotSource ?
    '# ChatGPT conversation export\n\n' +
    'Title: `' + title + '`\n\nConversation ID: `' + id + '`\n\n' +
    '## Files\n\n' +
    '- `conversation.raw.json.gz`: complete captured conversation snapshot, compressed.\n' +
    '- `TRANSCRIPT.md`: human-readable textual conversation.\n' +
    '- `VISIBLE_MESSAGES.jsonl`: all messages classified as user-visible, including their full message objects.\n' +
    '- `NON_TEXT_PARTS.json`: non-string multimodal parts extracted from visible messages.\n' +
    '- `AUDIT.json`: classification of every node in the snapshot.\n' +
    '- `SHA256SUMS`: integrity hashes.\n\n' +
    '## Snapshot\n\n' +
    '- RAW uncompressed bytes: ' + raw.length + '\n' +
    '- RAW SHA-256: `' + sha256(raw) + '`\n' +
    '- Mapping nodes: ' + mappingCount + '\n' +
    '- Active-branch nodes: ' + branchCount + '\n' +
    '- Nodes outside active branch: ' + (mappingCount - branchCount) + '\n' +
    '- Visible messages: ' + visible.length + '\n' +
    '- Non-text visible parts: ' + nonText.length + '\n\n' +
    '`TRANSCRIPT.md` excludes tool traffic and internal reasoning. The complete\n' +
    'captured snapshot remains preserved in `conversation.raw.json.gz`.\n' :
    '# ChatGPT conversation export\n\n' +
    'Title: `' + title + '`\n\nConversation ID: `' + id + '`\n\n' +
    '## Files\n\n' +
    '- `conversation.raw.json.gz`: compressed captured DOM observation record.\n' +
    '- `TRANSCRIPT.md`: human-readable observed conversation text.\n' +
    '- `VISIBLE_MESSAGES.jsonl`: captured turns and all their available DOM markup.\n' +
    '- `NON_TEXT_PARTS.json`: retained source DOM markup.\n' +
    '- `AUDIT.json`: classification and provenance of every observed turn.\n' +
    '- `SHA256SUMS`: integrity hashes.\n\n' +
    '## Source\n\n' + sourceKind + '\n\n' +
    (notes.provenance_warning || '') + '\n\n' +
    'Source bytes: ' + raw.length + '\n\n' +
    'Source SHA-256: `' + sha256(raw) + '`\n';
  const files =
  [
    ['conversation.raw.json.gz', gzipSync(raw, {level: 9, mtime: 0})],
    ['TRANSCRIPT.md', utf8(_markdown(title, id, visible, sourceKind))],
    ['VISIBLE_MESSAGES.jsonl', utf8(visible.map(x => JSON.stringify(x)).join('\n') +
      (visible.length ? '\n' : ''))],
    ['NON_TEXT_PARTS.json', utf8(jsonPretty(nonText))],
    ['AUDIT.json', utf8(jsonPretty(audit))],
    ['README.md', utf8(readme)]
  ];
  const hashes = sha256(raw) + '  conversation.raw.json ' +
    (snapshotSource ? '(uncompressed captured snapshot)' :
      '(uncompressed captured source)') + '\n' +
    files.map(([name, bytes]) => sha256(bytes) + '  ' + name + '\n').join('');
  files.push(['SHA256SUMS', utf8(hashes)]);
  await fs.mkdir(outdir, {mode: 0o700}); // Do not overwrite previous runs.
  for (const [name, bytes] of files)
    await fs.writeFile(path.join(outdir, name), bytes, {flag: 'wx', mode: 0o600});
  const zip = outdir + '.zip';
  await fs.writeFile(zip, zipFiles(files), {flag: 'wx', mode: 0o600});
  return {outdir, zip, visible_messages: visible.length,
    non_text_parts: nonText.length, raw_sha256: sha256(raw)};
}

export async function exportSnapshot(rawJson, outdir)
{
  const snapshot = JSON.parse(rawJson);
  const chain = activeBranch(snapshot);
  const result = _buildVisible(chain);
  return _writeBundle
  (
    outdir,
    rawJson, // Exact original snapshot JSON bytes, unlike a reserialization.
    {...snapshot, active_nodes: chain.length},
    result,
    'ChatGPT renderer conversation snapshot captured via CDP',
    {}
  );
}

// Shared pages expose observed DOM turns, NOT the complete macOS renderer
// snapshot. Never manufacture mapping/current_node or parent relationships.
export async function exportDomObservation(capture, outdir)
{
  const {url, ordered, continuity} = capture;
  if (!/^https:\/\/chatgpt\.com\/share\/[a-zA-Z0-9-]+$/.test(url))
    throw new Error('python-export.share-url-invalid');
  if (!Array.isArray(ordered))
    throw new Error('python-export.observations-missing');
  const id = new URL(url).pathname.split('/').at(-1);
  const snapshot =
  {
    source_kind: 'shared-page-dom-observations',
    source_url: url,
    conversation_id: id,
    title: 'ChatGPT shared conversation',
    complete: false,
    continuity,
    observations: ordered
  };
  const visible = [];
  const auditRows = [];
  const nonTextParts = [];
  const counts = {};
  ordered.forEach((record, ordinal) =>
  {
    if (!record || typeof record.key !== 'string' ||
        typeof record.html !== 'string')
      throw new Error('python-export.invalid-dom-record');
    const role = record.role;
    const text = record.text || '';
    const part =
    {
      source: 'original-message-dom',
      html: record.html
    };
    const message =
    {
      id: record.key,
      author: {role},
      content: {content_type: 'dom_observation', parts: [text, part]},
      source: 'observed-dom-not-original-message-object'
    };
    // No manual message selection or exclusion in the share-link path.
    // A missing role does not justify dropping an observed DOM subtree.
    const included = true;
    const classification = 'observed_dom_turn';
    counts[classification] = (counts[classification] || 0) + 1;
    auditRows.push
    ({
      ordinal, node_id: record.key, message_id: record.key,
      role, channel: null, recipient: null,
      content_type: 'dom_observation', classification, included,
      text_length: _pythonTextLength(text), non_text_parts: 1
    });
    if (!included)
      return;
    visible.push
    ({
      ordinal, node_id: record.key, parent: null,
      message_id: record.key, role, channel: null, recipient: null,
      content_type: 'dom_observation', create_time: null, text, message
    });
    nonTextParts.push
    ({
      ordinal, node_id: record.key, message_id: record.key, role,
      content_type: 'dom_observation', part_index: 1, part
    });
  });
  const notes =
  {
    provenance_warning: 'DOM accumulation: original renderer mapping and full ' +
      'message objects were not available. Order, endpoints, attachments and ' +
      'rendering remain unverified; no parent chain was invented.',
    complete_export_verified: false,
    observed_turns: ordered.length,
    order_components: continuity?.orderComponents ?? null
  };
  return _writeBundle
  (
    outdir,
    JSON.stringify(snapshot),
    {...snapshot, active_nodes: null},
    {visible, auditRows, nonTextParts, counts},
    'ChatGPT shared-page DOM accumulation (not renderer snapshot)',
    notes
  );
}
