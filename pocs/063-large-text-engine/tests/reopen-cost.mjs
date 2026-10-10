// Exploratory normal-session replay cost using the real async Node file adapter.
// This measures persistence latency, not crash recovery or browser IndexedDB.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {FlatDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {AsyncHistory} from '../src/async-history.mjs';
import {NodeAsyncFileJournal} from '../adapters/node-async-file-journal.mjs';
const steps=Number(process.argv[2]??1500);
if(!Number.isSafeInteger(steps)||steps<10||steps>10000)throw RangeError('steps 10..10000');
const base='α one\nβ two\n'.repeat(80);
const dir=await mkdtemp(join(tmpdir(),'rumiai-replay-cost-'));
const heapMiB=()=>{global.gc?.();global.gc?.();return +(process.memoryUsage().heapUsed/1048576).toFixed(3);};
try {
 const name=join(dir,'history');let storage=await NodeAsyncFileJournal.open(name);
 const doc=new AdaptiveRepackDocument(base),h=await AsyncHistory.open(doc,storage);
 const ref=new FlatDocument(base);
 const start=performance.now();
 for(let i=0;i<steps;i++){
  const p=(i*117+5)%(doc.length+1);
  const end=Math.min(doc.length,p+(i%5===0?2:0));
  const ins=i%7===0?'📝':'x';
  const sel={primary:i%2,ranges:[{anchor:p,head:p,virtualColumn:i%8},{anchor:end,head:p,virtualColumn:i%3}]};
  await h.commit([{start:p,end,insert:ins}],sel);ref.replace(p,end,ins);
 }
 const commitMs=performance.now()-start;
 const afterCommitHeap=heapMiB();
 assert.equal(doc.toString(),ref.toString());await storage.close();
 storage=await NodeAsyncFileJournal.open(name,{create:false});
 const replayStart=performance.now(),reopened=await AsyncHistory.open(new AdaptiveRepackDocument(base),storage);
 const reopenMs=performance.now()-replayStart;
 const afterReopenHeap=heapMiB();
 assert.equal(reopened.document.toString(),ref.toString());assert.deepEqual(reopened.selection,h.selection);
 const last=reopened.document.toString();
 for(let i=0;i<10;i++)assert(await reopened.undo());
 for(let i=0;i<10;i++)assert(await reopened.redo());
 assert.equal(reopened.document.toString(),last);
 await storage.close();
 console.log(JSON.stringify({pass:true,steps,adapter:'NodeAsyncFileJournal',commitMs:+commitMs.toFixed(2),reopenMs:+reopenMs.toFixed(2),historyReadDuringOpen:steps,afterCommitHeapMiB:afterCommitHeap,afterReopenHeapMiB:afterReopenHeap,model:'base text + sequential replay; no checkpoints'}));
}finally{await rm(dir,{recursive:true,force:true});}
