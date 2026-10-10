// PoC 063: within-run paired comparison for bulk EOF column growth.
// Planning, raw one-range edits, and TextEditSelections are measured separately.
// Native string edits do not run through a document adapter in the direct case.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';
import {planColumnPaste} from '../src/column-edit-probe.mjs';

const trials=Number(process.argv[2]??9);
if(!Number.isSafeInteger(trials)||trials<5||trials>20)
  throw new RangeError('trials 5..20');
const base='x'.repeat(4*1024*1024)+'\n'+Array(12).fill('a').join('\n');
const rectangle={lineFrom:10,lineTo:11,columnFrom:1,columnTo:1};
const clipboard=Array.from({length:128},(_,i)=>'Z'+i).join('\n');
const options={rectangle,clipboard,materializeRows:true,tabSize:4,widthOf:()=>1};
const median=xs=>{
  const sorted=xs.toSorted((a,b)=>a-b),n=sorted.length;
  return +(n%2?sorted[n>>1]:(sorted[(n>>1)-1]+sorted[n>>1])/2).toFixed(4);
};

function make(Backend){
  if(Backend)return {document:new Backend(base),native:null};
  let value=base;
  const document={
    get length(){return value.length;},
    get lineCount(){return 1+(value.match(/\n/g)?.length??0);},
    lineStart(line){
      if(!Number.isSafeInteger(line)||line<0||line>=this.lineCount)
        throw new RangeError('line');
      let pos=-1;
      for(let i=0;i<line;i++)pos=value.indexOf('\n',pos+1);
      return pos+1;
    },
    slice(start,end){return value.slice(start,end);},
    replace(start,end,insert){value=value.slice(0,start)+insert+value.slice(end);}
  };
  return {document, native:{
    slice:(a,b)=>value.slice(a,b),
    replace:(a,b,insert)=>{value=value.slice(0,a)+insert+value.slice(b);}
  }};
}

for(const Backend of [null,FlatDocument,PieceDocument,AdaptiveRepackDocument]){
  const samples={plan:[],direct:[],selected:[]};
  const backend=Backend?.name??'NativeJavaScriptString';
  for(let t=0;t<trials+2;t++){
    // Alternating order reduces the impact of common JIT/GC drift.
    for(const kind of t%2?['selected','direct']:['direct','selected']){
      global.gc?.();
      const {document,native}=make(Backend);
      const p0=performance.now();
      const plan=planColumnPaste(document,options);
      const planning=performance.now()-p0;
      assert.equal(plan.materializedRows,125);
      assert.equal(plan.targetRows,128);
      assert.equal(plan.selections.length,3);
      const operations=plan.selections.map((s,i)=>({
        start:s.start,end:s.end,insert:plan.texts[i]
      })).sort((a,b)=>a.start-b.start||a.end-b.end);
      const editor=kind==='selected'?new TextEditSelections(document):null;
      editor?.setSelections(plan.selections);
      const started=performance.now();
      if(kind==='direct'){
        const originals=operations.map(op=>
          native?native.slice(op.start,op.end):document.slice(op.start,op.end));
        for(let i=operations.length-1;i>=0;i--){
          const op=operations[i];
          if(native) native.replace(op.start,op.end,op.insert);
          else document.replace(op.start,op.end,op.insert);
        }
        assert.equal(originals.length,3);
      }else{
        const applied=editor.replace(plan.texts);
        assert.equal(applied.changes.length,3);
      }
      const elapsed=performance.now()-started;
      // Semantic assertions outside the measured part.
      assert.equal(document.slice(document.length-5,document.length),' Z127');
      assert.equal(document.length,
        base.length+operations.reduce((n,op)=>n+op.insert.length-(op.end-op.start),0));
      if(t>=2){
        samples[kind].push(elapsed);
        samples.plan.push(planning);
      }
    }
  }
  const direct=median(samples.direct),selected=median(samples.selected);
  console.log(JSON.stringify({pass:true,backend,sourceMiB:4,
    sourceRows:128,newRows:125,primitiveEdits:3,trials,
    planMedianMs:median(samples.plan),directMedianMs:direct,
    selectionMedianMs:selected,selectionToDirectRatio:
      direct?+(selected/direct).toFixed(2):null}));
}
console.log(JSON.stringify({pass:true,scope:'within-run exploratory only',
  platform:process.platform+'/'+process.arch,node:process.version,
  excludes:'GC, backend construction, undo, persistence, native GUI/IME',
  notes:'4 MiB unselected prefix; source rows extend 125 lines; native raw uses JS slice and concatenation'}));
