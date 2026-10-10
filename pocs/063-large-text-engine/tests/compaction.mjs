// Exploratory expensive full-materialization checkpoint to quantify fragmentation.
// Not a production compactor and not safe for huge files; requires --expose-gc.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {PieceDocument} from '../src/documents.mjs';
import {History} from '../src/transactions.mjs';
if(typeof global.gc!=='function')throw Error('requires --expose-gc');
const n=Number(process.argv[2]??16000),historyEnabled=process.argv[3]!=='no-history';
if(!Number.isInteger(n)||n<1||n>100000)throw RangeError('operations 1..100000');
const state={primary:0,ranges:[{anchor:0,head:0,virtualColumn:0}]};
let d=new PieceDocument('Q'.repeat(2*1024*1024));
let h=historyEnabled?new History(d,state):null;
const sample=stage=>{global.gc();global.gc();const m=process.memoryUsage();console.log(JSON.stringify({stage,n,history:historyEnabled,heapMiB:+(m.heapUsed/1048576).toFixed(3),rssMiB:+(m.rss/1048576).toFixed(3),nodes:d.stats().nodes,entries:h?.entries.length??0}));};
let rng=9;const next=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;};
for(let i=0;i<n;i++){
 const p=next()%(d.length+1),end=Math.min(d.length,p+(i%5===0?2:0));
 const e={start:p,end,insert:i%3===0?'AB':'x'};
 if(h)h.commit([e],{primary:0,ranges:[{anchor:p,head:p,virtualColumn:i%8}]});else d.replace(e.start,e.end,e.insert);
}
sample('fragmented');
const before=d.toString(),t=performance.now();const rebuilt=new PieceDocument(before);
d=rebuilt;if(h)h.document=d;
assert.equal(d.toString(),before);
const ms=performance.now()-t;sample('rebuilt');
if(h){for(let i=0;i<300;i++)assert.equal(h.undo(),true);for(let i=0;i<300;i++)assert.equal(h.redo(),true);assert.equal(d.toString(),before);sample('after-history-replay');}
console.log(JSON.stringify({result:'PASS',rebuildMs:+ms.toFixed(3)}));
