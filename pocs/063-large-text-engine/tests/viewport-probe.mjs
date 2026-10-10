import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {projectViewport} from '../src/viewport-probe.mjs';

const opts={rowHeight:24,height:440,overscan:4,maxLineUnits:512};
for(const Doc of [PieceDocument,AdaptiveRepackDocument]){
  const doc=new Doc('a\t😀e\u0301漢Z\r\nx\n\n'+'q'.repeat(2*1024*1024)+'\nlast');
  assert.equal(doc.lineCount,5);
  const p=projectViewport(doc,{...opts,scrollTop:0});
  assert.equal(p.rows[0].content,'a\t😀e\u0301漢Z');
  assert.equal(p.rows[0].textEnd,9);
  assert.equal(p.rows[1].content,'x');
  assert.equal(p.rows[2].content,'');
  assert.equal(p.rows[3].truncated,true);
  assert.equal(p.rows[3].content.length,512);
  assert.equal(p.rows[4].content,'last');
  assert.ok(p.readUnits<=5*512);
  assert.throws(()=>projectViewport(doc,{...opts,rowHeight:0}),/viewport/);
  assert.throws(()=>projectViewport(doc,{...opts,maxLineUnits:0}),/viewport/);
  assert.throws(()=>projectViewport(doc,{...opts,scrollTop:-1}),/viewport/);
  assert.throws(()=>projectViewport(doc,{...opts,overscan:-2}),/viewport/);
}
const N=200000;
const lines=new Array(N);
for(let i=0;i<N;i++)lines[i]=
  i%97===0?'line-'+String(i).padStart(6,'0')+'\t😀e\u0301漢Z':
    'line-'+String(i).padStart(6,'0')+' test ASCII';
const doc=new PieceDocument(lines.join('\n'));
assert.equal(doc.lineCount,N);
let calls=0,requestedUnits=0,maxSlice=0;
const instrument={
  get length(){return doc.length;},
  get lineCount(){return doc.lineCount;},
  lineStart:i=>doc.lineStart(i),
  slice:(a,b)=>{
    calls++;requestedUnits+=b-a;maxSlice=Math.max(maxSlice,b-a);
    return doc.slice(a,b);
  }
};
const before=performance.now();
let maxRows=0,maxRead=0;
for(let n=0;n<600;n++){
  const startLine=Math.floor((N-20)*((n*9973)%N)/N);
  const p=projectViewport(instrument,{
    ...opts,scrollTop:startLine*opts.rowHeight
  });
  maxRows=Math.max(maxRows,p.rows.length);
  maxRead=Math.max(maxRead,p.readUnits);
  assert.ok(p.rows.length<=Math.ceil(opts.height/opts.rowHeight)+
    opts.overscan*2+1);
  for(const r of p.rows){
    assert.equal(r.content,lines[r.row],'unmodified visible document slice');
    assert.ok(r.content.length<=512);
  }
}
const elapsedMs=performance.now()-before;
assert.ok(maxSlice<=512,'must never slice entire giant/unselected lines');
assert.ok(requestedUnits<=600*(maxRows*514),
  'UTF-16 reads must scale only with visible rows');
const tail=projectViewport(instrument,{
  ...opts,scrollTop:(N-1)*opts.rowHeight
});
assert.equal(tail.rows.at(-1).row,N-1);
const base=doc.lineStart(100000);
doc.replace(base+5,base+5,'★');
const after=projectViewport(doc,{
  ...opts,scrollTop:100000*opts.rowHeight
});
assert.equal(after.rows.find(r=>r.row===100000).content,lines[100000].slice(0,5)+'★'+lines[100000].slice(5));
console.log(JSON.stringify({pass:true,engines:['PieceDocument','AdaptiveRepackDocument'],
  corpusRows:N,passes:600,elapsedMs:+elapsedMs.toFixed(2),
  maximumProjectedRows:maxRows,maximumReadUnits:maxRead,
  maximumSourceSliceUnits:maxSlice,sourceSliceCalls:calls,
  measuredNotAStableLatencyGuarantee:true}));
