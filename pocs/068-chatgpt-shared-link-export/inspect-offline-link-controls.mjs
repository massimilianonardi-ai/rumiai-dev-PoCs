'use strict';
// Read-only, privacy-safe diagnosis of original-citation controls, source
// controls and icon dependencies in a generated local HTML archive.
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';

function normalized(value)
{
  return String(value||'').normalize('NFKC').replace(/\s+/g,' ')
    .trim().toLowerCase();
}
function referenceKind(reference,archiveDir)
{
  if(!reference)return 'missing';
  if(/^\s*data:/i.test(reference))return 'data';
  if(/^\s*blob:/i.test(reference))return 'blob';
  if(/^\s*https?:/i.test(reference))return 'remote';
  if(/^\s*javascript:/i.test(reference))return 'unsafe';
  if(/^\s*#/i.test(reference))return 'fragment';
  if(/^\s*\/\//.test(reference))return 'remote';
  if(reference.startsWith('/'))return 'absolute';
  const name=String(reference).split(/[?#]/)[0];
  const file=path.resolve(archiveDir,name);
  if(file!==path.resolve(archiveDir) &&
     !file.startsWith(path.resolve(archiveDir)+path.sep))
    return 'outside';
  try{return fs.statSync(file).isFile()?'local':'local-missing';}
  catch{return 'local-missing';}
}
function tally(entries)
{
  const result={};
  for(const entry of entries)result[entry]=(result[entry]||0)+1;
  return result;
}
function turnOrdinal(node)
{
  const turn=node.closest?.('[data-turn-id-container]');
  const marker=turn?.querySelector('[data-testid^="conversation-turn-"]') ||
    (turn?.matches('[data-testid^="conversation-turn-"]')?turn:null);
  const match=/^conversation-turn-(\d+)$/.exec(
    marker?.getAttribute('data-testid')||'');
  return match?Number(match[1]):null;
}
function controlKind(element)
{
  const label=normalized(
    (element.getAttribute('aria-label')||'')+' '+
      (element.textContent||''));
  const aloneSource=/(^|\W)(fonti|sources|riferimenti|references)(\W|$)/i
    .test(label);
  const leafBadges=[...element.querySelectorAll('span')].filter(span=>
    !span.children.length && /^\+\d+$/.test(
      (span.textContent||'').trim()));
  const isSingleCitation=element.getAttribute('aria-haspopup') &&
    !leafBadges.length &&
    !aloneSource;
  return {aloneSource,hasPlusBadge:leafBadges.length>0,
    isSingleCitation:!!isSingleCitation};
}
function addResult(map,key)
{
  map[key]=(map[key]||0)+1;
}
export function inspectOfflineLinkControls(directory)
{
  const archiveDir=path.resolve(directory);
  const html=fs.readFileSync(path.join(archiveDir,'index.html'),'utf8');
  const {document}=parseHTML(html);
  const csp=document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute('content')||'';
  const details=[...document.querySelectorAll('details.poc068-source-details')];
  const linkLists=details.map(node=>({
    ordinal:Number(node.getAttribute('data-poc068-ordinal')),
    index:Number(node.getAttribute('data-poc068-index')),
    anchorCount:node.querySelectorAll('.poc068-source-links a[href]').length,
    summaryPresent:[...node.children].some(child=>child.localName==='summary'),
    nestedInteractive:!!node.querySelector(
      'summary a,summary button,summary input,summary details'),
    nativeOpen:node.hasAttribute('open'),
    iconElements:node.querySelectorAll('summary svg,summary img,summary use').length
  }));
  const nativeSourceLinks=[...document.querySelectorAll(
    '.poc068-source-links a[href]')];
  const allClickables=[...document.querySelectorAll(
    'a,button,summary,[role="button"],[aria-haspopup]')];
  const autonomic=[];
  const inactive=[];
  const emptyAnchors=[];
  const singleCitation=[];
  for(const node of allClickables)
  {
    if(node.closest('details.poc068-source-details')||
       node.closest('.poc068-source-links'))continue;
    // Deduplicate nodes selected by more than one of the above selectors.
    const {aloneSource,hasPlusBadge,isSingleCitation}=controlKind(node);
    const tag=node.localName||'other';
    const hasHref=!!node.getAttribute('href');
    const item={ordinal:turnOrdinal(node),tag,
      href:hasHref?referenceKind(node.getAttribute('href'),archiveDir):'missing',
      ariaExpanded:node.hasAttribute('aria-expanded'),
      ariaHaspopup:node.hasAttribute('aria-haspopup'),
      disabled:node.hasAttribute('disabled'),
      plusBadge:hasPlusBadge};
    if(aloneSource && (tag==='button'||tag==='summary'||hasHref||
       node.getAttribute('role')==='button'||
       node.hasAttribute('aria-haspopup')))
      autonomic.push(item);
    if(isSingleCitation && (tag==='button'||tag==='a'||
       node.getAttribute('role')==='button'))
      singleCitation.push(item);
    if((tag==='button'||node.getAttribute('role')==='button') &&
       !hasHref && !node.hasAttribute('disabled'))
      inactive.push(item);
    if(tag==='a'&&!hasHref)emptyAnchors.push(item);
  }
  const images=[...document.querySelectorAll('img')];
  const imageResources=images.map(node=>referenceKind(
    node.getAttribute('src')||node.getAttribute('data-src'),archiveDir));
  const imageReferencesInSourceMenus=[
    ...document.querySelectorAll('.poc068-source-links img')
  ].map(node=>referenceKind(node.getAttribute('src'),archiveDir));
  const svgUse=[...document.querySelectorAll('use')].map(node=>
    referenceKind(node.getAttribute('href')||
      node.getAttribute('xlink:href'),archiveDir));
  const css=[...document.querySelectorAll('style')].map(x=>x.textContent||'')
    .join('\n');
  const cssUrls=[...css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)]
    .map(match=>referenceKind(match[2],archiveDir));
  const scrubbed=items=>items.slice(0,40);
  return {
    status:'private-safe-offline-controls',
    hasScriptBlocking:csp.includes("script-src 'none'"),
    imageSelfAllowed:/img-src[^;]*'self'/.test(csp),
    sourceDetails:details.length,
    sourceLinks:nativeSourceLinks.length,
    sourceDetailsInventory:linkLists.slice(0,30),
    linksMissingIcons:details.reduce((n,node)=>
      n+[...node.querySelectorAll('.poc068-source-links a')]
        .filter(a=>!a.querySelector('img,svg,use')).length,0),
    standaloneSourcesCount:autonomic.length,
    standaloneSources:scrubbed(autonomic),
    singleCitationCandidatesCount:singleCitation.length,
    singleCitationCandidates:scrubbed(singleCitation),
    buttonsWithoutHref:inactive.length,
    buttonsWithoutHrefByTurn:tally(inactive.map(x=>String(x.ordinal))),
    anchorsWithoutHref:emptyAnchors.length,
    anchorsWithoutHrefByTurn:tally(emptyAnchors.map(x=>String(x.ordinal))),
    imageReferences:tally(imageResources),
    sourceMenuImageReferences:tally(imageReferencesInSourceMenus),
    svgUseReferences:tally(svgUse),
    cssUrlReferences:tally(cssUrls),
    limitations:[
      'This is a structural static-HTML inventory, not proof of click behavior',
      'A button may be functional through native HTML controls, which must be verified in Chromium',
      'Only source pills with verified +N ownership have been reconstructed',
      'No text, source URLs, message IDs, source filenames or CSS values are printed'
    ]
  };
}
if(process.argv[1] &&
  path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3)
  {
    console.error('Usage: node inspect-offline-link-controls.mjs <private-output-dir>');
    process.exitCode=2;
  }
  else
  {
    try{
      console.log(JSON.stringify(inspectOfflineLinkControls(
        process.argv[2]),null,2));
    }
    catch{
      console.error('Unable to inspect offline controls');
      process.exitCode=1;
    }
  }
}
