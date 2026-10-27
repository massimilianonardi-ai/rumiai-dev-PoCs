'use strict';
// Counts-only attribution audit for source-hover links in private capture.
// This does not claim that appearing anchors belong to the hovered popup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';

const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const fileName = /^turns\/([a-f0-9]{64})\.html$/;
const leafCounts = root => [...root.querySelectorAll('span')]
  .filter(node => node.children.length === 0 &&
    /^\+\d+$/.test((node.textContent || '').trim()))
  .map(node => Number((node.textContent || '').trim().slice(1)));

export function inspectSourceHoverAttribution(capture)
{
  const events=fs.readFileSync(path.join(capture,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(row=>JSON.parse(row));
  const latest=new Map();
  for(const e of events)
  {
    if(e.kind!=='turn.snapshot')continue;
    const match=fileName.exec(e.file||'');
    if(!match || match[1]!==e.sha256)throw Error('Invalid snapshot file');
    const bytes=fs.readFileSync(path.join(capture,e.file));
    if(bytes.length!==e.bytes || digest(bytes)!==e.sha256)
      throw Error('Snapshot integrity mismatch');
    const {document}=parseHTML(bytes.toString('utf8'));
    const root=document.querySelector('[data-turn-id-container]');
    const marker=root?.querySelector('[data-testid^="conversation-turn-"]') ||
      (root?.matches('[data-testid^="conversation-turn-"]')?root:null);
    const found=/^conversation-turn-(\d+)$/.exec(
      marker?.getAttribute('data-testid')||'');
    if(!found)continue;
    const ordinal=Number(found[1]);
    if(!Number.isSafeInteger(ordinal))continue;
    if(!latest.has(ordinal) || latest.get(ordinal).sequence<e.sequence)
      latest.set(ordinal,{sequence:e.sequence,counts:leafCounts(root)});
  }
  const groups=[];
  for(const e of events)
  {
    if(e.kind!=='interaction.source-hover')continue;
    const ordinal=e.ordinal,index=e.index;
    const count=latest.get(ordinal)?.counts[index];
    const observed=[...new Set((e.links||[]).filter(url =>
      typeof url==='string' && /^https:\/\//.test(url)))].length;
    const expected=Number.isSafeInteger(count) && count>=1 && count<=100?
      count+1:null;
    groups.push({ordinal,index,expectedLinks:expected,observedLinks:observed,
      countConsistent:expected!==null && expected===observed});
  }
  return {status:'private-safe-source-attribution',groups,
    exactCountMatches:groups.filter(g=>g.countConsistent).length,
    limitations:['Numerical agreement does not prove source-link ownership',
      'Source popup URLs were compared with all new anchors, not a scoped popup',
      'No link values, labels or conversation content are emitted']};
}
if(process.argv[1] && path.resolve(process.argv[1]) ===
  path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3)
  {
    console.error('Usage: node inspect-source-hover-attribution.mjs <capture-dir>');
    process.exitCode=2;
  }
  else
  {
    try{console.log(JSON.stringify(inspectSourceHoverAttribution(
      path.resolve(process.argv[2])),null,2));}
    catch {console.error('Could not inspect archived source associations');process.exitCode=1;}
  }
}
