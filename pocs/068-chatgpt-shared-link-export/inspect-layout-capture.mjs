'use strict';
// Offline structural evidence only. Does not print private text, IDs or URLs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';

const capture=process.argv[2];
if (!capture || process.argv.length!==3) {
  console.error('Usage: node inspect-layout-capture.mjs <private-capture-dir>');
  process.exit(2);
}
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const events=fs.readFileSync(path.join(capture,'events.jsonl'),'utf8')
  .trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const selected=new Map();
for (const e of events) {
  if(e.kind!=='turn.snapshot' || !/^turns\/[a-f0-9]{64}\.html$/.test(e.file||'')) continue;
  const bytes=fs.readFileSync(path.join(capture,e.file));
  if(bytes.length!==e.bytes || hash(bytes)!==e.sha256 ||
      e.file!==`turns/${e.sha256}.html`) throw Error('Snapshot integrity failure');
  const {document}=parseHTML(bytes.toString('utf8'));
  const root=document.querySelector('[data-turn-id-container]');
  if (!root) continue;
  const marker=root.querySelector('[data-testid^="conversation-turn-"]')||
    (root.matches('[data-testid^="conversation-turn-"]')?root:null);
  const ordinal=Number(/conversation-turn-(\d+)/.exec(marker?.getAttribute('data-testid')||'')?.[1]);
  if(!Number.isSafeInteger(ordinal)) continue;
  selected.set(ordinal,{root,sequence:e.sequence});
}
const count=(root,selector)=>root.querySelectorAll(selector).length;
const bucket=node=>{
  const tags=[];
  let current=node;
  for(let i=0;current&&i<4;i++,current=current.parentElement)
    tags.push(current.localName);
  return tags.join('>');
};
const results=[];
for(const [ordinal,{root}] of [...selected].sort(([a],[b])=>a-b)) {
  const text=(root.textContent||'').normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
  const match=text.includes('soluzione')&&text.includes('adotterei');
  const svg=[...root.querySelectorAll('svg')];
  const buttons=[...root.querySelectorAll('button')];
  const anchors=[...root.querySelectorAll('a[href]')];
  const styled=[...root.querySelectorAll('[style]')];
  const table=[...root.querySelectorAll('table')];
  const shapes={};
  for(const node of svg) {
    const shape=bucket(node);
    shapes[shape]=(shapes[shape]||0)+1;
  }
  results.push({ordinal,targetWordsPresent:match,
    svg:svg.length,svgWithText:svg.filter(x=>x.querySelector('text,foreignObject')).length,
    svgPaths:svg.reduce((n,x)=>n+count(x,'path'),0),
    tables:table.length,tableWithSvg:table.filter(x=>!!x.querySelector('svg')).length,
    styled:styled.length,
    buttons:buttons.length,buttonsWithAnchors:buttons.filter(x=>!!x.querySelector('a[href]')).length,
    anchors:anchors.length,iconOnlyAnchors:anchors.filter(x=>!x.textContent.trim()&&!!x.querySelector('svg,img')).length,
    details:count(root,'details'),
    svgAncestorShapes:match?shapes:undefined});
}
console.log(JSON.stringify({status:'private-safe-layout-capture',selectedTurns:results.length,
  targetTurns:results.filter(x=>x.targetWordsPresent).map(x=>x.ordinal),
  turns:results,
  limitations:['Counts are structural, not proof of visual relationships',
    'Text, HTML, URLs and identifiers are not emitted',
    'Latest message-qualified snapshot per ordinal is sampled']},null,2));
