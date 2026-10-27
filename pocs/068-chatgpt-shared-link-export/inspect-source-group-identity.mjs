'use strict';
// Strict, private-safe cross-capture identity audit of source-pill ordering.
// No URLs, message IDs, message text or context digests are ever printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {collectTrustedSourceEvidence} from './inspect-trusted-source-evidence.mjs';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const reference=/^turns\/([a-f0-9]{64})\.html$/;
const ordinalPattern=/^conversation-turn-(\d+)$/;
const normalized=value=>String(value||'').normalize('NFKC')
  .replace(/\s+/g,' ').trim().toLowerCase();

export function sourceGroupSignatures(html)
{
  const {document}=parseHTML(html);
  const root=document.querySelector('[data-turn-id-container]');
  if(!root)return [];
  const pills=[...root.querySelectorAll('span')].filter(node=>
    !node.children.length && /^\+\d+$/.test((node.textContent||'').trim()));
  const positions=new Map();
  let text='';
  function walk(node)
  {
    if(node.nodeType===3){
      text+=node.nodeValue||'';
      return;
    }
    if(node.nodeType!==1 && node.nodeType!==9)return;
    if(node.localName==='svg' || node.localName==='script' ||
       node.localName==='style')return;
    if(pills.includes(node))positions.set(node,text.length);
    for(const child of node.childNodes||[])walk(child);
  }
  walk(root);
  return pills.map((pill,index)=>{
    const pos=positions.get(pill);
    if(!Number.isSafeInteger(pos))throw Error('Source pill not reached in DOM walk');
    const before=normalized(text.slice(Math.max(0,pos-250),pos)).slice(-150);
    const after=normalized(text.slice(pos+pill.textContent.length,
      pos+pill.textContent.length+250)).slice(0,150);
    const context=before+'|'+after;
    return {index,count:Number(pill.textContent.trim().slice(1))+1,
      fingerprint:digest(Buffer.from(JSON.stringify([pill.textContent.trim(),
        before,after]))),contextChars:before.length+after.length};
  });
}
export function captureSignatures(capture)
{
  const root=path.resolve(capture);
  const filename=path.join(root,'events.jsonl');
  const events=fs.readFileSync(filename,'utf8').split(/\r?\n/)
    .filter(Boolean).map(JSON.parse);
  const found=new Map();
  for(const event of events)
  {
    if(event.kind!=='turn.snapshot')continue;
    const m=reference.exec(event.file||'');
    if(!m || m[1]!==event.sha256 ||
       !Number.isSafeInteger(event.bytes)||event.bytes<=0||
       event.bytes>4*1024*1024)
      throw Error('Invalid DOM snapshot event');
    const bytes=fs.readFileSync(path.join(root,event.file));
    if(bytes.length!==event.bytes||digest(bytes)!==event.sha256)
      throw Error('DOM snapshot integrity failure');
    const html=bytes.toString('utf8');
    const {document}=parseHTML(html);
    const turn=document.querySelector('[data-turn-id-container]');
    const marker=turn?.querySelector('[data-testid^="conversation-turn-"]') ||
      (turn?.matches('[data-testid^="conversation-turn-"]')?turn:null);
    const match=ordinalPattern.exec(marker?.getAttribute('data-testid')||'');
    if(!match)continue;
    const ordinal=Number(match[1]);
    if(!Number.isSafeInteger(ordinal) ||
       typeof event.turnId!=='string'||!Array.isArray(event.messageIds))
      throw Error('Invalid snapshot turn identity');
    const pills=sourceGroupSignatures(html);
    if(!pills.length)continue;
    const candidate={ordinal,pills,
      turnKey:digest(Buffer.from(JSON.stringify([event.turnId,
        [...event.messageIds].sort()]))),
      sequence:event.sequence,textSize:normalized(turn.textContent).length};
    const previous=found.get(ordinal);
    if(!previous ||
       candidate.pills.length>previous.pills.length ||
       (candidate.pills.length===previous.pills.length &&
        (candidate.textSize>previous.textSize ||
          (candidate.textSize===previous.textSize &&
           candidate.sequence>previous.sequence))))
      found.set(ordinal,candidate);
  }
  return found;
}
export function auditSourceGroupIdentity(captures,evidenceCaptures=captures)
{
  if(!Array.isArray(captures)||captures.length<2)
    throw Error('At least two separate private captures are required');
  if(!Array.isArray(evidenceCaptures)||!evidenceCaptures.length ||
    evidenceCaptures.some(capture=>
      !captures.some(sample=>path.resolve(sample)===path.resolve(capture))))
    throw Error('Source evidence captures must belong to the identity capture set');
  // Older original-CSS capture sessions can provide valid DOM snapshots but
  // predate expectedSources source-hover events. Verify message identity from
  // all captures, while requiring source count and link evidence only from
  // the explicit validated navigation-observation capture set.
  const evidence=collectTrustedSourceEvidence(evidenceCaptures);
  const sourceSets=captures.map(captureSignatures);
  const groups=evidence.groups.map(group=>{
    const seen=[];
    for(const sample of sourceSets)
    {
      const turn=sample.get(group.ordinal);
      if(!turn)continue;
      const pill=turn.pills[group.index];
      if(!pill)continue;
      if(pill.count!==group.expectedSources)
        return {ordinal:group.ordinal,index:group.index,
          status:'count-mismatch',capturesObserved:seen.length+1};
      const colliding=turn.pills.some(other=>other.index!==group.index &&
        other.fingerprint===pill.fingerprint);
      if(colliding || pill.contextChars<24)
        return {ordinal:group.ordinal,index:group.index,
          status:'weak-context',capturesObserved:seen.length+1};
      seen.push({turnKey:turn.turnKey,fingerprint:pill.fingerprint});
    }
    const stable=seen.length>=2 &&
      seen.every(s=>s.turnKey===seen[0].turnKey &&
        s.fingerprint===seen[0].fingerprint);
    return {ordinal:group.ordinal,index:group.index,
      status:seen.length<2?'insufficient':
        stable?'stable':'context-mismatch',
      capturesObserved:seen.length};
  });
  return {status:'private-safe-source-group-identity',
    expectedGroups:groups.length,
    completeUrlGroups:evidence.groups.filter(g=>g.complete).length,
    stableGroups:groups.filter(g=>g.status==='stable').length,
    safeToRestore:groups.length>0 &&
      groups.every(g=>g.status==='stable') &&
      evidence.groups.every(g=>g.complete),
    groups,limitations:[
      'Stable DOM context and message identity are necessary but not proof of original link display fidelity',
      'No URL, source text, message identity, raw fingerprint or capture pathname is printed',
      'Source cards must still be restored in an offline rendering and inspected in Chromium'
    ]};
}
if(process.argv[1] && path.resolve(process.argv[1])===
  path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length<4){
    console.error('Usage: node inspect-source-group-identity.mjs <capture1> <capture2> [more captures...]');
    process.exitCode=2;
  }else{
    try{
      console.log(JSON.stringify(auditSourceGroupIdentity(
        process.argv.slice(2)),null,2));
    }catch{
      console.error('Cannot verify source group identity');
      process.exitCode=1;
    }
  }
}
