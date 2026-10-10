// Compare long-session heap with the same document/edit workload. One process
// per scenario; report absolute post-GC heap, RSS and actual journal bytes.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AdaptiveRepackDocument} from '../src/documents.mjs';
import {ForegroundHistory} from '../src/foreground-history.mjs';
import {SpillHistory} from '../src/spill-history.mjs';
import {BackgroundPersistence} from '../adapters/background-persistence.mjs';
import {NodeAsyncFileJournal} from '../adapters/node-async-file-journal.mjs';
const mode=process.argv[2]??'file',operations=Number(process.argv[3]??12000);
if(!['foreground','no-provider','file'].includes(mode)||!Number.isSafeInteger(operations)||operations<100||operations>100000)throw RangeError('mode/count');
if(typeof global.gc!=='function')throw Error('requires --expose-gc');
const basedoc='Q'.repeat(2*1048576);
const doc=new AdaptiveRepackDocument(basedoc),state={primary:0,ranges:[{anchor:0,head:0,virtualColumn:0},{anchor:2,head:1,virtualColumn:4}]};
const h=mode==='foreground'?new ForegroundHistory(doc,state):new SpillHistory(doc,state,{hotLimit:128});
const dir=await mkdtemp(join(tmpdir(),'rumiai-spill-memory-'));
let store=null,bridge=null;
try {
 if(mode==='file'){
  store=await NodeAsyncFileJournal.open(join(dir,'journal'));
  bridge=new BackgroundPersistence(h,store);
 }
 let x=0x31e0f00d;
 const next=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
 let foregroundMs=0,flushingMs=0;
 const start=performance.now();
 for(let i=0;i<operations;i++){
  const p=next()%(doc.length+1);
  const end=Math.min(doc.length,p+(i%11===0?2:0));
  const text=i%17===0?'\nZ':i%3===0?'汉':'x';
  const editStart=performance.now();
  h.commit([{start:p,end,insert:text}],{primary:i%2,ranges:[{anchor:p,head:p+text.length,virtualColumn:i%15},{anchor:p,head:p,virtualColumn:i%7}]});
  foregroundMs+=performance.now()-editStart;
  if(bridge && i%1000===999){const waitStart=performance.now();await bridge.flush();flushingMs+=performance.now()-waitStart;}
 }
 const wallMs=performance.now()-start;
 if(bridge)await bridge.flush();
 global.gc();global.gc();const m=process.memoryUsage();
 const memory={heapMiB:+(m.heapUsed/1048576).toFixed(3),rssMiB:+(m.rss/1048576).toFixed(3),peakRssMiB:+(process.resourceUsage().maxRSS/1024).toFixed(3)};
 const checkpoint=doc.toString(),selection=JSON.stringify(h.selection);
 const replayStart=performance.now();
 const n=Math.min(250,operations);
 for(let i=0;i<n;i++)assert.equal(await h.undo(),true);
 for(let i=0;i<n;i++)assert.equal(await h.redo(),true);
 const replayMs=performance.now()-replayStart;
 assert.equal(doc.toString(),checkpoint);assert.equal(JSON.stringify(h.selection),selection);
 if(bridge)await bridge.flush();
 const journalMiB=store?+(((await stat(join(dir,'journal.data'))).size+(await stat(join(dir,'journal.index'))).size)/1048576).toFixed(3):0;
 console.log(JSON.stringify({pass:true,mode,operations,hotLimit:h.hotLimit??null,residentEntries:h.status?.residentRecords??h.entries.length,archivedEntries:h.status?.archivedEntries??0,journalMiB,foregroundMs:+foregroundMs.toFixed(2),explicitFlushMs:+flushingMs.toFixed(2),wallMs:+wallMs.toFixed(2),replayMs:+replayMs.toFixed(2),...memory,docLength:doc.length,nodes:doc.stats().nodes}));
}finally{bridge?.detach();await store?.close();await rm(dir,{recursive:true,force:true});}
