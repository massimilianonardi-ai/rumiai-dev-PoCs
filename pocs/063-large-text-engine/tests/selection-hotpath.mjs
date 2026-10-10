// PoC 063: comparative selection-layer hot-path measurements, no thresholds.
// Real FlatDocument / PieceDocument / AdaptiveRepackDocument instances only.
// Backend construction, selection setup, and explicit GC are excluded from time.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';

const trials=Number(process.argv[2]??9);
if(!Number.isSafeInteger(trials)||trials<5||trials>40)throw RangeError('trials 5..40');
const cases=[
  {Backend:FlatDocument,kib:256,count:32},
  {Backend:FlatDocument,kib:256,count:256},
  {Backend:PieceDocument,kib:4096,count:32},
  {Backend:PieceDocument,kib:4096,count:256},
  {Backend:PieceDocument,kib:4096,count:2048},
  {Backend:AdaptiveRepackDocument,kib:4096,count:32},
  {Backend:AdaptiveRepackDocument,kib:4096,count:256},
  {Backend:AdaptiveRepackDocument,kib:4096,count:2048}
];
const source='x'.repeat(4096*1024);
const median=values=>{
  const a=values.toSorted((x,y)=>x-y),i=a.length>>1;
  return Number((a.length%2?a[i]:(a[i-1]+a[i])/2).toFixed(4));
};
const results=[];
for(const {Backend,kib,count} of cases){
  const size=kib*1024, step=Math.floor(size/(count+1));
  const offsets=Array.from({length:count},(_,i)=>(i+1)*step);
  // The selection layer must preserve user order, even when it is reverse
  // physical document order. Same payload is used for each replacement.
  const selections=offsets.toReversed().map(at=>({start:at,end:at+1,forward:true}));
  const data={raw:[],selections:[]};
  for(let run=0;run<trials+3;run++){
    for(const kind of run%2?['selections','raw']:['raw','selections']){
      global.gc?.();
      const document=new Backend(source.slice(0,size));
      const editor=kind==='selections'?new TextEditSelections(document):null;
      editor?.setSelections(selections);
      const start=performance.now();
      if(kind==='raw'){
        // Capture overwritten data, as the selection layer also does.
        const removed=offsets.map(at=>document.slice(at,at+1));
        for(let i=offsets.length-1;i>=0;i--)document.replace(offsets[i],offsets[i]+1,'q');
        assert.equal(removed.length,count);
      }else{
        const result=editor.replace('q');
        assert.equal(result.changes.length,count);
      }
      const elapsed=performance.now()-start;
      assert.equal(document.length,size);
      // Outside the measured region, check representative edits.
      if(run===0||run===trials+2){
        for(const idx of [0,count>>1,count-1])
          assert.equal(document.slice(offsets[idx],offsets[idx]+1),'q');
      }
      if(run>=3)data[kind].push(elapsed);
    }
  }
  const direct=median(data.raw),selected=median(data.selections);
  results.push({
    backend:Backend.name,documentKiB:kib,selectedRanges:count,
    directWithOldTextMs:direct,selectionReplaceMs:selected,
    extraMs:+(selected-direct).toFixed(4),
    ratio:direct>0?+(selected/direct).toFixed(2):null,
    trials
  });
}
for(const item of results)console.log(JSON.stringify({pass:true,...item}));
console.log(JSON.stringify({pass:true,scope:'exploratory only; no performance gate',
  note:'selection replacement includes planning, validation, snapshots and result; direct baseline captures old spans',
  excludes:'DOM, UI, undo writer/persistence, input event handling, backend construction, GC',
  platform:process.platform+'/'+process.arch,Node:process.version}));
