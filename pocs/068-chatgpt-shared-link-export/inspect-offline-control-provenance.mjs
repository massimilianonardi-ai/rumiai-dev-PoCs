'use strict';
// Offline-only provenance triage. Never prints a private URL, message body,
// message identifier, CSS declaration, image hash or capture file path.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {inspectOfflineLinkControls} from './inspect-offline-link-controls.mjs';

const fileName=/^images\/([a-f0-9]{64})\.(png|jpg|webp|gif)$/;
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const normalize=value=>String(value||'').normalize('NFKC')
  .replace(/\s+/g,' ').trim().toLowerCase();
function absoluteHttps(value)
{
  if(typeof value!=='string')return null;
  try{
    const url=new URL(value.replace(/&amp;/g,'&'));
    if(url.protocol==='https:'&&!url.username&&!url.password){
      url.hash='';
      return url.href;
    }
  }catch{}
  return null;
}
export function captureImageIndex(captureDirs)
{
  const byUrl=new Map(),filesByDigest=new Map(),conflictingUrls=new Set();
  let verifiedBodies=0,conflicts=0;
  for(const dir of captureDirs)
  {
    const root=path.resolve(dir);
    const lines=fs.readFileSync(path.join(root,'events.jsonl'),'utf8')
      .split(/\r?\n/).filter(Boolean);
    const responses=new Map(),bodies=new Map();
    for(const line of lines)
    {
      const event=JSON.parse(line);
      if(event.kind!=='network.image-response' &&
         event.kind!=='network.image-body')continue;
      const key=JSON.stringify([event.sessionId,event.requestId]);
      if(event.kind==='network.image-response')
      {
        if(!responses.has(key))responses.set(key,[]);
        responses.get(key).push(event);
      }
      else if(event.status==='saved')
      {
        if(!bodies.has(key))bodies.set(key,[]);
        bodies.get(key).push(event);
      }
    }
    for(const [key,rows] of bodies)
    {
      const res=responses.get(key)||[];
      if(rows.length!==1||res.length!==1){conflicts++;continue;}
      const body=rows[0],response=res[0];
      const match=fileName.exec(body.file||'');
      if(!match || body.sha256!==match[1] ||
         !Number.isSafeInteger(body.bytes)||body.bytes<12||
         body.bytes>12*1024*1024){conflicts++;continue;}
      const name=path.join(root,body.file);
      let data;
      try{
        if(!fs.lstatSync(name).isFile()){conflicts++;continue;}
        data=fs.readFileSync(name);
      }catch{conflicts++;continue;}
      if(data.length!==body.bytes||sha(data)!==body.sha256){
        conflicts++;continue;
      }
      verifiedBodies++;
      const previousFile=filesByDigest.get(body.sha256);
      if(previousFile && (previousFile.extension!==match[2] ||
          previousFile.mimeType!==body.mimeType)){
        conflicts++;
        continue;
      }
      if(!previousFile)filesByDigest.set(body.sha256,{
        file:name,extension:match[2],mimeType:body.mimeType});
      const urls=new Set([response.initialUrl,response.requestUrl,
        response.responseUrl].map(absoluteHttps).filter(Boolean));
      for(const url of urls){
        if(conflictingUrls.has(url))continue;
        const previous=byUrl.get(url);
        if(previous&&previous!==body.sha256){
          byUrl.delete(url);
          conflictingUrls.add(url);
          conflicts++;
        }
        else if(!previous)byUrl.set(url,body.sha256);
      }
    }
  }
  return {byUrl,filesByDigest,conflictingUrls,verifiedBodies,conflicts};
}
const sourceKind=element=>{
  if(element.localName==='details')return 'native-details';
  if(element.localName==='a')return element.hasAttribute('href')?'anchor':'anchor-no-href';
  if(element.localName==='button')return 'button';
  if(element.localName==='span')return 'span';
  return 'other';
};
function turnOrdinal(node)
{
  const turn=node.closest('[data-turn-id-container]');
  const tag=turn?.querySelector('[data-testid^="conversation-turn-"]')||
    (turn?.matches('[data-testid^="conversation-turn-"]')?turn:null);
  const match=/^conversation-turn-(\d+)$/.exec(
    tag?.getAttribute('data-testid')||'');
  return match?Number(match[1]):null;
}
function structuralControl(node)
{
  const closest=node.closest('[aria-haspopup]');
  const wrapper=node.closest('a,button,[role="button"]');
  return {
    ordinal:turnOrdinal(node),
    kind:sourceKind(node),
    owner:closest?sourceKind(closest):'none',
    clickableAncestor:wrapper?sourceKind(wrapper):'none',
    ariaControls:!!node.getAttribute('aria-controls'),
    ariaHaspopup:!!node.getAttribute('aria-haspopup'),
    hasHref:!!node.getAttribute('href'),
    hasImage:!!node.querySelector('img'),
    hasSvgUse:!!node.querySelector('svg use'),
    nativeDetails:!!node.closest('details'),
    disabled:node.hasAttribute('disabled')
  };
}
export function inspectOfflineControlProvenance(outputDir,captureDirs=[])
{
  if(!Array.isArray(captureDirs))throw Error('Invalid capture directories');
  const original=inspectOfflineLinkControls(outputDir);
  const html=fs.readFileSync(path.join(path.resolve(outputDir),'index.html'),'utf8');
  const {document}=parseHTML(html);
  const sourceButtons=[],singletonControls=[];
  const all=[...document.querySelectorAll(
    'button,[aria-haspopup],a[href],span[aria-haspopup]')];
  const seen=new Set();
  for(const node of all)
  {
    if(seen.has(node)){continue;}
    seen.add(node);
    if(node.closest('details.poc068-source-details'))continue;
    const label=normalize((node.getAttribute('aria-label')||'')+' '+
      node.textContent);
    if(node.localName==='button' &&
       /(?:^|[^a-z])(fonti|sources)(?:[^a-z]|$)/.test(label))
      sourceButtons.push(structuralControl(node));
    const pill=[...node.querySelectorAll('span')].some(child=>
      !child.children.length&&/^\+\d+$/.test(child.textContent.trim()));
    if(node.hasAttribute('aria-haspopup') && !pill &&
       !/(?:^|[^a-z])(fonti|sources)(?:[^a-z]|$)/.test(label))
      singletonControls.push(structuralControl(node));
  }
  const remoteImageNodes=[...document.querySelectorAll('img')].filter(img=>
    !!absoluteHttps(img.getAttribute('src')));
  const imageIndex=captureDirs.length?captureImageIndex(captureDirs):null;
  const remotelyReferenced=remoteImageNodes.map(img=>{
    const url=absoluteHttps(img.getAttribute('src'));
    return {ordinal:turnOrdinal(img),url,
      withinSources:!!img.closest('.poc068-source-links'),
      withinCitation:!!img.closest('[aria-haspopup]'),
      localizable:!!imageIndex?.byUrl.has(url)};
  });
  const byOrdinal=new Map();
  for(const row of remotelyReferenced)
  {
    const key=row.ordinal??-1;
    if(!byOrdinal.has(key))byOrdinal.set(key,{
      ordinal:row.ordinal,remote:0,exactSavedBody:0,withinCitation:0});
    const item=byOrdinal.get(key);
    item.remote++;
    if(row.localizable)item.exactSavedBody++;
    if(row.withinCitation)item.withinCitation++;
  }
  return {
    status:'private-safe-offline-control-provenance',
    nativeSourceGroups:original.sourceDetails,
    verifiedSourceLinkElements:original.sourceLinks,
    linksWithoutInlineIcons:original.linksMissingIcons,
    standaloneSources:sourceButtons.slice(0,32),
    singletonTriggerCandidates:singletonControls.slice(0,32),
    remoteImageCount:remoteImageNodes.length,
    remoteImagesWithExactSavedBody:remotelyReferenced.filter(row=>
      row.localizable).length,
    remoteImagesMissingSavedBody:remotelyReferenced.filter(row=>
      !row.localizable).length,
    imageCountsByTurn:[...byOrdinal.values()].sort((a,b)=>
      (a.ordinal??-1)-(b.ordinal??-1)),
    verifiedImageBodies:imageIndex?.verifiedBodies??null,
    imageEvidenceConflicts:imageIndex?.conflicts??null,
    svgUseAbsoluteCount:original.svgUseReferences.absolute||0,
    scriptBlocked:original.hasScriptBlocking,
    limitations:[
      'Source link icon absence is structural: no favicon elements were generated inside anchors',
      'Single-citation candidates need actual target provenance before conversion to hyperlinks',
      'Fonti controls must not be mapped to +N pill links without source ownership evidence',
      'Image matches require exact HTTPS URL and SHA-verified archived bytes; this report makes no substitutions',
      'The report contains no URL, message text, source filename or private binary hash'
    ]
  };
}
if(process.argv[1] && path.resolve(process.argv[1])===
  path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length<3){
    console.error('Usage: node inspect-offline-control-provenance.mjs <linked-output-dir> [private-capture-dir...]');
    process.exitCode=2;
  }else{
    try{
      console.log(JSON.stringify(inspectOfflineControlProvenance(
        process.argv[2],process.argv.slice(3)),null,2));
    }catch{
      console.error('Offline citation provenance inspection failed');
      process.exitCode=1;
    }
  }
}
