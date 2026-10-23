'use strict';
// Experimental PoC 068: compare the DOM's ordered message IDs with the
// React Router hydration RAW embedded in the *already archived* shared HTML.
// Never evaluates the page scripts or exports message contents.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sharePath = /^https:\/\/chatgpt\.com\/share\/[a-f0-9-]+(?:\/)?(?:\?|$)/i;
const responsePath = /^resources\/([a-f0-9]{64})\.html$/;

function archivedDocument(directory) {
  const rows = fs.readFileSync(path.join(directory, 'resources.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((row, i) => {
      try {return JSON.parse(row);}
      catch {throw Error('Invalid resource index JSONL line ' + (i + 1));}
    });
  const candidates = rows.filter(row => row.status === 'saved' &&
    row.resourceType === 'Document' && row.mimeType === 'text/html' &&
    typeof row.url === 'string' && sharePath.test(row.url));
  const versions = new Map(candidates.map(row => [row.sha256, row]));
  if (versions.size !== 1)
    throw Error('Expected exactly one saved share HTML body (found ' + versions.size + ')');
  const record = [...versions.values()][0];
  const match = responsePath.exec(record.file || '');
  if (!match || record.sha256 !== match[1])
    throw Error('Invalid archived HTML file reference');
  const bytes = fs.readFileSync(path.join(directory, record.file));
  if (record.bytes !== bytes.length || hash(bytes) !== record.sha256)
    throw Error('Archived share HTML failed SHA-256/length verification');
  return {html:bytes.toString('utf8'),sha256:record.sha256};
}

function decodeHydration(html) {
  const regex = /streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/g;
  const chunks = [...html.matchAll(regex)].map(found => {
    try {return JSON.parse(found[1]);}
    catch {throw Error('Invalid JavaScript string in hydration stream');}
  });
  if (!chunks.length) throw Error('No serialized React Router hydration stream found');
  // The leading TurboStream/devalue flattened table is a JSON array; later
  // lines represent promise frames, not additional linear-conversation nodes.
  const first = chunks.join('').split('\n', 1)[0];
  let values;
  try {values = JSON.parse(first);}
  catch {throw Error('Invalid flattened hydration table');}
  if (!Array.isArray(values)) throw Error('Hydration table is not an array');
  const index = values.indexOf('linear_conversation');
  const entries = index === -1 ? null : values[index + 1];
  if (!Array.isArray(entries)) throw Error('No linear_conversation array in hydration');
  const field = (entry, name) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    for (const [k, v] of Object.entries(entry)) {
      if (!/^_\d+$/.test(k)) continue;
      if (values[Number(k.slice(1))] === name) return values[v];
    }
    return undefined;
  };
  const roleCounts = {}, visible = [];
  let hiddenFinal = 0, ignored = 0;
  for (const ref of entries) {
    if (!Number.isInteger(ref) || ref < 0 || ref >= values.length)
      throw Error('Invalid RAW node reference');
    const node = values[ref];
    const message = field(node, 'message');
    if (!message) {ignored++; continue;}
    const author = field(message, 'author');
    const role = field(author, 'role');
    roleCounts[role || 'unknown'] = (roleCounts[role || 'unknown'] || 0) + 1;
    const messageId = field(message, 'id');
    const metadata = field(message, 'metadata');
    const hidden = field(metadata, 'is_visually_hidden_from_conversation') === true;
    const final = field(message, 'end_turn') === true;
    const recipient = field(message, 'recipient');
    if (hidden && role === 'assistant' && final) hiddenFinal++;
    if (hidden || recipient !== 'all' ||
        !(role === 'user' || (role === 'assistant' && final))) continue;
    if (typeof messageId !== 'string' || !messageId)
      throw Error('Visible RAW message lacks a valid ID');
    visible.push({id:messageId, role});
  }
  if (!visible.length) throw Error('No visible messages were found in the RAW stream');
  if (new Set(visible.map(x => x.id)).size !== visible.length)
    throw Error('Duplicate visible message IDs in RAW');
  return {rawNodes:entries.length, ignoredNodes:ignored, roleCounts, hiddenFinal, visible};
}

export function audit(cumulativeDir, resourceDir) {
  const cumulative = path.resolve(cumulativeDir), resources = path.resolve(resourceDir);
  const raw = archivedDocument(resources);
  const parsed = decodeHydration(raw.html);
  const structure = JSON.parse(fs.readFileSync(path.join(cumulative, 'audit.json'), 'utf8'));
  if (!Array.isArray(structure.turns)) throw Error('Cumulative audit lacks turns');
  const turns = [...structure.turns].sort((a,b) => a.ordinal - b.ordinal);
  const ids = turns.flatMap(turn => turn.messageIds);
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length)
    throw Error('Invalid or duplicate DOM message IDs');
  const expected = parsed.visible.map(row => row.id);
  const rawSet = new Set(expected), capturedSet = new Set(ids);
  const missingFromDom = expected.filter(id => !capturedSet.has(id));
  const extraInDom = ids.filter(id => !rawSet.has(id));
  const orderMatches = ids.length === expected.length &&
    ids.every((id, i) => id === expected[i]);
  return {
    status: !missingFromDom.length && !extraInDom.length && orderMatches ?
      'complete-visible-message-identity-and-order' : 'raw-dom-mismatch',
    source: 'archived shared HTML React Router hydration',
    sourceSha256:raw.sha256, rawNodes:parsed.rawNodes,
    roles:parsed.roleCounts, ignoredNodesWithoutMessage:parsed.ignoredNodes,
    hiddenFinalAssistantMessages:parsed.hiddenFinal,
    expectedVisibleMessages:expected.length, expectedUserMessages:parsed.visible.filter(x=>x.role==='user').length,
    expectedAssistantMessages:parsed.visible.filter(x=>x.role==='assistant').length,
    capturedDomMessages:ids.length, capturedTurns:turns.length,
    missingFromDomCount:missingFromDom.length, extraInDomCount:extraInDom.length,
    orderMatches, orderedVisibleIdSha256:hash(Buffer.from(expected.join('\n'),'utf8')),
    orderedDomIdSha256:hash(Buffer.from(ids.join('\n'),'utf8')),
    note:'Identity/order audit of this archived share only; not a text, asset or interaction fidelity test'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [cumulative, resources, option, destination] = process.argv.slice(2);
  if (!cumulative || !resources || (option !== undefined && (option !== '--out' || !destination)) ||
      process.argv.length !== (option === '--out' ? 6 : 4)) {
    console.error('Usage: node audit-rendered-dom-raw.mjs <cumulative-dir> <web-analyze-dir> [--out <new-json-path>]');
    process.exitCode = 2;
  } else {
    try {
      const result = audit(cumulative, resources);
      const json = JSON.stringify(result, null, 2) + '\n';
      if (option === '--out') fs.writeFileSync(path.resolve(destination), json, {flag:'wx', mode:0o600});
      console.log(json.trimEnd());
      if (result.status !== 'complete-visible-message-identity-and-order') process.exitCode = 1;
    } catch (error) {console.error(error.message);process.exitCode = 1;}
  }
}
