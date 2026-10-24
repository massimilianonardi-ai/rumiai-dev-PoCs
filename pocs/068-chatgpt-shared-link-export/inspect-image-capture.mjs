'use strict';
// Privacy-limited read-only diagnostics for image-bearing shared pages.
// Never print response URLs, RAW message IDs, source text or image bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {audit} from './audit-rendered-dom-raw.mjs';

function jsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, i) => {
    try {return JSON.parse(line);} catch {throw Error('Malformed JSONL at line ' + (i + 1));}
  });
}
function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function originClass(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:') return 'inline-data';
    if (parsed.protocol === 'blob:') return 'browser-blob';
    if (!['https:', 'http:'].includes(parsed.protocol)) return 'other-scheme';
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname.endsWith('.chatgpt.com')) return 'chatgpt';
    if (parsed.hostname === 'openai.com' || parsed.hostname.endsWith('.openai.com') ||
        parsed.hostname === 'oaistatic.com' || parsed.hostname.endsWith('.oaistatic.com'))
      return 'openai-static';
    if (parsed.hostname === 'www.google.com' || parsed.hostname.endsWith('.gstatic.com'))
      return 'google-assets';
    return 'other-host';
  } catch {return 'relative-or-invalid';}
}
function counted(object, name) {object[name] = (object[name] || 0) + 1;}
function mimeClass(row) {
  if (typeof row.mimeType === 'string' && row.mimeType.startsWith('image/')) return row.mimeType;
  return row.resourceType === 'Image' ? 'image/unknown' : 'not-image';
}
function imageDimensions(data, mime) {
  if (mime === 'image/png' && data.length >= 24 &&
      data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  }
  if (mime === 'image/webp' && data.length >= 16 &&
      data.toString('ascii', 0, 4) === 'RIFF' &&
      data.toString('ascii', 8, 12) === 'WEBP') return null; // Header variants need decoding.
  return null;
}
function safeImageBytes(directory, row) {
  if (!/^resources\/[a-f0-9]{64}\.[a-z0-9]+$/.test(row.file || '') ||
      !row.file.includes(row.sha256)) throw Error('Unsafe image response file reference');
  const bytes = fs.readFileSync(path.join(directory, row.file));
  if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256)
    throw Error('Archived image integrity verification failed');
  return bytes;
}
function snapshotTags(html) {
  const stats = {img: 0, picture: 0, canvas: 0, svg: 0, sources: {}};
  for (const element of html.matchAll(/<(img|picture|canvas|svg)\b/gi))
    stats[element[1].toLowerCase()]++;
  for (const element of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = element[0];
    const src = /\bsrc\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2];
    counted(stats.sources, src ? originClass(src.replace(/&amp;/g, '&')) : 'missing-src');
  }
  return stats;
}
function snapshotBytes(directory, event) {
  if (!/^turns\/[a-f0-9]{64}\.html$/.test(event.file || '') ||
      !event.file.includes(event.sha256 || '')) throw Error('Unsafe turn snapshot reference');
  const bytes = fs.readFileSync(path.join(directory, event.file));
  if (sha256(bytes) !== event.sha256 || bytes.length !== event.bytes)
    throw Error('Turn snapshot integrity verification failed');
  return bytes.toString('utf8');
}
export function inspectImages(cumulativeDir, resourcesDir, probeDir) {
  const cumulative = path.resolve(cumulativeDir);
  const resources = path.resolve(resourcesDir);
  const probe = path.resolve(probeDir);
  const rawAudit = audit(cumulative, resources);
  const rows = jsonl(path.join(resources, 'resources.jsonl'));
  const events = jsonl(path.join(probe, 'events.jsonl'));
  const imageRecords = [];
  const byType = {}, byOrigin = {};
  let totalImageBytes = 0;
  for (const row of rows) {
    if (row.status !== 'saved' || mimeClass(row) === 'not-image') continue;
    const bytes = safeImageBytes(resources, row);
    const mime = mimeClass(row);
    const host = originClass(row.url);
    counted(byType, mime);
    counted(byOrigin, host);
    totalImageBytes += bytes.length;
    imageRecords.push({
      ordinal: imageRecords.length + 1,
      mime, bytes: bytes.length, originClass: host,
      dimensions: imageDimensions(bytes, mime)
    });
  }
  const initial = events.filter(e => e.kind === 'turn.initial');
  const snapshots = events.filter(e => e.kind === 'turn.snapshot' && e.file);
  const unidentified = events.filter(e => e.kind === 'turn.unidentified-snapshot' && e.file);
  const uniqueTurns = new Set(snapshots.map(e => e.turnId));
  const unidentifiedTurns = new Set(unidentified.map(e => e.turnId));
  const elementCounts = {img:0,picture:0,canvas:0,svg:0};
  const imageSourceKinds = {};
  let snapshotsWithImg = 0;
  for (const event of snapshots) {
    const stats = snapshotTags(snapshotBytes(probe, event));
    if (stats.img > 0) snapshotsWithImg++;
    for (const key of Object.keys(elementCounts)) elementCounts[key] += stats[key];
    for (const [kind, count] of Object.entries(stats.sources))
      imageSourceKinds[kind] = (imageSourceKinds[kind] || 0) + count;
  }
  // These HTML files were never eligible for the cumulative assembler.
  const unidentifiedElementCounts = {img:0,picture:0,canvas:0,svg:0};
  const unidentifiedSourceKinds = {};
  let unidentifiedSnapshotsWithImg = 0;
  for (const event of unidentified) {
    const stats = snapshotTags(snapshotBytes(probe, event));
    if (stats.img > 0) unidentifiedSnapshotsWithImg++;
    for (const key of Object.keys(unidentifiedElementCounts))
      unidentifiedElementCounts[key] += stats[key];
    for (const [kind, count] of Object.entries(stats.sources))
      unidentifiedSourceKinds[kind] = (unidentifiedSourceKinds[kind] || 0) + count;
  }
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(cumulative, 'resource-references.json'), 'utf8'));
  if (!Array.isArray(sourceManifest)) throw Error('Invalid cumulative resource reference list');
  const linkKinds = {};
  for (const ref of sourceManifest) {
    if (ref.attribute !== 'src' && ref.attribute !== 'srcset') continue;
    counted(linkKinds, originClass(ref.reference));
  }
  return {
    status: 'image-capture-diagnostic-only',
    archive: {
      savedImageResponses: imageRecords.length, savedImageBytes: totalImageBytes,
      byMime: byType, byOriginClass: byOrigin,
      images: imageRecords
    },
    probe: {
      initiallyObservedTurnWrappers: initial.length,
      initiallyWithMessageIds: initial.filter(e => e.messageIds?.length).length,
      initiallyWithoutMessageIds: initial.filter(e => !e.messageIds?.length).length,
      snapshotEvents: snapshots.length, distinctSnapshotTurnIds: uniqueTurns.size,
      snapshotsWithImg, elementCounts, imgSrcClasses: imageSourceKinds,
      unidentifiedSnapshotEvents: unidentified.length,
      unidentifiedDistinctTurnIds: unidentifiedTurns.size,
      unidentifiedSnapshotsWithImg, unidentifiedElementCounts,
      unidentifiedImgSrcClasses: unidentifiedSourceKinds
    },
    cumulative: {
      turns: rawAudit.capturedTurns, messageIds: rawAudit.capturedDomMessages,
      referenceSrcClasses: linkKinds,
      rawAuditStatus: rawAudit.status,
      missingTurnOrdinalCount: rawAudit.missingTurnOrdinalCount,
      assistantNodesWithoutFinalMarker: rawAudit.assistantNodesWithoutFinalMarker,
      assistantAddressedToAllWithoutFinalMarker: rawAudit.assistantAddressedToAllWithoutFinalMarker
    },
    limitations: [
      'PNG bytes cannot be attributed to generated messages without image/DOM or RAW linkage',
      'Missing turn wrappers and image widgets cannot be reconstructed from absent snapshots',
      'Image dimensions do not prove visual fidelity, role or source conversation association',
      'Snapshots represent observed frames only; source content and URLs are not emitted'
    ]
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [cumulative, resources, probe] = process.argv.slice(2);
  if (!cumulative || !resources || !probe || process.argv.length !== 5) {
    console.error('Usage: node inspect-image-capture.mjs <cumulative-dir> <web-analyze-dir> <render-probe-dir>');
    process.exitCode = 2;
  } else {
    try {console.log(JSON.stringify(inspectImages(cumulative, resources, probe), null, 2));}
    catch (e) {console.error(e.message); process.exitCode = 1;}
  }
}
