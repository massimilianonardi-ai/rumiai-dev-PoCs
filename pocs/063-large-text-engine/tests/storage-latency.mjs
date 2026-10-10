// Simulates slow storage calls. Timing is about API roundtrips, not network evidence.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {FlatDocument} from '../src/documents.mjs';
import {AsyncHistory} from '../src/async-history.mjs';
import {CallbackJournal} from '../adapters/callback-journal.mjs';
const delay=Number(process.argv[2]??4),operations=Number(process.argv[3]??100);
if(!Number.isInteger(delay)||delay<0||delay>100||!Number.isInteger(operations)||operations<1||operations>5000)throw RangeError('parameters');
const state={records:[],session:null,callCounts:{count:0,read:0,appendAt:0,readSession:0,writeSession:0}};
const latency=async()=>{if(delay)await new Promise(r=>setTimeout(r,delay));else await Promise.resolve();};
const storage=new CallbackJournal({
 count:async()=>{state.callCounts.count++;await latency();return state.records.length;},
 read:async i=>{state.callCounts.read++;await latency();return structuredClone(state.records[i]);},
 appendAt:async(i,e)=>{state.callCounts.appendAt++;await latency();state.records.length=i;state.records.push(structuredClone(e));},
 readSession:async()=>{state.callCounts.readSession++;await latency();return structuredClone(state.session);},
 writeSession:async meta=>{state.callCounts.writeSession++;await latency();state.session=structuredClone(meta);}
});
const base='alpha\nbeta\n';let doc=new FlatDocument(base);const history=await AsyncHistory.open(doc,storage);
const t=performance.now();for(let i=0;i<operations;i++)await history.commit([{start:doc.length,end:doc.length,insert:'x'}],{primary:0,ranges:[{anchor:doc.length+1,head:doc.length+1,virtualColumn:0}]});
const editMs=performance.now()-t;
const txCount=structuredClone(state.callCounts);
// Concurrent calls currently cause a deliberate rejection; the UI needs an
// edit queue/optimistic state in future, not an assumption that I/O is instant.
const inFlight=history.commit([{start:0,end:0,insert:'z'}]);
await assert.rejects(history.commit([{start:0,end:0,insert:'w'}]),/concurrent history operation/);
await inFlight;
const reopenStart=performance.now();const recovered=await AsyncHistory.open(new FlatDocument(base),storage);
const reopenMs=performance.now()-reopenStart;
assert.equal(recovered.document.toString(),history.document.toString());assert.deepEqual(recovered.selection,history.selection);
console.log(JSON.stringify({pass:true,adapter:'simulated service callbacks',artificialDelayPerCallMs:delay,operations,editMs:+editMs.toFixed(2),reopenMs:+reopenMs.toFixed(2),callsDuringCommits:txCount,historyReadsDuringReopen:operations+1,concurrentCommitRejected:true}));
