'use strict';
// Experimental inert HTML/CSS view from exact same-session CDP evidence.
// All archived text, URLs, original assets and reports remain private.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assemble} from './assemble-rendered-dom.mjs';
import {localize} from './localize-rendered-resources.mjs';
import {restoreUserPreviewControls,previewToggleCss} from './offline-preview-controls.mjs';
import {restoreSourceDisclosures,sourceDisclosureCss} from './offline-source-controls.mjs';
import {collectTrustedSourceEvidence} from './inspect-trusted-source-evidence.mjs';
import {auditSourceGroupIdentity,captureSignatures}
  from './inspect-source-group-identity.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const staticName = /^static\/([a-f0-9]{64})\.(css|woff2)$/;
const imageName = /^images\/([a-f0-9]{64})\.(png|jpg|webp|gif)$/;
const extensions = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif']
]);

function readEvents(capture)
{
  return fs.readFileSync(path.join(capture, 'events.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((line, index) =>
    {
      try {return JSON.parse(line);}
      catch {throw Error('Invalid event at line ' + (index + 1));}
    });
}
function verifiedBytes(capture, event, pattern, maxBytes)
{
  const name = event.file || '';
  const match = pattern.exec(name);
  if (!match || match[1] !== event.sha256 ||
      !Number.isSafeInteger(event.bytes) || event.bytes <= 0 ||
      event.bytes > maxBytes) throw Error('Invalid archived resource reference');
  const filename = path.join(capture, name);
  if (!fs.lstatSync(filename).isFile()) throw Error('Archived resource is not a regular file');
  const bytes = fs.readFileSync(filename);
  if (bytes.length !== event.bytes || sha256(bytes) !== event.sha256)
    throw Error('Archived resource integrity failure');
  return {bytes, extension: match[2]};
}
function absoluteUrl(value)
{
  try
  {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  }
  catch {return null;}
}
function resourceRow(event, url, extension, bytes)
{
  return {status:'saved', url, resourceType:extension === 'css' ? 'Stylesheet' :
    extension === 'woff2' ? 'Font' : 'Image',
    mimeType:extension === 'css' ? 'text/css' :
    extension === 'woff2' ? 'font/woff2' :
    [...extensions].find(([, ext]) => ext === extension)?.[0],
    sha256:event.sha256, bytes:bytes.length,
    file:'resources/' + event.sha256 + '.' + extension};
}

// The old resource localizer consumes resources.jsonl. Adapt only exact CDP
// request/body pairs and hash-verified static bodies to that existing format.
export function materializeSameSessionResources(capture, target)
{
  const events = readEvents(capture);
  const imageResponses = new Map();
  for (const event of events)
  {
    if (event.kind !== 'network.image-response') continue;
    const key = JSON.stringify([event.sessionId, event.requestId]);
    if (!imageResponses.has(key)) imageResponses.set(key, []);
    imageResponses.get(key).push(event);
  }
  const files = new Map(), byUrl = new Map();
  let css = 0, fonts = 0, images = 0;
  function add(event, url, bytes, ext)
  {
    if (!url) return;
    const row = resourceRow(event, url, ext, bytes);
    const previous = byUrl.get(url);
    if (previous && previous.sha256 !== row.sha256)
      throw Error('Ambiguous different resource bodies for one URL');
    if (previous) return;
    byUrl.set(url, row);
    files.set(row.file, bytes);
    if (ext === 'css') css++;
    else if (ext === 'woff2') fonts++;
    else images++;
  }
  for (const event of events)
  {
    if (event.kind === 'network.static-body' && event.status === 'saved')
    {
      const {bytes, extension} = verifiedBytes(capture, event, staticName, 8*1024*1024);
      if ((extension === 'css' && event.mimeType !== 'text/css') ||
          (extension === 'woff2' && (event.mimeType !== 'font/woff2' &&
          event.mimeType !== 'application/octet-stream'))) throw Error('Static MIME mismatch');
      if (extension === 'woff2' && bytes.toString('ascii', 0, 4) !== 'wOF2')
        throw Error('Invalid WOFF2 signature');
      add(event, absoluteUrl(event.originalUrl), bytes, extension);
    }
    if (event.kind === 'network.image-body' && event.status === 'saved')
    {
      const {bytes, extension} = verifiedBytes(capture, event, imageName, 12*1024*1024);
      if (extensions.get(event.mimeType) !== extension) throw Error('Image MIME mismatch');
      const key = JSON.stringify([event.sessionId, event.requestId]);
      const responses = imageResponses.get(key) || [];
      if (responses.length !== 1) throw Error('Image request identity ambiguous');
      const response = responses[0];
      for (const value of [response.initialUrl, response.requestUrl, response.responseUrl])
        add(event, absoluteUrl(value), bytes, extension);
    }
  }
  if (!css) throw Error('No verified original CSS captured');
  fs.mkdirSync(path.join(target, 'resources'), {recursive:true, mode:0o700});
  for (const [name, bytes] of files)
    fs.writeFileSync(path.join(target, name), bytes, {flag:'wx', mode:0o600});
  fs.writeFileSync(path.join(target, 'resources.jsonl'),
    [...byUrl.values()].map(row => JSON.stringify(row)).join('\n') + '\n',
    {flag:'wx', mode:0o600});
  return {css, fonts, images, distinctBodies:files.size};
}

export function renderSameSessionStyled(captureDir, outputDir, evidenceDirs = [])
{
  const capture = path.resolve(captureDir), output = path.resolve(outputDir);
  if(!Array.isArray(evidenceDirs))throw Error('Invalid source evidence argument');
  // Sources remain strictly opt-in and require independent archived identity.
  const sourceEvidence=evidenceDirs.length?
    collectTrustedSourceEvidence(evidenceDirs):null;
  const identity=evidenceDirs.length?
    auditSourceGroupIdentity([...evidenceDirs,capture],evidenceDirs):null;
  if(sourceEvidence && (!identity.safeToRestore ||
     sourceEvidence.groups.length===0 ||
     sourceEvidence.groups.some(group=>!group.complete)))
    throw Error('Source link identity/provenance incomplete; offline links refused');
  const referenceFrames=sourceEvidence?captureSignatures(evidenceDirs[0]):null;
  if (output === capture || output.startsWith(capture + path.sep) ||
      fs.existsSync(output)) throw Error('Output must be new and outside capture');
  if (!fs.existsSync(path.dirname(output))) throw Error('Output parent missing');
  const workspace = fs.mkdtempSync(path.join(path.dirname(output), '.poc068-styled-'));
  try
  {
    const resources = materializeSameSessionResources(capture, path.join(workspace, 'archive'));
    const assembled = path.join(workspace, 'assembled');
    const assembly = assemble(capture, assembled, null, {preferExpandedPreviews:true});
    // The generic evidence viewer disables pointer interactions. Permit links and
    // CSS hover on buttons in this alternative output; scripts remain CSP-blocked.
    const documentFile = path.join(assembled, 'index.html');
    const original = fs.readFileSync(documentFile, 'utf8');
    const neutral = original.replace(
      'table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px}', '');
    if (neutral === original) throw Error('Unexpected assembly table fallback CSS');
    let edited = neutral.replace('button,input,a{pointer-events:none}',
      'input{pointer-events:none}');
    if (neutral === edited) throw Error('Unexpected assembly pointer CSS');
    // Only transform verified isolated user-turn snapshots. Assistant SVG,
    // tables and CSS remain byte-identical to the accepted source frames.
    const audit=JSON.parse(fs.readFileSync(path.join(assembled,'audit.json'),'utf8'));
    let restoredPreviews=0,initiallyExpandedPreviews=0,sourceExpandedPreviews=0;
    let restoredSources=0,sourceLinks=0;
    for(const turn of audit.turns)
    {
      const source=fs.readFileSync(path.join(capture,turn.selected.file),'utf8');
      if(!source.includes('data-can-expand'))continue;
      const changed=restoreUserPreviewControls(source,turn.ordinal);
      if(!changed.converted)continue;
      if(!edited.includes(source))throw Error('Selected user preview not present in assembly');
      edited=edited.replace(source,changed.html);
      restoredPreviews+=changed.converted;
      initiallyExpandedPreviews+=changed.initiallyExpanded;
      sourceExpandedPreviews+=changed.sourceExpanded;
    }
    if(sourceEvidence)
    {
      const byOrdinal=new Map();
      for(const group of sourceEvidence.groups){
        const bucket=byOrdinal.get(group.ordinal)||[];
        bucket.push(group);
        byOrdinal.set(group.ordinal,bucket);
      }
      const observedOrdinals=new Set();
      for(const turn of audit.turns)
      {
        const groups=byOrdinal.get(turn.ordinal);
        if(!groups)continue;
        observedOrdinals.add(turn.ordinal);
        const reference=referenceFrames.get(turn.ordinal)?.pills;
        if(!reference)throw Error('Selected source ordinal absent in identity reference');
        const originalSource=fs.readFileSync(path.join(capture,turn.selected.file),'utf8');
        const restored=restoreSourceDisclosures(
          originalSource,turn.ordinal,groups,reference);
        if(restored.converted!==groups.length)
          throw Error('Incomplete source replacement in selected turn');
        if(!edited.includes(originalSource))
          throw Error('Selected source snapshot missing from rendered assembly');
        edited=edited.replace(originalSource,restored.html);
        restoredSources+=restored.converted;
        sourceLinks+=restored.links;
      }
      if(observedOrdinals.size!==byOrdinal.size ||
         restoredSources!==sourceEvidence.groups.length ||
         sourceLinks!==sourceEvidence.groups.reduce((n,g)=>n+g.expectedSources,0))
        throw Error('Captured styled source turns incomplete: no links written');
    }
    fs.writeFileSync(documentFile, edited, {mode:0o600});
    const stage = path.join(workspace, 'output');
    const localization = localize(assembled, path.join(workspace, 'archive'), stage);
    if(restoredPreviews)
    {
      const file=path.join(stage,'index.html');
      const html=fs.readFileSync(file,'utf8');
      if(!html.includes('</head>'))throw Error('Missing document head');
      fs.writeFileSync(file,html.replace('</head>',
        '<style id="poc068-preview-controls">'+previewToggleCss+'</style></head>'),
        {mode:0o600});
    }
    if(restoredSources)
    {
      const file=path.join(stage,'index.html');
      const html=fs.readFileSync(file,'utf8');
      if(!html.includes('</head>'))throw Error('Missing document head');
      fs.writeFileSync(file,html.replace('</head>',
        '<style id="poc068-source-controls">'+sourceDisclosureCss+'</style></head>'),
        {mode:0o600});
    }
    fs.renameSync(stage, output);
    return {status:'original-css-offline-preview', output,
      capturedTurnCount:assembly.turns, missingOrdinals:assembly.missingOrdinals,
      restoredPreviews,initiallyExpandedPreviews,sourceExpandedPreviews,
      restoredSources,sourceLinks,
      sourceIdentityStableGroups:identity?.stableGroups||0,
      resources, localizedStylesheets:localization.stylesheets,
      unresolvedStaticReferences:localization.unresolved,
      limitations:['Original JavaScript and React state are not replayed',
        'CSS without its original DOM ancestors and theme may render differently',
        'Sources without an exact saved response remain unavailable',
        'Local HTML/CSS preview toggles require physical browser verification',
        'Visual fidelity and RAW completeness require physical checking',
        ...(restoredSources?[
          'Native source disclosures require physical browser/URL matching acceptance'
        ]:[]) ]};
  }
  finally {fs.rmSync(workspace, {recursive:true, force:true});}
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))
{
  const args=process.argv.slice(2);
  const sourcesAt=args.indexOf('--sources');
  const valid=(args.length===2 || (sourcesAt===2 &&
    args.length>=5 && args.filter(arg=>arg==='--sources').length===1));
  if (!valid)
  {
    console.error('Usage: node render-same-session-styled.mjs <capture-dir> <new-output-dir> [--sources <private-evidence-dir> <private-evidence-dir>...]');
    process.exitCode = 2;
  }
  else
  {
    try {console.log(JSON.stringify(renderSameSessionStyled(
      args[0],args[1],sourcesAt===2?args.slice(3):[]), null, 2));}
    catch (error) {console.error(error.message); process.exitCode = 1;}
  }
}
