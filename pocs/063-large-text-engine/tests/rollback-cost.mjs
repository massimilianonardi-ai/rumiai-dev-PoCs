// Exploratory benchmark of the *cost* of defensive multi-selection rollback.
// Uses real TextEditBase-compatible documents rather than mock stores.
// Results are not production/browser performance thresholds.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
const cases=[
  {type:FlatDocument,units:256*1024,counts:[32,256]},
  {type:PieceDocument,units:1024*1024,counts:[32,256]},
  {type:AdaptiveRepackDocument,units:1024*1024,counts:[32,256]}
];
const iterations=Number(process.argv[2]??12);
if(!Number.isSafeInteger(iterations)||iterations<4||iterations>80)throw new RangeError('iterations 4..80');
const text='a'.repeat(1024*1024);
const median=a=>{const s=a.toSorted((x,y)=>x-y);const n=s.length;return +(n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2).toFixed(3);};
const results=[];
let consumed=0;
for(const {type:Backend,units,counts} of cases){
 for(const count of counts){
  const ops=Array.from({length:count},(_,i)=>({
    start:(i+1)*Math.floor(units/(count+1)),
    end:(i+1)*Math.floor(units/(count+1))+1,
    insert:'X'
  }));
  const scenarios=['direct','capture','rollback'];
  const observations={direct:[],capture:[],rollback:[]};
  function execute(strategy,doc) {
    if(strategy==='direct'){
      for(let i=ops.length-1;i>=0;i--){
        const {start,end,insert}=ops[i];doc.replace(start,end,insert);
      }
      return;
    }
    const previous=ops.map(e=>doc.slice(e.start,e.end));
    if(strategy==='capture'){
      for(let i=ops.length-1;i>=0;i--){
        const {start,end,insert}=ops[i];doc.replace(start,end,insert);
      }
      consumed+=previous.length;
      return;
    }
    const applied=[];
    try{
      for(let i=ops.length-1;i>=0;i--){
        const {start,end,insert}=ops[i];
        doc.replace(start,end,insert);
        applied.push({start,end:start+insert.length,insert:previous[i]});
      }
    }catch(error){
      try{
        for(let i=applied.length-1;i>=0;i--){
          const {start,end,insert}=applied[i];
          doc.replace(start,end,insert);
        }
      }catch(rollbackError){
        throw new AggregateError([error,rollbackError],'rollback failed');
      }
      throw error;
    }
    consumed+=applied.length;
  }
  // Alternating execution order reduces warming and GC bias.
  // Constructor and input generation are excluded from timed region.
  for(let trial=0;trial<iterations+4;trial++){
    const order=trial%2?scenarios.toReversed():scenarios;
    for(const mode of order){
      global.gc?.();
      const doc=new Backend(text.slice(0,units));
      const started=performance.now();
      execute(mode,doc);
      const ms=performance.now()-started;
      assert.equal(doc.length,units);
      if(trial===0 || trial===iterations+3){
        for(const {start} of ops)assert.equal(doc.slice(start,start+1),'X');
      }
      if(trial>=4)observations[mode].push(ms);
    }
  }
  const m=Object.fromEntries(scenarios.map(k=>[k,median(observations[k])]));
  const extraCapture=+(100*(m.capture-m.direct)/(m.direct||1)).toFixed(1);
  const extraGuard=+(100*(m.rollback-m.capture)/(m.capture||1)).toFixed(1);
  results.push({backend:Backend.name,documentKiB:units/1024,selections:count,
    medianMs:m,captureOverDirectPct:extraCapture,guardOverCapturePct:extraGuard,
    measurementsPerScenario:iterations});
 }
}
assert(consumed>0);
for(const row of results)console.log(JSON.stringify({pass:true,...row}));
console.log(JSON.stringify({pass:true,scope:'exploratory performance only',
  measures:'single-range edits on actual PoC backends',
  rollbackGuarantee:'only for backend failure before mutation',
  excluded:'DOM, keyboard, selection updates, snapshots, user-device timing',
  host:'Node '+process.version+' '+process.platform+'/'+process.arch}));
