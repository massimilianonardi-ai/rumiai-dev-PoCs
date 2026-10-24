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

function canonicalImageUrl(value) {
  try {
    const url = new URL(value.replace(/&amp;/gi, '&'), 'https://chatgpt.com/');
    if (!['https:', 'http:', 'data:', 'blob:'].includes(url.protocol))
      return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

// Extract only literal img src attributes; data-src, srcset and CSS are not
// proof of the actually selected browser image request.
function imageReferences(html) {
  const references = [];
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\ssrc\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag[0])?.[2];
    references.push(src ? canonicalImageUrl(src) : null);
  }
  return references;
}

function turnOrdinal(html) {
  const ordinals = new Set([...html.matchAll(/\bdata-testid=["']conversation-turn-(\d+)["']/g)]
    .map(match => Number(match[1])));
  return ordinals.size === 1 && Number.isSafeInteger([...ordinals][0]) ?
    [...ordinals][0] : null;
}


// Redirect identity is evidence only with the same nonempty CDP request key
// and exactly one saved image-body hash for that request.
function redirectBodies(rows) {
  const key = row => typeof row.session === 'string' && row.session &&
    typeof row.requestId === 'string' && row.requestId ?
    JSON.stringify([row.session, row.requestId]) : null;
  const bodies = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!id || row.status !== 'saved' || mimeClass(row) === 'not-image') continue;
    if (!bodies.has(id)) bodies.set(id, new Map());
    bodies.get(id).set(row.sha256, mimeClass(row));
  }
  const aliases = new Map(), ambiguous = new Set();
  for (const row of rows) {
    if (row.status !== 'redirect-no-body') continue;
    const id = key(row), url = canonicalImageUrl(row.url || '');
    if (!id || !url || !bodies.has(id)) continue;
    const targets = bodies.get(id);
    if (targets.size !== 1) {ambiguous.add(url);continue;}
    const [hash, mime] = targets.entries().next().value;
    if (aliases.has(url) && aliases.get(url).hash !== hash)
      ambiguous.add(url);
    else aliases.set(url, {hash, mime});
  }
  for (const url of ambiguous) aliases.delete(url);
  return aliases;
}

function unmatchedEvidence(urls, archived, redirects) {
  const summary = {
    sameRequestRedirect:0, sameOriginPathDifferentQuery:0,
    sameOriginDifferentPath:0, samePathDifferentOrigin:0,
    noSharedOriginOrPath:0, nonHttp:0, redirectPngBodies:0
  };
  const pngBodies = new Set();
  for (const value of urls) {
    if (archived.has(value)) continue;
    const redirect = redirects.get(value);
    if (redirect) {
      summary.sameRequestRedirect++;
      if (redirect.mime === 'image/png') pngBodies.add(redirect.hash);
      continue;
    }
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      summary.nonHttp++;
      continue;
    }
    const possibilities = [...archived.keys()].map(x => new URL(x))
      .filter(x => ['http:', 'https:'].includes(x.protocol));
    if (possibilities.some(x => x.origin === url.origin && x.pathname === url.pathname))
      summary.sameOriginPathDifferentQuery++;
    else if (possibilities.some(x => x.origin === url.origin))
      summary.sameOriginDifferentPath++;
    else if (possibilities.some(x => x.pathname === url.pathname))
      summary.samePathDifferentOrigin++;
    else summary.noSharedOriginOrPath++;
  }
  summary.redirectPngBodies = pngBodies.size;
  return summary;
}


// Candidate inventory: a common origin/path is only a hint. Query differences
// may select a different body; never silently promote candidates to matches.
function queryProfile(source, candidate) {
  const groups = url => {
    const byKey = new Map();
    for (const [name, value] of url.searchParams) {
      if (!byKey.has(name)) byKey.set(name, []);
      byKey.get(name).push(value);
    }
    for (const values of byKey.values()) values.sort();
    return byKey;
  };
  const a = groups(source), b = groups(candidate);
  const comparison = {identicalValueKeys:0, changedValueKeys:0,
    snapshotOnlyKeys:0, archiveOnlyKeys:0};
  for (const [name, values] of a) {
    if (!b.has(name)) comparison.snapshotOnlyKeys++;
    else if (JSON.stringify(values) === JSON.stringify(b.get(name)))
      comparison.identicalValueKeys++;
    else comparison.changedValueKeys++;
  }
  for (const name of b.keys()) if (!a.has(name)) comparison.archiveOnlyKeys++;
  return comparison;
}

function samePathCandidateEvidence(urls, savedImages) {
  const evidence = {
    unmatchedReferencesWithNoCandidate:0,
    unmatchedReferencesWithSingleBodyCandidate:0,
    unmatchedReferencesWithMultipleBodyCandidates:0,
    distinctSingleCandidatePngBodies:0,
    queryComparison: {references:0, identicalValueKeys:0,
      changedValueKeys:0, snapshotOnlyKeys:0, archiveOnlyKeys:0}
  };
  const singlePngBodies = new Set();
  for (const value of urls) {
    const requested = new URL(value);
    if (!['https:', 'http:'].includes(requested.protocol)) {
      evidence.unmatchedReferencesWithNoCandidate++;
      continue;
    }
    const candidates = savedImages.filter(({url}) => {
      const found = new URL(url);
      return found.origin === requested.origin && found.pathname === requested.pathname;
    });
    const hashes = new Set(candidates.map(row => row.sha256));
    if (!hashes.size) {
      evidence.unmatchedReferencesWithNoCandidate++;
      continue;
    }
    if (hashes.size > 1) {
      evidence.unmatchedReferencesWithMultipleBodyCandidates++;
      continue;
    }
    evidence.unmatchedReferencesWithSingleBodyCandidate++;
    if (candidates.some(row => row.mime === 'image/png'))
      singlePngBodies.add(candidates[0].sha256);
    const urlsSeen = new Set(candidates.map(row => row.url));
    if (urlsSeen.size !== 1) continue; // Query comparison is ambiguous.
    const delta = queryProfile(requested, new URL(candidates[0].url));
    evidence.queryComparison.references++;
    for (const key of ['identicalValueKeys','changedValueKeys',
        'snapshotOnlyKeys','archiveOnlyKeys']) evidence.queryComparison[key] += delta[key];
  }
  evidence.distinctSingleCandidatePngBodies = singlePngBodies.size;
  return evidence;
}

// A match is an exact original-URL match to a SHA-256-verified saved response;
// it does not prove the DOM used that body, that an assistant authored it,
// or that a potentially signed/redirected URL remains valid later.
function correlateSnapshotImages(snapshotEvents, probe, archivedImages, redirects, savedImages) {
  const turns = new Map(), urls = new Set(), matchedBodies = new Set();
  const unmatched = new Set();
  let imageBearingSnapshotEvents = 0;
  let imageTagOccurrences = 0;
  let missingSrcOccurrences = 0;
  for (const event of snapshotEvents) {
    const html = snapshotBytes(probe, event);
    const references = imageReferences(html);
    if (!references.length) continue;
    imageBearingSnapshotEvents++;
    imageTagOccurrences += references.length;
    let turn = turns.get(event.turnId);
    if (!turn) {
      turn = {ordinals: new Set(), snapshotEvents: 0, imageTags: 0,
        urls: new Set(), matched: new Set(), unmatched: new Set()};
      turns.set(event.turnId, turn);
    }
    turn.ordinals.add(turnOrdinal(html));
    turn.snapshotEvents++;
    turn.imageTags += references.length;
    for (const url of references) {
      if (!url) {missingSrcOccurrences++;continue;}
      urls.add(url);
      turn.urls.add(url);
      const body = archivedImages.get(url);
      if (body) {
        matchedBodies.add(body.sha256);
        turn.matched.add(url);
      } else {
        unmatched.add(url);
        turn.unmatched.add(url);
      }
    }
  }
  const matches = [...urls].filter(url => archivedImages.has(url));
  const matchedPngBodies = new Set(matches.filter(url =>
    archivedImages.get(url).mime === 'image/png').map(url => archivedImages.get(url).sha256));
  const byTurn = [...turns.values()].map(turn => ({
    ordinal: turn.ordinals.size === 1 ? [...turn.ordinals][0] : null,
    imageBearingSnapshotEvents: turn.snapshotEvents,
    imageTagOccurrences: turn.imageTags,
    distinctImageReferences: turn.urls.size,
    matchedSavedReferences: turn.matched.size,
    unmatchedReferences: turn.unmatched.size,
    unmatchedEvidence: unmatchedEvidence(turn.unmatched, archivedImages, redirects),
    samePathCandidateEvidence: samePathCandidateEvidence(turn.unmatched, savedImages)
  }));
  byTurn.sort((a, b) => (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity));
  return {
    imageBearingSnapshotEvents, imageBearingDistinctTurns: turns.size,
    imageTagOccurrences, distinctImageReferences: urls.size,
    matchedSavedReferences: matches.length, unmatchedReferences: unmatched.size,
    unmatchedEvidence: unmatchedEvidence(unmatched, archivedImages, redirects),
    samePathCandidateEvidence: samePathCandidateEvidence(unmatched, savedImages),
    missingOrInvalidSrcOccurrences: missingSrcOccurrences,
    distinctMatchedImageBodies: matchedBodies.size,
    distinctMatchedPngBodies: matchedPngBodies.size,
    turns: byTurn
  };
}


function sameOriginPath(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    return ['https:', 'http:'].includes(x.protocol) &&
      ['https:', 'http:'].includes(y.protocol) &&
      x.origin === y.origin && x.pathname === y.pathname;
  } catch {return false;}
}

// Same-session URL observation, not a response-byte or message-role claim.
// Keep all original signed URLs in private JSONL; return counts and ordinals.
export function inspectSameSessionImageUrls(probeDir) {
  const dir = path.resolve(probeDir);
  const events = jsonl(path.join(dir, 'events.jsonl'));
  const responses = events.filter(e => e.kind === 'network.image-response');
  if (!responses.length)
    throw Error('No same-session image network responses: check --compare-image-urls and page hydration');
  const perSession = new Map();
  const mimeCounts = {}, originCounts = {};
  for (const row of responses) {
    const session = row.sessionId || '';
    if (!perSession.has(session)) perSession.set(session, []);
    perSession.get(session).push({
      initialUrl: row.initialUrl && canonicalImageUrl(row.initialUrl),
      requestUrl: row.requestUrl && canonicalImageUrl(row.requestUrl),
      responseUrl: row.responseUrl && canonicalImageUrl(row.responseUrl)
    });
    counted(mimeCounts, String(row.mimeType || 'unknown'));
    counted(originCounts, originClass(row.responseUrl || row.requestUrl || ''));
  }
  function match(url, session) {
    if (!url) return 'missing';
    const normalized = canonicalImageUrl(url);
    if (!normalized) return 'invalid';
    const protocol = new URL(normalized).protocol;
    if (protocol === 'data:' || protocol === 'blob:') return 'inline-or-blob';
    const rows = perSession.get(session || '') || [];
    if (rows.some(r => r.initialUrl === normalized || r.requestUrl === normalized))
      return 'exact-request';
    if (rows.some(r => r.responseUrl === normalized)) return 'exact-response';
    if (rows.some(r => [r.initialUrl, r.requestUrl, r.responseUrl]
      .some(x => x && sameOriginPath(x, normalized))))
      return 'same-origin-path-different-query';
    return 'no-same-session-response';
  }
  const turns = new Map();
  let framesWithImages = 0, framesWithoutSelections = 0;
  for (const event of events.filter(e =>
    (e.kind === 'turn.snapshot' || e.kind === 'turn.unidentified-snapshot') && e.file)) {
    const html = snapshotBytes(dir, event);
    const fallback = imageReferences(html);
    if (!fallback.length) continue;
    framesWithImages++;
    if (!Array.isArray(event.imageSelections)) {
      framesWithoutSelections++;
      continue;
    }
    const ordinal = turnOrdinal(html);
    if (ordinal === null) continue;
    let turn = turns.get(event.turnId);
    if (!turn) {
      turn = {ordinal, session: event.sessionId || '', selections: new Map()};
      turns.set(event.turnId, turn);
    }
    if (turn.ordinal !== ordinal || turn.session !== (event.sessionId || ''))
      throw Error('Inconsistent image-turn ordinal or CDP session');
    for (const item of event.imageSelections) {
      const src = typeof item.src === 'string' ? canonicalImageUrl(item.src) : null;
      const currentSrc = typeof item.currentSrc === 'string' ?
        canonicalImageUrl(item.currentSrc) : null;
      if (!src && !currentSrc) continue;
      const k = JSON.stringify([src,currentSrc]);
      turn.selections.set(k,{src,currentSrc});
    }
  }
  if (framesWithoutSelections)
    throw Error('Image snapshots missing currentSrc metadata; rerun with --compare-image-urls');
  const srcClasses = {}, currentSrcClasses = {};
  let selectedUrlDiffersFromSrc = 0, distinctSelections = 0;
  const perTurn = [];
  for (const turn of [...turns.values()].sort((a,b)=>a.ordinal-b.ordinal)) {
    const turnSrc = {}, turnCurrent = {};
    let changed = 0;
    for (const {src,currentSrc} of turn.selections.values()) {
      distinctSelections++;
      if (currentSrc && src && currentSrc !== src) {
        selectedUrlDiffersFromSrc++;
        changed++;
      }
      const srcClass = match(src,turn.session);
      const currentClass = match(currentSrc,turn.session);
      counted(srcClasses, srcClass);
      counted(currentSrcClasses, currentClass);
      counted(turnSrc,srcClass);
      counted(turnCurrent,currentClass);
    }
    perTurn.push({ordinal:turn.ordinal,distinctImageSelections:turn.selections.size,
      srcCurrentSrcDifferences:changed,srcEvidence:turnSrc,
      currentSrcEvidence:turnCurrent});
  }
  return {
    status:'same-session-image-url-diagnostic-only',
    network:{imageResponseEvents:responses.length,mimeTypes:mimeCounts,originClasses:originCounts},
    probe:{imageBearingFrames:framesWithImages,imageBearingTurns:turns.size,
      distinctImageSelections:distinctSelections,srcCurrentSrcDifferences:selectedUrlDiffersFromSrc},
    sourceUrlEvidence:srcClasses,
    browserSelectedUrlEvidence:currentSrcClasses,
    turns:perTurn,
    limitations:[
      'Network response URLs and browser-selected currentSrc are observed in the same Chromium CDP session',
      'Exact request/response URL equality does not verify saved body bytes or downloaded resources',
      'Image requests with no response and images selected outside observed frames are not covered',
      'A srcset-selected currentSrc may differ from literal DOM src without a CDN anomaly',
      'Query-similar paths never establish response-byte identity',
      'All signed URLs and turn/message IDs are retained privately, never included in this summary'
    ]
  };
}

export function inspectImages(cumulativeDir, resourcesDir, probeDir) {
  const cumulative = path.resolve(cumulativeDir);
  const resources = path.resolve(resourcesDir);
  const probe = path.resolve(probeDir);
  const rawAudit = audit(cumulative, resources);
  const rows = jsonl(path.join(resources, 'resources.jsonl'));
  const events = jsonl(path.join(probe, 'events.jsonl'));
  const imageRecords = [], archivedImages = new Map(), savedImages = [];
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
    const resourceUrl = canonicalImageUrl(row.url || '');
    if (resourceUrl) {
      archivedImages.set(resourceUrl, {sha256:row.sha256, mime});
      if (['https:', 'http:'].includes(new URL(resourceUrl).protocol))
        savedImages.push({url:resourceUrl,sha256:row.sha256,mime});
    }
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
  const redirects = redirectBodies(rows);
  const identifiedLinkage = correlateSnapshotImages(snapshots, probe, archivedImages, redirects, savedImages);
  const unidentifiedLinkage = correlateSnapshotImages(unidentified, probe, archivedImages, redirects, savedImages);
  const capturedOrdinals = new Set(JSON.parse(fs.readFileSync(
    path.join(cumulative, 'audit.json'), 'utf8')).turns.map(turn => turn.ordinal));
  const imageOrdinalsAbsentFromCumulative = [...new Set(unidentifiedLinkage.turns
    .filter(turn => turn.ordinal !== null && !capturedOrdinals.has(turn.ordinal))
    .map(turn => turn.ordinal))].sort((a, b) => a - b);
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
    linkage: {
      method: 'exact URL matches plus separate CDP-request redirect and URL-shape evidence',
      identified: identifiedLinkage,
      unidentified: unidentifiedLinkage,
      imageOrdinalsAbsentFromCumulative,
      note: 'Repeated snapshot img tags are not distinct image assets or proof of assistant ownership'
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
      'Snapshots represent observed frames only; source content and URLs are not emitted',
      'Exact and same-request redirect links do not establish RAW assistant-message ownership or displayed decoding',
      'Matching hosts/paths without an identical URL or proven CDP redirect do not identify saved image bytes',
      'One same-path saved image-body candidate is provisional only: changed query parameters may transform or authorize different content'
    ]
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [first, second, third] = process.argv.slice(2);
  const singleSession = first === '--same-session';
  if (singleSession ? (!second || third || process.argv.length !== 4) :
      (!first || !second || !third || process.argv.length !== 5)) {
    console.error('Usage: node inspect-image-capture.mjs <cumulative-dir> <web-analyze-dir> <render-probe-dir> | --same-session <render-probe-dir>');
    process.exitCode = 2;
  } else {
    try {
      const report = singleSession ? inspectSameSessionImageUrls(second) :
        inspectImages(first,second,third);
      console.log(JSON.stringify(report, null, 2));
    } catch (e) {console.error(e.message); process.exitCode = 1;}
  }
}
