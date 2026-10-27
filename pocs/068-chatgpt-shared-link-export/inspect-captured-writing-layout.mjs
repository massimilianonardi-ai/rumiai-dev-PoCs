'use strict';
// Private-safe structural analysis of writing editors in the original capture.
// This is not a computed-style comparison: CSS cascade/layout requires Chromium.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';

const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const snapshot=/^turns\/([a-f0-9]{64})\.html$/;
const reportedProps=['padding','padding-left','padding-right','padding-top',
  'padding-bottom','padding-inline','padding-inline-start','padding-inline-end',
  'padding-block','padding-block-start','padding-block-end','box-sizing',
  '--writing-block-editor-pl','--writing-block-editor-pr',
  '--writing-block-editor-pt','--writing-block-editor-pb'];
function styleKeys(node)
{
  const style=node.getAttribute('style')||'';
  return [...new Set(style.split(';').map(decl=>decl.slice(0,decl.indexOf(':')).trim())
    .filter(k=>reportedProps.includes(k)))];
}
function describe(node)
{
  return {
    tag:node.localName,
    dataComponent:node.getAttribute('data-d-component')||null,
    styleKeys:styleKeys(node),
    hasStyle:node.hasAttribute('style'),
    styleAttributePresent:node.hasAttribute('class'),
    directChildren:node.children.length,
    parentIsTurn:node.parentElement?.hasAttribute('data-turn-id-container')||false
  };
}
export function inspectCapturedWritingLayout(capture)
{
  const events=fs.readFileSync(path.join(capture,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(row=>JSON.parse(row));
  const latest=new Map();
  for(const event of events)
  {
    if(event.kind!=='turn.snapshot')continue;
    const match=snapshot.exec(event.file||'');
    if(!match || match[1]!==event.sha256)throw Error('Invalid snapshot reference');
    const bytes=fs.readFileSync(path.join(capture,event.file));
    if(bytes.length!==event.bytes || hash(bytes)!==event.sha256)
      throw Error('Snapshot integrity mismatch');
    const {document}=parseHTML(bytes.toString('utf8'));
    const root=document.querySelector('[data-turn-id-container]');
    const marker=root?.querySelector('[data-testid^="conversation-turn-"]') ||
      (root?.matches('[data-testid^="conversation-turn-"]')?root:null);
    const ordinal=Number(/^conversation-turn-(\d+)$/.exec(
      marker?.getAttribute('data-testid')||'')?.[1]);
    if(!Number.isSafeInteger(ordinal))continue;
    if(!latest.has(ordinal) || latest.get(ordinal).sequence<event.sequence)
      latest.set(ordinal,{sequence:event.sequence,root});
  }
  const entries=[];
  for(const [ordinal,{root}] of [...latest].sort(([a],[b])=>a-b))
  {
    const candidates=[...root.querySelectorAll('[style]')]
      .filter(node=>node.getAttribute('style').includes('--writing-block-editor-pl'));
    for(const node of candidates.slice(0,8))
    {
      const ancestors=[];
      for(let element=node; element && ancestors.length<7;
          element=element.parentElement)
        ancestors.push(describe(element));
      entries.push({ordinal,ancestry:ancestors});
    }
  }
  return {status:'private-safe-writing-layout',selectedTurns:latest.size,
    candidateCount:entries.length,editors:entries,
    limitations:['Only captured inline declarations and DOM ancestry are reported',
      'Computed values, source CSS cascade/order and original outer app ancestry are unavailable',
      'No CSS declaration values, URLs, text or identifiers are printed']};
}
if(process.argv[1] && path.resolve(process.argv[1])===
    path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3)
  {
    console.error('Usage: node inspect-captured-writing-layout.mjs <capture-dir>');
    process.exitCode=2;
  }
  else
  {
    try{console.log(JSON.stringify(inspectCapturedWritingLayout(
      path.resolve(process.argv[2])),null,2));}
    catch{console.error('Unable to inspect private layout capture');process.exitCode=1;}
  }
}
