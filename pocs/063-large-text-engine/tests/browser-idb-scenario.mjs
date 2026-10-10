// Runs inside a real Chromium page, served over loopback HTTP.
// A later invocation launches a NEW Chromium process on the same browser profile.
import {AsyncHistory} from '../src/async-history.mjs';
import {ForegroundHistory} from '../src/foreground-history.mjs';
import {SpillHistory} from '../src/spill-history.mjs';
import {BackgroundPersistence} from '../adapters/background-persistence.mjs';
import {FlatDocument, AdaptiveRepackDocument} from '../src/documents.mjs';
import {IndexedDBJournal} from '../adapters/indexeddb-journal.mjs';

const base='alpha 😀\nbeta\t汉字\n'.repeat(12);
const initial={primary:1,ranges:[{anchor:3,head:1,virtualColumn:9},{anchor:7,head:7,virtualColumn:12}]};
const name='rumiai-poc-063-indexeddb-real-browser';
const copies=o=>JSON.parse(JSON.stringify(o));
const t=()=>performance.now();
function assert(cond,label){if(!cond)throw Error(label);}
function equal(a,b,label){assert(JSON.stringify(a)===JSON.stringify(b),label+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function makeEdits(flat,i){
 const p=(i*73+5)%(flat.length+1);
 const end=Math.min(flat.length,p+(i%7===0?2:0));
 const q=Math.min(flat.length,end+3);
 return [{start:p,end,insert:i%11===0?'🧪':i%29===0?'\n':'W'},{start:q,end:q,insert:i%3===0?'汉':'|'}];
}
function makeSelection(i){return {primary:i%2,ranges:[{anchor:i%149,head:(i+5)%157,virtualColumn:i%13},{anchor:i%43,head:i%37,virtualColumn:2*i%11}]};}
function expected(steps){const flat=new FlatDocument(base);let selection=initial;
 for(let i=0;i<steps;i++){const edits=makeEdits(flat,i);for(let j=edits.length-1;j>=0;j--)flat.replace(edits[j].start,edits[j].end,edits[j].insert);selection=makeSelection(i);}
 return {text:flat.toString(),selection};}
async function run(stage){
 const storage=await IndexedDBJournal.open(name);
 try{
  const doc=new AdaptiveRepackDocument(base);
  const started=t();const history=await AsyncHistory.open(doc,storage,initial);
  const openMs=t()-started;
  if(stage==='write'){
   assert(history.index===0,'new journal is empty');
   const sample=[];
   for(let i=0;i<800;i++){
    const edits=makeEdits(doc,i);const clock=t();await history.commit(edits,makeSelection(i));sample.push(t()-clock);
   }
   const want=expected(800);equal(doc.toString(),want.text,'write content');equal(history.selection,want.selection,'write selection');
   assert(await storage.count()===800,'journal length');
   return {pass:true,stage,edits:800,openMs,commitMeanMs:sample.reduce((a,b)=>a+b,0)/sample.length,commitP95Ms:sample.sort((a,b)=>a-b)[Math.floor(.95*sample.length)],journalEntries:await storage.count()};
  }
  if(stage==='reopen'){
   assert(history.index===800,'reopen cursor');const want=expected(800);
   equal(doc.toString(),want.text,'reopen full text');equal(history.selection,want.selection,'reopen selection');
   for(let i=0;i<60;i++)assert(await history.undo(),'undo #'+i);
   equal(doc.toString(),expected(740).text,'after 60 undo');
   for(let i=0;i<60;i++)assert(await history.redo(),'redo #'+i);
   equal(doc.toString(),want.text,'after redo full text');equal(history.selection,want.selection,'redo selection');
   for(let i=0;i<35;i++)assert(await history.undo(),'stage cursor undo '+i);
   equal(doc.toString(),expected(765).text,'765 text');
   return {pass:true,stage,index:history.index,openMs,undoRedo:60,selectedRows:history.selection.ranges.length};
  }
  if(stage==='branch'){
   assert(history.index===765,'saved cursor after normal page process exit');equal(doc.toString(),expected(765).text,'restored undone document');
   assert(await history.redo(),'redo after reopen');
   equal(doc.toString(),expected(766).text,'redo state after reopen');
   const selection={primary:0,ranges:[{anchor:0,head:0,virtualColumn:99}]};
   await history.commit([{start:0,end:0,insert:'BRANCH 📝'}],selection);
   assert(await history.redo()===false,'redo branch truncated');
   return {pass:true,stage,index:history.index,entries:await storage.count(),openMs,redoAcrossReopen:true,branch:true};
  }
  if(stage==='verify'){
   assert(history.index===767,'final reopened cursor');assert(await storage.count()===767,'branch replaces future entries');
   const expectedText='BRANCH 📝'+expected(766).text;
   equal(doc.toString(),expectedText,'post-branch reopen');
   equal(history.selection,{primary:0,ranges:[{anchor:0,head:0,virtualColumn:99}]},'branch selection');
   await history.undo();equal(doc.toString(),expected(766).text,'branch undo');
   await history.redo();equal(doc.toString(),expectedText,'branch redo');
   return {pass:true,stage,index:history.index,entries:await storage.count(),openMs,undoRedo:true};
  }
  throw Error('unknown stage '+stage);
 } finally {storage.close();}
}
// Same provider-neutral background bridge, now with genuine browser IndexedDB.
async function runBackground(stage) {
 const storage=await IndexedDBJournal.open('rumiai-poc-063-background-idb');
 try {
  const doc=new AdaptiveRepackDocument(base);
  if(stage==='background-write') {
   const h=new ForegroundHistory(doc,initial);
   const bg=new BackgroundPersistence(h,storage);
   const start=t();
   for(let i=0;i<320;i++)h.commit(makeEdits(doc,i),makeSelection(i));
   const foregroundMs=t()-start;
   assert(bg.pending>0,'storage remains asynchronous');
   equal(doc.toString(),expected(320).text,'foreground text');
   await bg.flush();
   assert(bg.pending===0,'all background writes complete');
   equal(h.selection,expected(320).selection,'foreground selection');
   bg.detach();
   return {pass:true,stage,edits:320,foregroundMs,persisted:await storage.count(),explicitFlush:true};
  }
  if(stage==='background-reopen'){
   const h=await AsyncHistory.open(doc,storage,initial);
   assert(h.index===320,'background reopened history count');
   equal(doc.toString(),expected(320).text,'background reopened text');
   equal(h.selection,expected(320).selection,'background reopened selection');
   for(let i=0;i<25;i++)assert(await h.undo(),'background undo');
   for(let i=0;i<25;i++)assert(await h.redo(),'background redo');
   equal(doc.toString(),expected(320).text,'background replayed text');
   return {pass:true,stage,entries:await storage.count(),undoRedo:25};
  }
  throw Error('unknown background stage');
 } finally {storage.close();}
}
// Cold undo/redo integration with real IndexedDB and an optional spill cache.
async function runSpill(stage) {
 const storage=await IndexedDBJournal.open('rumiai-poc-063-spill-idb');
 try {
  const doc=new AdaptiveRepackDocument(base);
  if(stage==='spill-write') {
   const history=new SpillHistory(doc,initial,{hotLimit:12});
   const bridge=new BackgroundPersistence(history,storage);
   const start=t();
   for(let i=0;i<420;i++)history.commit(makeEdits(doc,i),makeSelection(i));
   const foregroundMs=t()-start;
   assert(bridge.pending>0,'no waiting for persistence during foreground edits');
   await bridge.flush();
   assert(history.status.archivedEntries===420,'all history archived');
   assert(history.status.residentRecords<=12,'bounded foreground resident entries');
   equal(doc.toString(),expected(420).text,'spill document');
   for(let i=0;i<420;i++)assert(await history.undo(),'cold undo '+i);
   equal(doc.toString(),base,'complete undo');
   equal(history.selection,initial,'initial selection');
   for(let i=0;i<420;i++)assert(await history.redo(),'cold redo '+i);
   equal(doc.toString(),expected(420).text,'complete redo');
   await bridge.flush();
   bridge.detach();
   return {pass:true,stage,entries:420,hotLimit:12,resident:history.status.residentRecords,foregroundMs,coldUndoRedoEach:420};
  }
  if(stage==='spill-reopen') {
   const restored=await AsyncHistory.open(doc,storage,initial);
   equal(doc.toString(),expected(420).text,'spill new process reopen');
   equal(restored.selection,expected(420).selection,'spill saved selection');
   assert(await restored.undo(),'spill restart undo');
   assert(await restored.redo(),'spill restart redo');
   return {pass:true,stage,index:restored.index,entries:await storage.count(),reopened:true};
  }
  throw Error('unknown spill stage');
 }finally{storage.close();}
}
const stage=new URL(location.href).searchParams.get('stage');
try {document.getElementById('result').textContent=JSON.stringify(await (stage.startsWith('spill-')?runSpill(stage):stage.startsWith('background-')?runBackground(stage):run(stage)));}
catch(error){document.getElementById('result').textContent=JSON.stringify({pass:false,stage,error:String(error),stack:String(error?.stack??'')});}
