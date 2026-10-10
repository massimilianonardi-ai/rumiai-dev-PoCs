// PoC 063: full selected-line cost; NOT a product performance contract.
// Each memory experiment runs in its own Node child process. RSS is a process
// high-water mark; retained heap is GC-sampled and may differ with V8/host.
// Time trials compare direct TextEditBase replacements (with old text capture)
// and TextEditSelections in one process, alternating order; no DOM measured.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';
import {probeLine,locateColumn} from '../src/visual-column-probe.mjs';

const backends={
  native:null,flat:FlatDocument,piece:PieceDocument,adaptive:AdaptiveRepackDocument
};
const median=values=>{
  const a=values.toSorted((x,y)=>x-y),i=a.length>>1;
  return +(a.length%2?a[i]:(a[i-1]+a[i])/2).toFixed(3);
};
const gc=()=>{global.gc?.();global.gc?.();};
const memory=()=>{const x=process.memoryUsage();return {
  heapUsedMiB:+(x.heapUsed/1048576).toFixed(3),
  rssMiB:+(x.rss/1048576).toFixed(3),
  externalMiB:+(x.external/1048576).toFixed(3),
  peakRssMiB:process.platform==='linux'
    ?+(process.resourceUsage().maxRSS/1024).toFixed(3):null
};};
function fixture(name,miB,count){
  const Backend=backends[name];
  assert.ok(Object.hasOwn(backends,name));
  const bytes=miB*1048576;
  assert.ok(bytes%count===0);
  const source='v'.repeat(bytes)+'\nEND';
  assert.equal(source.charCodeAt(bytes-1),118);
  let native=source;
  const doc=Backend?new Backend(source):{
    get length(){return native.length;},
    slice(a,b){return native.slice(a,b);},
    replace(a,b,s){native=native.slice(0,a)+s+native.slice(b);}
  };
  const unit=bytes/count;
  // Reverse USER ordering stresses the selection layer's physical sorting.
  const ranges=Array.from({length:count},(_,i)=>{
    const j=count-i-1;
    return {start:j*unit,end:(j+1)*unit,forward:true};
  });
  return {doc,ranges,bytes,count,getNative:()=>native,setNative:v=>{native=v;}};
}
function perform(f,editor){
  if(editor){
    const change=editor.replace('q');
    assert.equal(change.changes.length,f.count);
    assert.equal(change.changes.reduce((n,x)=>n+x.removed.length,0),f.bytes);
    return change;
  }
  // All old spans are captured before edits, as in the selection layer.
  const old=f.ranges.map(r=>f.doc.slice(r.start,r.end));
  for(const r of f.ranges)f.doc.replace(r.start,r.end,'q');
  assert.equal(old.reduce((n,s)=>n+s.length,0),f.bytes);
  return old;
}
function validate(f){
  assert.equal(f.doc.length,f.count+4);
  assert.equal(f.doc.slice(0,f.count),'q'.repeat(f.count));
  assert.equal(f.doc.slice(f.count,f.doc.length),'\nEND');
}
function childEdit(name,miB,count,mode,trials){
  if(mode==='timing'){
    const values={direct:[],selected:[]};
    for(let i=0;i<trials+2;i++){
      for(const method of (i%2?['selected','direct']:['direct','selected'])){
        gc();
        const f=fixture(name,miB,count);
        const editor=method==='selected'?new TextEditSelections(f.doc):null;
        editor?.setSelections(f.ranges);
        // Both paths exclude document and selection setup. Raw includes
        // old text capture; selected includes inverse capture and mapping.
        const started=performance.now();
        const keep=perform(f,editor);
        const elapsed=performance.now()-started;
        validate(f);
        assert.ok(keep);
        if(i>=2)values[method].push(elapsed);
      }
    }
    return {kind:'edit-timing',backend:name,selectedMiB:miB,
      selectedRanges:count,trials,directMedianMs:median(values.direct),
      selectionMedianMs:median(values.selected)};
  }
  assert.ok(mode==='direct'||mode==='selected');
  const f=fixture(name,miB,count);
  const editor=mode==='selected'?new TextEditSelections(f.doc):null;
  editor?.setSelections(f.ranges);
  gc();const pre=memory();
  const started=performance.now();
  const keep=perform(f,editor);
  const elapsedMs=+(performance.now()-started).toFixed(3);
  validate(f);
  gc();const post=memory();
  assert.ok(keep);
  return {kind:'edit-memory',backend:name,selectedMiB:miB,
    selectedRanges:count,method:mode,pre,post,
    heapDeltaMiB:+(post.heapUsedMiB-pre.heapUsedMiB).toFixed(3),
    rssDeltaMiB:+(post.rssMiB-pre.rssMiB).toFixed(3),elapsedMs};
}
function childVisual(name,miB){
  const f=fixture(name,miB,1);
  gc();const pre=memory();
  const started=performance.now();
  // The current candidate materializes one cell per grapheme on the entire
  // SELECTED huge line, even when locating column 2 near its beginning.
  const geometry=probeLine(f.doc,0,{widthOf:()=>1});
  const elapsedMs=+(performance.now()-started).toFixed(3);
  assert.equal(geometry.columns,f.bytes);
  assert.equal(geometry.cells.length,f.bytes);
  assert.deepEqual(locateColumn(geometry,2),{
    kind:'exact',offset:2,virtualSpaces:0
  });
  gc();const post=memory();
  assert.equal(geometry.cells[geometry.cells.length-1].end,f.bytes);
  return {kind:'visual-geometry',backend:name,selectedMiB:miB,
    cells:geometry.cells.length,pre,post,elapsedMs,
    heapDeltaMiB:+(post.heapUsedMiB-pre.heapUsedMiB).toFixed(3),
    rssDeltaMiB:+(post.rssMiB-pre.rssMiB).toFixed(3)};
}
if(process.argv[2]==='--child'){
  const [kind,backend,sizeStr,countStr,mode,trialsStr]=process.argv.slice(3);
  const miB=Number(sizeStr),count=Number(countStr),trials=Number(trialsStr);
  assert.ok(Number.isSafeInteger(miB)&&miB>=1&&miB<=32);
  assert.ok(Number.isSafeInteger(count)&&count>=1&&count<=1024);
  let result;
  if(kind==='edit')result=childEdit(backend,miB,count,mode,trials);
  else if(kind==='visual')result=childVisual(backend,miB);
  else throw RangeError('kind');
  console.log(JSON.stringify({pass:true,...result,node:process.version,
    platform:process.platform+'/'+process.arch}));
}else{
  const trials=Number(process.argv[2]??5);
  assert.ok(Number.isSafeInteger(trials)&&trials>=5&&trials<=15,
    'trials must be 5..15');
  function run(kind,backend,miB,count,mode){
    const p=spawnSync(process.execPath,['--expose-gc','--max-old-space-size=768',
      new URL(import.meta.url).pathname,'--child',kind,backend,String(miB),
      String(count),mode,String(trials)],{
      encoding:'utf8',timeout:100000,maxBuffer:1048576
    });
    if(p.status!==0 || p.error)throw Error(
      JSON.stringify({kind,backend,miB,count,mode,status:p.status,
        signal:p.signal,error:String(p.error),stderr:p.stderr.slice(-1200),
        stdout:p.stdout.slice(-600)}));
    const result=JSON.parse(p.stdout.trim());
    assert.equal(result.pass,true);
    return result;
  }
  // Whole selected line (one range) and a many-range partition of a single
  // long logical line are different stress regimes.
  for(const backend of Object.keys(backends)){
    for(const {miB,count} of [
      {miB:4,count:1},{miB:4,count:64},{miB:16,count:1}
    ]){
      const timing=run('edit',backend,miB,count,'timing');
      const raw=run('edit',backend,miB,count,'direct');
      const selected=run('edit',backend,miB,count,'selected');
      console.log(JSON.stringify({pass:true,...timing,
        directRetained:raw.post,selectionRetained:selected.post,
        directHeapDeltaMiB:raw.heapDeltaMiB,
        selectionHeapDeltaMiB:selected.heapDeltaMiB,
        directRssDeltaMiB:raw.rssDeltaMiB,
        selectionRssDeltaMiB:selected.rssDeltaMiB}));
    }
  }
  for(const backend of ['flat','adaptive']){
    for(const size of [1,2]){
      // Full grapheme geometry creates size*1048576 retained cell objects.
      console.log(JSON.stringify(run('visual',backend,size,1,'geometry')));
    }
  }
  console.log(JSON.stringify({pass:true,scope:'exploratory selected-line stress',
    trials,execution:'isolated child processes for memory, paired alternating timing',
    evidence:'real store implementations and actual Intl.Segmenter geometry',
    memory:'MiB, sampled after explicit GC; maxRSS is lifetime high-water (Linux)',
    excludes:'browser viewport and DOM, native GUI, undo storage/persistence',
    limitation:'different child RSS measurements are not perfectly matched peaks'}));
}