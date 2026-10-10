import assert from 'node:assert/strict';
import {FlatDocument,PieceDocument,ChunkedPieceDocument} from '../src/documents.mjs';
import {History} from '../src/transactions.mjs';
import {CompactHistory} from '../src/compact-history.mjs';

function rng(seed){let v=seed>>>0;return ()=>{v^=v<<13;v^=v>>>17;v^=v<<5;return v>>>0;};}
const variants=[FlatDocument,PieceDocument,ChunkedPieceDocument];
const texts=['','A','\n','\r\n','e\u0301','😀','\tZ','XYZ'];
for(const T of variants){
  const flat=new FlatDocument('a\nb\n你好\n😀'.repeat(31));
  const doc=new T(flat.toString());
  const next=rng(0x12345);
  for(let i=0;i<6000;i++){
    const p=next()%(flat.length+1), end=Math.min(flat.length,p+next()%6), insert=texts[next()%texts.length];
    flat.replace(p,end,insert);doc.replace(p,end,insert);
    if(i%47===0){
      assert.equal(doc.toString(),flat.toString(),T.name+' mutation '+i);
      assert.equal(doc.lineCount,flat.lineCount,T.name+' line count '+i);
      const line=next()%flat.lineCount;
      assert.equal(doc.lineStart(line),flat.lineStart(line),T.name+' line '+line);
      const from=next()%(flat.length+1),to=from+next()%(flat.length-from+1);
      assert.equal(doc.slice(from,to),flat.slice(from,to),T.name+' slice');
    }
  }
  assert.equal(doc.toString(),flat.toString());
}
// Explicit edit coalescing scenarios; no more than one piece per uninterrupted
// sequential append chunk, and no copy of the whole document during compaction.
for(const kind of ['append','split','delete']) {
  const doc=new ChunkedPieceDocument('one\ntwo\n');
  if(kind==='append')for(let i=0;i<1024;i++)doc.replace(doc.length,doc.length,'x');
  if(kind==='split'){doc.replace(2,2,'K');doc.replace(3,3,'Z');doc.replace(0,1,'A');}
  if(kind==='delete'){doc.replace(0,4,'');doc.replace(0,0,'A');doc.replace(0,1,'');}
  if(kind==='append')assert.ok(doc.stats().nodes<=3,JSON.stringify(doc.stats()));
  if(kind==='split')assert.equal(doc.toString(),'AnKZe\ntwo\n');
  if(kind==='delete')assert.equal(doc.toString(),'two\n');
}
// Multi-range operation positions must be rebased correctly for inverse edits.
for(const Doc of variants){
 for(const Hist of [History,CompactHistory]){
  const initial={primary:1,ranges:[{anchor:1,head:3,virtualColumn:9},{anchor:7,head:7,virtualColumn:4}]};
  const document=new Doc('abcdefghij\n0123456789\n');
  const history=new Hist(document,initial);
  const base=document.toString();
  const next=rng(0xfe88);
  let baseline=base;
  const samples=[];
  for(let i=0;i<500;i++){
    const p=next()%(baseline.length+1),size=Math.min(baseline.length-p,next()%3);
    const q=Math.min(baseline.length,p+size+next()%4);
    const edits=[{start:p,end:p+size,insert:texts[next()%texts.length]}, {start:q,end:q,insert:'@'}];
    const after={primary:i%2,ranges:[{anchor:i%7,head:i%8,virtualColumn:i},{anchor:i+1,head:i+2,virtualColumn:2*i}]};
    // When p+size===q insert at same boundary; the experimental history
    // model accepts touching ranges and resolves them right-to-left.
    history.commit(edits,after);
    const ref=new FlatDocument(baseline);
    for(let k=edits.length-1;k>=0;k--)ref.replace(edits[k].start,edits[k].end,edits[k].insert);
    baseline=ref.toString();
    assert.equal(document.toString(),baseline,Doc.name+'/'+Hist.name+' commit '+i);
    assert.deepEqual(history.selection,after);
    samples.push({text:baseline,selection:after});
  }
  for(let i=499;i>=0;i--){assert.equal(history.undo(),true);assert.equal(document.toString(),i?samples[i-1].text:base);assert.deepEqual(history.selection,i?samples[i-1].selection:initial);}
  assert.equal(history.undo(),false);
  for(let i=0;i<500;i++){assert.equal(history.redo(),true);assert.equal(document.toString(),samples[i].text);assert.deepEqual(history.selection,samples[i].selection);}
  assert.equal(history.redo(),false);
  for(let i=0;i<100;i++)history.undo();
  history.commit([{start:0,end:0,insert:'BRANCH'}]);
  assert.equal(history.redo(),false);
 }
}
console.log(JSON.stringify({pass:true,documentClasses:variants.map(x=>x.name),historyClasses:[History.name,CompactHistory.name],randomDocumentEditsPerVariant:6000,historyTransactionsPerCombination:500}));
