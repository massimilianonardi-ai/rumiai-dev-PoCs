import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlatDocument, ChunkedPieceDocument, LocalRepackDocument, AdaptiveRepackDocument} from '../src/documents.mjs';
import {CompactHistory} from '../src/compact-history.mjs';
import {NodeFileJournal} from '../adapters/node-file-journal.mjs';
const random=(seed)=>()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const strings=['','W','😀','\r\n','猫','e\u0301','\t','\nlonger word'];
const init='alphabet\n你好\t😀\n'.repeat(70);
for (const Candidate of [LocalRepackDocument, AdaptiveRepackDocument]) {
 const flat=new FlatDocument(init), repack=new Candidate(init,128);
 const next=random(0xbafeca11);
 for(let i=0;i<9000;i++){
  const a=next()%(flat.length+1),b=Math.min(flat.length,a+next()%60),s=strings[next()%strings.length];
  flat.replace(a,b,s);repack.replace(a,b,s);
  if(i%31===0){
   assert.equal(repack.toString(),flat.toString(),'text at step '+i);
   assert.equal(repack.lineCount,flat.lineCount,'line count '+i);
   const line=next()%flat.lineCount;assert.equal(repack.lineStart(line),flat.lineStart(line));
   const p=next()%(flat.length+1),q=p+next()%(flat.length-p+1);assert.equal(repack.slice(p,q),flat.slice(p,q));
  }
 }
 assert.equal(repack.toString(),flat.toString());
 assert.ok(repack.stats().repackedUnits<=repack.stats().repackCount*512);
}
// Deleting large spans must not rematerialize the deleted payload in the
// repack algorithm (history deletion is deliberately measured separately).
for (const Candidate of [LocalRepackDocument, AdaptiveRepackDocument]) {
 const document=new Candidate('A'.repeat(2*1048576)+'\nEND');
 document.replace(20,2*1048576,'!');
 assert.equal(document.toString(),'A'.repeat(20)+'!\nEND');
 assert.ok(document.stats().repackedUnits<1000);
}
const temp=mkdtempSync(join(tmpdir(),'rumiai-journal-'));
try{
 const prefix=join(temp,'history');const storage=new NodeFileJournal(prefix);
 const original=new ChunkedPieceDocument(init), doc=new AdaptiveRepackDocument(init,128);
 const initial={primary:1,ranges:[{anchor:3,head:1,virtualColumn:9},{anchor:5,head:5,virtualColumn:2}]};
 const reference=new CompactHistory(original,initial),journal=new CompactHistory(doc,initial,storage);
 const r=random(0xf00dbabe),snapshots=[{text:init,selection:initial}];
 for(let i=0;i<750;i++){
  const p=r()%(doc.length+1),remove=Math.min(doc.length-p,r()%11);
  const q=Math.min(doc.length,p+remove+r()%9),edits=[{start:p,end:p+remove,insert:strings[r()%strings.length]},{start:q,end:q,insert:strings[r()%strings.length]}];
  const after={primary:i%2,ranges:[{anchor:i%100,head:i%91,virtualColumn:i%39},{anchor:i%57,head:i%37,virtualColumn:i%17}]};
  reference.commit(edits,after);journal.commit(edits,after);
  assert.equal(doc.toString(),original.toString(),'commit '+i);
  snapshots.push({text:original.toString(),selection:after});
 }
 assert.equal(storage.length,750);
 storage.sync();
 for(let i=749;i>=0;i--){
  assert.equal(journal.undo(),true);assert.equal(reference.undo(),true);
  assert.equal(doc.toString(),snapshots[i].text,'undo '+i);assert.deepEqual(journal.selection,snapshots[i].selection);
 }
 assert.equal(journal.undo(),false);
 for(let i=1;i<=750;i++){
  assert.equal(journal.redo(),true);assert.equal(reference.redo(),true);
  assert.equal(doc.toString(),snapshots[i].text,'redo '+i);assert.deepEqual(journal.selection,snapshots[i].selection);
 }
 for(let i=0;i<350;i++)journal.undo();
 journal.commit([{start:0,end:0,insert:'NEW BRANCH'}],{primary:0,ranges:[]});
 assert.equal(journal.redo(),false);assert.equal(storage.length,401);
 const beforeClose=storage.read(400);
 storage.sync();storage.close();
 const reopened=new NodeFileJournal(prefix,{create:false});
 assert.equal(reopened.length,401);assert.deepEqual(reopened.read(400),beforeClose);
 const last=reopened.read(400);assert.equal(last.after.primary,0);
 reopened.close();
 // A storage-append failure must leave document/selection unchanged on a
 // straightforward append. Not a proof of crash-atomic commit or redo safety.
 const failing={length:0,read:()=>{throw Error('unexpected read');},appendAt:()=>{throw Error('disk full');}};
 const guarded=new CompactHistory(new FlatDocument('safe'),initial,failing);
 assert.throws(()=>guarded.commit([{start:0,end:0,insert:'!'}]),/disk full/);
 assert.equal(guarded.document.toString(),'safe');assert.deepEqual(guarded.selection,initial);
 console.log(JSON.stringify({pass:true,randomRepackEdits:9000,journalTransactions:750,repackStrategies:[LocalRepackDocument.name,AdaptiveRepackDocument.name],diskBytesBeforeBranch:750,diskEntriesAfterBranch:reopened.length}));
}finally{rmSync(temp,{recursive:true,force:true});}
