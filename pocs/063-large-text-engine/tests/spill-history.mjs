import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlatDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {ForegroundHistory} from '../src/foreground-history.mjs';
import {SpillHistory} from '../src/spill-history.mjs';
import {BackgroundPersistence} from '../adapters/background-persistence.mjs';
import {NodeAsyncFileJournal} from '../adapters/node-async-file-journal.mjs';
import {AsyncHistory} from '../src/async-history.mjs';

const base='hello 🦊\n你好\tβeta\n';
const initial={primary:1,ranges:[{anchor:5,head:2,virtualColumn:13},{anchor:7,head:7,virtualColumn:4}]};
const tiny=new SpillHistory(new FlatDocument(base),initial,{hotLimit:8});
assert.equal(tiny.listeners.size,0);
for(let i=0;i<80;i++)tiny.commit([{start:tiny.document.length,end:tiny.document.length,insert:i%9===0?'\n':'é'}],{primary:i%2,ranges:[{anchor:i,head:i,virtualColumn:i%8}]});
assert.equal(tiny.status.residentRecords,80,'optional persistence: no provider, no eviction');
for(let i=0;i<80;i++)assert(await tiny.undo());
assert.equal(tiny.document.toString(),base);
assert.deepEqual(tiny.selection,initial);
for(let i=0;i<80;i++)assert(await tiny.redo());

const dir=await mkdtemp(join(tmpdir(),'rumiai-spill-'));
try {
 const store=await NodeAsyncFileJournal.open(join(dir,'history'));
 const document=new AdaptiveRepackDocument(base);
 const history=new SpillHistory(document,initial,{hotLimit:16});
 const reference=new ForegroundHistory(new FlatDocument(base),initial);
 const bridge=new BackgroundPersistence(history,store);
 let longestPending=0;
 const states=[{text:base,selection:initial}];
 for(let i=0;i<900;i++){
  const p=(i*31+7)%(document.length+1);
  const end=Math.min(document.length,p+(i%6===0?2:0));
  const q=Math.min(document.length,end+3);
  const edits=[{start:p,end,insert:i%11===0?'🙂':(i%17===0?'\n':'X')},{start:q,end:q,insert:'π'}];
  const after={primary:i%2,ranges:[{anchor:i%100,head:i%97,virtualColumn:i%19},{anchor:i%44,head:i%55,virtualColumn:i%31}]};
  history.commit(edits,after);reference.commit(edits,after);
  assert.equal(document.toString(),reference.document.toString(),'foreground parity '+i);
  states.push({text:reference.document.toString(),selection:structuredClone(after)});
  longestPending=Math.max(longestPending,bridge.pending);
  if(i%60===59){await bridge.flush();assert.ok(history.status.residentRecords<=35,'hot memory window exceeded at '+i+' '+JSON.stringify(history.status));}
 }
 await bridge.flush();
 assert.equal(history.status.archivedEntries,900);
 assert.ok(history.status.residentRecords<=16,'retained hot records '+history.status.residentRecords);
 // Whole history must remain navigable, using actual asynchronous file reads
 // for the 884 records no longer retained in foreground JS memory.
 for(let i=899;i>=0;i--){
  assert(await history.undo(),'undo '+i);
  assert(await reference.undo(),'reference undo '+i);
  assert.equal(document.toString(),states[i].text,'undo text '+i);
  assert.deepEqual(history.selection,states[i].selection,'undo selection '+i);
 }
 assert.equal(history.status.residentRecords<=18,true);
 for(let i=0;i<900;i++){
  assert(await history.redo(),'redo '+i);
  assert(await reference.redo(),'reference redo '+i);
  assert.equal(document.toString(),states[i+1].text,'redo text '+i);
  assert.deepEqual(history.selection,states[i+1].selection,'redo selection '+i);
 }
 await bridge.flush();
 // Undo through cold archive then branch, ensuring earlier redo is truncated
 // when the bridge flushes the replacement record.
 for(let i=0;i<700;i++)assert(await history.undo());
 history.commit([{start:0,end:0,insert:'BRANCH 🧪'}],{primary:0,ranges:[{anchor:0,head:0,virtualColumn:12}]});
 assert.equal(await history.redo(),false);
 await bridge.flush();
 assert.equal(await store.count(),201);
 assert.equal(history.status.archivedEntries,201);
 const reopened=await AsyncHistory.open(new AdaptiveRepackDocument(base),store);
 assert.equal(reopened.document.toString(),history.document.toString());
 assert.deepEqual(reopened.selection,history.selection);
 assert(await reopened.undo());assert(await reopened.redo());
 bridge.detach();await store.close();
 console.log(JSON.stringify({pass:true,edits:900,hotLimit:16,archivedBeforeBranch:900,coldUndoRedoEach:900,branchRecords:201,maxQueuedEvents:longestPending,normalReopen:true}));
}finally{await rm(dir,{recursive:true,force:true});}

// Failure: never evict an entry that was not acknowledged as stored.
const failureStorage={records:[],session:null,fail:false,
 async count(){return this.records.length;},async read(i){return this.records[i];},
 async readSession(){return this.session;},async writeSession(s){this.session=structuredClone(s);},
 async appendAt(i,r){if(this.fail)throw Error('provider offline');this.records.length=i;this.records.push(structuredClone(r));}};
const failingHistory=new SpillHistory(new FlatDocument(base),initial,{hotLimit:4});
const failingBridge=new BackgroundPersistence(failingHistory,failureStorage);
for(let i=0;i<10;i++)failingHistory.commit([{start:failingHistory.document.length,end:failingHistory.document.length,insert:'K'}]);
await failingBridge.flush();
assert.ok(failingHistory.status.residentRecords<=4);
failureStorage.fail=true;
for(let i=0;i<20;i++)failingHistory.commit([{start:failingHistory.document.length,end:failingHistory.document.length,insert:'W'}]);
await assert.rejects(failingBridge.flush(),/provider offline/);
assert.ok(failingHistory.status.residentRecords>=20,'pending edits retained when persistence fails');
const completedText=failingHistory.document.toString();
for(let i=0;i<20;i++)assert(await failingHistory.undo());
for(let i=0;i<20;i++)assert(await failingHistory.redo());
assert.equal(failingHistory.document.toString(),completedText);
assert.ok(failingBridge.status.error);failingBridge.detach();
console.log(JSON.stringify({pass:true,case:'failed provider',retainedUnpersisted:failingHistory.status.pendingEntries,statusError:true}));
