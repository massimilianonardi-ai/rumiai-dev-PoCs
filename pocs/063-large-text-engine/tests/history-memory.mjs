// Isolated, reproducible, exploratory RAM/history experiment. Run with --expose-gc.
import { performance } from 'node:perf_hooks';
import { PieceDocument, FlatDocument } from '../src/documents.mjs';
import { History } from '../src/transactions.mjs';

if (typeof global.gc !== 'function') throw new Error('run Node with --expose-gc');
const [kind='piece',historyArg='history',stepsArg='12000',sizeArg='2',pattern='mixed'] = process.argv.slice(2);
if(!['piece','flat'].includes(kind)||!['history','no-history'].includes(historyArg)||!['mixed','append','replace'].includes(pattern))throw new TypeError('invalid arguments');
const steps=Number(stepsArg), sizeMiB=Number(sizeArg);
if(!Number.isSafeInteger(steps)||steps<1||steps>100000||!Number.isInteger(sizeMiB)||sizeMiB<1||sizeMiB>128)throw new RangeError('steps 1..100000, MiB 1..128');
const Document=kind==='piece'?PieceDocument:FlatDocument;
let s='Q'.repeat(sizeMiB*1024*1024);
global.gc();const baseline=process.memoryUsage();
const doc=new Document(s);s=null;
const select={primary:0,ranges:[{anchor:0,head:0,virtualColumn:0},{anchor:2,head:2,virtualColumn:3}]};
const hist=historyArg==='history'?new History(doc,select):null;
let rng=0x55efac41;
const next=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;};
const rows=[];
const snap=(stage,ops)=>{
  const t=performance.now();global.gc();global.gc();
  const p=process.memoryUsage(),rss=process.resourceUsage();
  const m={stage,ops,docLength:doc.length,historyEntries:hist?.entries.length??0,
    historyIndex:hist?.index??0,
    heapMiB:+(p.heapUsed/1048576).toFixed(3),rssMiB:+(p.rss/1048576).toFixed(3),
    externalMiB:+(p.external/1048576).toFixed(3),arrayBuffersMiB:+(p.arrayBuffers/1048576).toFixed(3),
    peakRSSMiB:+(rss.maxRSS/(process.platform==='linux'?1024:1048576)).toFixed(3),
    gcMs:+(performance.now()-t).toFixed(2),
    doc:doc.stats?.()};
  rows.push(m);console.log(JSON.stringify(m));
};
snap('loaded',0);
const timer=performance.now();
for(let i=1;i<=steps;i++){
  const p=pattern==='append'?doc.length:next()%(doc.length+1);
  const removed=pattern==='append'?0:Math.min(doc.length-p,pattern==='replace'?1:i%4===0?2:0);
  const insert=pattern==='replace'?'Z':i%23===0?'\nK':i%2===0?'AB':'x';
  const change={start:p,end:p+removed,insert};
  if(hist) {
    const after={primary:i%2,ranges:[{anchor:p+insert.length,head:p+insert.length,virtualColumn:i%7},{anchor:p,head:p,virtualColumn:i%11}]};
    hist.commit([change],after);
  } else doc.replace(p,p+removed,insert);
  if(i%Math.max(1,Math.floor(steps/4))===0)snap('editing',i);
}
console.log(JSON.stringify({stage:'edit-time',ms:+(performance.now()-timer).toFixed(2)}));
if(hist){
  const count=Math.floor(steps/2),t=performance.now();
  for(let i=0;i<count;i++)if(!hist.undo())throw Error('undo failed');
  snap('half-undo',count);
  for(let i=0;i<count;i++)if(!hist.redo())throw Error('redo failed');
  snap('full-redo',steps);
  console.log(JSON.stringify({stage:'replay-time',ms:+(performance.now()-t).toFixed(2)}));
  for(let i=0;i<count;i++)hist.undo();
  hist.commit([{start:doc.length,end:doc.length,insert:'!'}],{primary:0,ranges:[]});
  if(hist.redo())throw Error('redo should be truncated after branching');
  snap('branch-discard-redo',count+1);
}
console.log(JSON.stringify({result:'PASS',kind,historyArg,steps,sizeMiB,pattern,baselineHeapMiB:+(baseline.heapUsed/1048576).toFixed(3),sampleCount:rows.length}));
