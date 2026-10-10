// PoC-only controlled comparison. Invoke each case in an isolated Node process.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {PieceDocument,ChunkedPieceDocument} from '../src/documents.mjs';
import {History} from '../src/transactions.mjs';
import {CompactHistory} from '../src/compact-history.mjs';
const [documentName='piece',historyName='original',pattern='append',stepsString='20000',initialMiBString='2']=process.argv.slice(2);
if(!['piece','chunked'].includes(documentName)||!['original','compact','none'].includes(historyName)||!['append','mixed'].includes(pattern))throw TypeError('invalid scenario');
const steps=Number(stepsString),initialMiB=Number(initialMiBString);
if(!Number.isSafeInteger(steps)||steps<1||steps>100000||!Number.isInteger(initialMiB)||initialMiB<1||initialMiB>128)throw RangeError('invalid size');
if(typeof global.gc!=='function')throw Error('run node --expose-gc');
const Doc=documentName==='piece'?PieceDocument:ChunkedPieceDocument;
const Hist=historyName==='original'?History:CompactHistory;
const document=new Doc('Q'.repeat(initialMiB*1048576));
const initial={primary:0,ranges:[{anchor:0,head:0,virtualColumn:0},{anchor:1,head:1,virtualColumn:3}]};
const history=historyName==='none'?null:new Hist(document,initial);
let r=0xabcd1234;
const next=()=>{r^=r<<13;r^=r>>>17;r^=r<<5;return r>>>0;};
const sample=(phase)=>{
  global.gc();global.gc();
  const m=process.memoryUsage(),stats=document.stats(),resource=process.resourceUsage();
  const data={phase,documentName,historyName,pattern,steps,initialMiB,
    documentLength:document.length,nodes:stats.nodes,sources:stats.sources,depth:stats.maxDepth,
    entries:history?.entries.length??0,heapMiB:+(m.heapUsed/1048576).toFixed(3),
    rssMiB:+(m.rss/1048576).toFixed(3),peakRssMiB:+(resource.maxRSS/(process.platform==='linux'?1024:1048576)).toFixed(3)};
  console.log(JSON.stringify(data));
  return data;
};
sample('loaded');
const now=performance.now();
for(let i=0;i<steps;i++){
  const p=pattern==='append'?document.length:next()%(document.length+1);
  const size=pattern==='append'?0:Math.min(document.length-p,i%11===0?2:0);
  const insert=i%23===0?'\nK':i%2?'AB':'x';
  const edit={start:p,end:p+size,insert};
  if(history){history.commit([edit],{primary:i%2,ranges:[{anchor:p,head:p,virtualColumn:i%7},{anchor:p+insert.length,head:p,virtualColumn:i%11}]});}
  else document.replace(edit.start,edit.end,edit.insert);
}
const editingMs=performance.now()-now;
const after=sample('after-edits');
let replayMs=null;
if(history){
  const preUndoLength=document.length;
  const preUndoTail=document.slice(Math.max(0,preUndoLength-256),preUndoLength);
  const preUndoSelection=JSON.stringify(history.selection);
  const t=performance.now();
  for(let i=0;i<Math.min(1000,steps);i++)assert.equal(history.undo(),true);
  for(let i=0;i<Math.min(1000,steps);i++)assert.equal(history.redo(),true);
  replayMs=performance.now()-t;
  assert.equal(document.length,preUndoLength);
  assert.equal(document.slice(Math.max(0,preUndoLength-256),preUndoLength),preUndoTail);
  assert.equal(JSON.stringify(history.selection),preUndoSelection);
  sample('after-replay');
}
console.log(JSON.stringify({phase:'done',documentName,historyName,pattern,steps,initialMiB,
  editingMs:+editingMs.toFixed(2),replayMs:replayMs===null?null:+replayMs.toFixed(2),postEdit:after,
  status:'PASS'}));
