import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlatDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {ForegroundHistory} from '../src/foreground-history.mjs';
import {BackgroundPersistence} from '../adapters/background-persistence.mjs';
import {AsyncHistory} from '../src/async-history.mjs';
import {NodeAsyncFileJournal} from '../adapters/node-async-file-journal.mjs';

// Without provider, edits/undo/redo need neither persistence nor a Promise.
const base='header\nαβ🦊\n';
const initial={primary:1,ranges:[{anchor:2,head:4,virtualColumn:5}]};
const mem=new ForegroundHistory(new FlatDocument(base),initial);
assert.equal(mem.listeners.size,0);
mem.commit([{start:0,end:0,insert:'X'}]);
assert.equal(mem.document.toString(),'X'+base);
assert.equal(mem.undo(),true);assert.equal(mem.redo(),true);

// External slow adapter; notification must not wait for any storage callback.
const data={rows:[],session:null,calls:[],fault:false};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const delayMs=5;
const store={
 async count(){data.calls.push('count');await sleep(delayMs);return data.rows.length;},
 async read(i){await sleep(delayMs);return structuredClone(data.rows[i]);},
 async readSession(){data.calls.push('readSession');await sleep(delayMs);return structuredClone(data.session);},
 async appendAt(i,record){data.calls.push('append '+i);await sleep(delayMs);if(data.fault)throw Error('provider offline');data.rows.length=i;data.rows.push(structuredClone(record));},
 async writeSession(session){data.calls.push('cursor '+session.cursor);await sleep(delayMs);if(data.fault)throw Error('provider offline');data.session=structuredClone(session);}
};
const document=new AdaptiveRepackDocument(base),history=new ForegroundHistory(document,initial);
const pump=new BackgroundPersistence(history,store);
const trace=[];
const start=performance.now();
for(let i=0;i<160;i++){
 const p=document.length;
 const select={primary:i%2,ranges:[{anchor:p+1,head:p,virtualColumn:i%11},{anchor:i%3,head:i%4,virtualColumn:0}]};
 history.commit([{start:p,end:p,insert:i%7===0?'🧪':'x'}],select);
 trace.push({text:document.toString(),selection:structuredClone(select)});
}
const foregroundMs=performance.now()-start;
assert.ok(pump.pending>0);
assert.equal(history.index,160);
assert.equal(history.undo(),true);assert.equal(history.undo(),true);
assert.equal(history.redo(),true);
assert.equal(history.index,159);
assert.deepEqual(history.selection,trace[158].selection);
const atFlush=pump.issued;
const flushStart=performance.now();
const wait=pump.flush();
// Explicit flush doesn't stop later foreground edits; it tracks a snapshot.
history.redo();
await wait;
const flushMs=performance.now()-flushStart;
assert.ok(pump.completed>=atFlush);
await pump.flush();
assert.equal(pump.pending,0);
assert.equal(data.rows.length,160);
assert.equal(data.session.cursor,160);
assert.equal(data.calls.filter(x=>x.startsWith('append ')).length,160);
const restored=await AsyncHistory.open(new FlatDocument(base),store);
assert.equal(restored.document.toString(),history.document.toString());
assert.deepEqual(restored.selection,history.selection);
assert.equal(await restored.undo(),true);assert.equal(await restored.redo(),true);

// Branch after several undos, while the provider is busy. Sequence preserved.
for(let i=0;i<10;i++)history.undo();
history.commit([{start:0,end:0,insert:'BRANCH'}],{primary:0,ranges:[{anchor:0,head:0,virtualColumn:14}]});
assert.equal(history.redo(),false);
await pump.flush();
assert.equal(data.rows.length,151);
const reopenBranch=await AsyncHistory.open(new FlatDocument(base),store);
assert.equal(reopenBranch.document.toString(),history.document.toString());
assert.deepEqual(reopenBranch.selection,history.selection);

// Failure is visible through explicit flush/status, not through foreground edit.
data.fault=true;
const before=history.document.toString();
history.commit([{start:0,end:0,insert:'!'}]);
assert.equal(history.document.toString(),'!'+before);
await assert.rejects(pump.flush(),/provider offline/);
assert.match(String(pump.status.error),/provider offline/);
assert.ok(pump.status.pending>0);
pump.detach();

// A genuine asynchronous file adapter can be driven through the same bridge.
const dir=await mkdtemp(join(tmpdir(),'rumiai-bg-history-'));
try{
 let disk=await NodeAsyncFileJournal.open(join(dir,'journal'));
 const h=new ForegroundHistory(new AdaptiveRepackDocument(base),initial);
 const bg=new BackgroundPersistence(h,disk);
 h.commit([{start:0,end:0,insert:'disk'}],{primary:0,ranges:[{anchor:2,head:1,virtualColumn:6}]});
 h.commit([{start:5,end:5,insert:'\n'}]);
 await bg.flush();bg.detach();await disk.close();
 disk=await NodeAsyncFileJournal.open(join(dir,'journal'),{create:false});
 const replay=await AsyncHistory.open(new AdaptiveRepackDocument(base),disk);
 assert.equal(replay.document.toString(),h.document.toString());
 assert.deepEqual(replay.selection,h.selection);
 await disk.close();
}finally{await rm(dir,{recursive:true,force:true});}
console.log(JSON.stringify({pass:true,foregroundEdits:160,foregroundMs:+foregroundMs.toFixed(2),nominalProviderDelayMs:delayMs,explicitFlushMs:+flushMs.toFixed(2),adapterOps:data.calls.length,branchReopen:true,fileReopen:true,failedPersistenceVisible:true,optionalNoStorage:true}));
