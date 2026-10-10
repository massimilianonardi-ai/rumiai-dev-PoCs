// One scenario per process, exact test code; run with node --expose-gc.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {ChunkedPieceDocument,LocalRepackDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {CompactHistory} from '../src/compact-history.mjs';
import {NodeFileJournal} from '../adapters/node-file-journal.mjs';
if(!global.gc)throw Error('run with --expose-gc');
const [type='repack',place='disk',pattern='mixed',opsText='12000',miBText='2']=process.argv.slice(2);
if(!['chunked','repack','adaptive'].includes(type)||!['array','disk'].includes(place)||!['mixed','append'].includes(pattern))throw Error('invalid scenario');
const ops=Number(opsText),miB=Number(miBText);
if(!Number.isSafeInteger(ops)||ops<1||ops>100000||!Number.isInteger(miB)||miB<1||miB>128)throw RangeError('ops/size');
const temp=mkdtempSync(join(tmpdir(),'rumiai-poc-journal-'));
const store=place==='disk'?new NodeFileJournal(join(temp,'journal')):undefined;
try{
 const Doc=type==='chunked'?ChunkedPieceDocument:type==='repack'?LocalRepackDocument:AdaptiveRepackDocument;
 const doc=new Doc('Q'.repeat(miB*1048576));
 const state={primary:0,ranges:[{anchor:0,head:0,virtualColumn:0},{anchor:1,head:1,virtualColumn:3}]};
 const history=new CompactHistory(doc,state,store);
 let seed=0xabcd1234;const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 const snapshot=(phase)=>{
  global.gc();global.gc();const m=process.memoryUsage(),resource=process.resourceUsage();
  const stats=doc.stats();const x={phase,type,place,pattern,ops,miB,length:doc.length,entries:history.length,
   nodes:stats.nodes,sources:stats.sources,repackedUnits:stats.repackedUnits??0,
   heapMiB:+(m.heapUsed/1048576).toFixed(3),rssMiB:+(m.rss/1048576).toFixed(3),
   peakRssMiB:+(resource.maxRSS/(process.platform==='linux'?1024:1048576)).toFixed(3),
   journalMiB:+((store?.byteLength??0)/1048576).toFixed(3)};
  console.log(JSON.stringify(x));return x;
 };
 snapshot('loaded');const start=performance.now();
 for(let i=0;i<ops;i++){
   const p=pattern==='append'?doc.length:next()%(doc.length+1);
   const size=pattern==='append'?0:Math.min(doc.length-p,i%11===0?2:0);
   const ins=i%23===0?'\nK':i%2?'AB':'x';
   history.commit([{start:p,end:p+size,insert:ins}],{primary:i%2,ranges:[{anchor:p,head:p,virtualColumn:i%7},{anchor:p+ins.length,head:p,virtualColumn:i%11}]});
 }
 const editMs=performance.now()-start;const after=snapshot('after-edits');
 const sha=()=>createHash('sha256').update(doc.toString()).digest('hex');
 const expected=sha(),selection=JSON.stringify(history.selection);
 const replayStart=performance.now(),n=Math.min(1000,ops);
 for(let i=0;i<n;i++)assert.equal(history.undo(),true);
 for(let i=0;i<n;i++)assert.equal(history.redo(),true);
 const replayMs=performance.now()-replayStart;
 assert.equal(sha(),expected);assert.equal(JSON.stringify(history.selection),selection);
 if(store)store.sync();
 console.log(JSON.stringify({phase:'complete',type,place,pattern,ops,miB,editMs:+editMs.toFixed(2),replayMs:+replayMs.toFixed(2),postEdit:after,pass:true}));
}finally{store?.close();rmSync(temp,{recursive:true,force:true});}
