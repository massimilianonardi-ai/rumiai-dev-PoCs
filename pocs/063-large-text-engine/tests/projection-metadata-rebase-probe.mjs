import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';
import {createDocumentProjection} from '../src/document-projection-probe.mjs';
import {resolveVisibleLineSelection} from '../src/advanced-selection-probe.mjs';
import {captureProjectionMetadata,rebaseProjectionMetadata}
  from '../src/projection-metadata-rebase-probe.mjs';

const caret=start=>({start,end:start,forward:true});
function edit(doc,selections,strings){
  const editor=new TextEditSelections(doc);
  editor.setSelections(selections);
  return editor.replace(strings).changes;
}
let backendCases=0,uncertain=0;
for(const Store of [FlatDocument,PieceDocument,AdaptiveRepackDocument]){
  const initial='top\n😀 e\u0301\nfold header\nhidden\nbottom\nend';
  const fold=[{from:2,to:3}];

  // Inserting an entire logical line before the fold must move its two
  // endpoints and every surviving anchor without touching the hidden rows.
  {
    const doc=new Store(initial);
    const hidden=doc.lineStart(3)+1;
    const snapshot=captureProjectionMetadata(doc,{
      folds:fold,annotations:[
        {id:'left',at:0,text:'left',affinity:'before'},
        {id:'right',at:0,text:'right',affinity:'after'},
        {id:'unknown',at:0,text:'needs choice'},
        {id:'hidden',at:hidden,text:'hidden note'},
        {id:'tail',at:doc.length,text:'EOF'}
      ]
    });
    const changes=edit(doc,[caret(0)],'new\n');
    const result=rebaseProjectionMetadata(snapshot,doc,changes);
    assert.deepEqual(result.folds,[{from:3,to:4}]);
    assert.deepEqual(result.unresolved,[{
      kind:'annotation',id:'unknown',reason:'insertion-affinity-required'
    }]);
    const byId=Object.fromEntries(result.annotations.map(note=>[note.id,note.at]));
    assert.equal(byId.left,0);
    assert.equal(byId.right,4);
    assert.equal(byId.hidden,hidden+4);
    assert.equal(byId.tail,doc.length);
    const view=createDocumentProjection(doc,result);
    assert.equal(view.visibleLineCount,doc.lineCount-1);
    assert.equal(view.sourceToView(byId.hidden).kind,'folded-region');
    assert.equal(view.projectWindow({from:3,count:1}).rows[0]
      .parts.find(p=>p.kind==='fold').hiddenAnnotations,1);
    assert.equal(resolveVisibleLineSelection(doc,view,{
      from:3,to:3,includeFolded:true
    })[0].end,doc.lineStart(5));
    backendCases++;
  }

  // Two physically non-overlapping multicaret edits in reverse caller order
  // are replayed from the complete TextEditSelections result, not listeners.
  {
    const doc=new Store(initial);
    const mid=doc.lineStart(2),after=doc.lineStart(4);
    const snapshot=captureProjectionMetadata(doc,{
      folds:fold,
      annotations:[{id:'last',at:doc.length,text:'last'}]
    });
    const changes=edit(doc,[caret(after),caret(0)],['X','Q\n']);
    assert.deepEqual(changes.map(c=>c.start),[0,after]);
    const result=rebaseProjectionMetadata(snapshot,doc,changes);
    assert.deepEqual(result.folds,[{from:3,to:4}]);
    assert.equal(result.annotations[0].at,doc.length);
    assert.equal(result.unresolved.length,0);
    assert.equal(doc.slice(doc.lineStart(3),doc.lineStart(4)),'fold header\n');
    backendCases++;
  }

  // Metadata can survive an append at its exact anchor only with an explicit
  // insertion affinity. The source document itself stays authoritative.
  {
    const doc=new Store(initial);
    const end=doc.length;
    const snapshot=captureProjectionMetadata(doc,{
      folds:fold,annotations:[
        {id:'before',at:end,text:'before',affinity:'before'},
        {id:'after',at:end,text:'after',affinity:'after'},
        {id:'unknown',at:end,text:'no affinity'}
      ]
    });
    const changes=edit(doc,[caret(end)],'!\nextra');
    const result=rebaseProjectionMetadata(snapshot,doc,changes);
    assert.deepEqual(result.folds,fold);
    assert.deepEqual(result.annotations.map(a=>[a.id,a.at]),
      [['before',end],['after',doc.length]]);
    assert.equal(result.unresolved[0].reason,'insertion-affinity-required');
    backendCases++;
  }

  // Modified fold content is not guessed back into a logical region:
  // caller must recompute/discard that fold. Replaced annotations are lost
  // explicitly rather than silently snapping to nearby characters.
  {
    const doc=new Store(initial);
    const inside=doc.lineStart(3)+2;
    const other=doc.lineStart(4)+2;
    const snapshot=captureProjectionMetadata(doc,{
      folds:fold,annotations:[
        {id:'inside',at:inside,text:'inside'},
        {id:'other',at:other,text:'other'}
      ]
    });
    const changes=edit(doc,[{start:inside-1,end:inside+1,forward:true}],'!');
    const result=rebaseProjectionMetadata(snapshot,doc,changes);
    assert.deepEqual(result.folds,[]);
    assert.equal(result.unresolved.some(x=>
      x.kind==='fold'&&x.reason==='fold-content-modified'),true);
    assert.equal(result.unresolved.some(x=>
      x.kind==='annotation'&&x.id==='inside'&&
      x.reason==='source-anchor-replaced'),true);
    assert.equal(result.annotations[0].at,other-1);
    uncertain++;
    backendCases++;
  }

  // Removing the LF directly before a fold destroys its true line-start
  // boundary, even though all changes are outside the folded source span.
  {
    const doc=new Store(initial);
    const snapshot=captureProjectionMetadata(doc,{folds:fold});
    const end=doc.lineStart(2);
    const changes=edit(doc,[{start:end-1,end,forward:true}],'');
    const result=rebaseProjectionMetadata(snapshot,doc,changes);
    assert.deepEqual(result.folds,[]);
    assert.equal(result.unresolved[0].reason,'fold-boundary-not-preserved');
    uncertain++;
    backendCases++;
  }

  // The last folded row extends to EOF. Appending there modifies its content;
  // merely shifting its indices would be an unsafe invented fold meaning.
  {
    const doc=new Store(initial);
    const snapshot=captureProjectionMetadata(doc,{
      folds:[{from:4,to:5}]
    });
    const changes=edit(doc,[caret(doc.length)],'!');
    const result=rebaseProjectionMetadata(snapshot,doc,changes);
    assert.deepEqual(result.folds,[]);
    assert.equal(result.unresolved[0].reason,'fold-content-modified');
    uncertain++;
    backendCases++;
  }

  // Adjacent edits and no-op metadata sets are valid; spoofed length/line
  // revisions and duplicated operations cannot silently rebase metadata.
  {
    const doc=new Store('a\nb\nc\nd');
    const snapshot=captureProjectionMetadata(doc,{
      annotations:[{id:'last',at:doc.length,text:'last'}]
    });
    const changes=edit(doc,[
      {start:0,end:1,forward:true},
      {start:1,end:2,forward:true}
    ],['A','\n']);
    const result=rebaseProjectionMetadata(snapshot,doc,changes);
    assert.deepEqual(result.unresolved,[]);
    assert.equal(result.annotations[0].at,doc.length);
    assert.throws(()=>rebaseProjectionMetadata(snapshot,doc,[
      ...changes,changes[0]
    ]),/overlapping\/duplicate/);
    assert.throws(()=>rebaseProjectionMetadata(snapshot,new Store('other'),changes),
      /revision/);
    backendCases++;
  }

  // One edit at a note position with no affinity is unresolved; never
  // invent a default interpretation for the anchor.
  {
    const doc=new Store('abcd');
    const snapshot=captureProjectionMetadata(doc,{
      annotations:[{id:'n',at:2,text:'note'}]
    });
    const changes=edit(doc,[caret(2)],'!');
    const result=rebaseProjectionMetadata(snapshot,doc,changes);
    assert.deepEqual(result.annotations,[]);
    assert.deepEqual(result.unresolved,[{
      kind:'annotation',id:'n',reason:'insertion-affinity-required'
    }]);
    backendCases++;
  }
}

// Workload: no full text materialization for 200k indexed lines and a 2 MiB
// folded giant line. Metadata rebasing scales by edits and metadata count
// in this candidate, rather than source file length.
{
  const N=200000,lines=Array.from({length:N},(_,i)=>
    i===100000?'G'.repeat(2*1024*1024):'line-'+String(i).padStart(6,'0'));
  const doc=new PieceDocument(lines.join('\n'));
  const folds=[{from:50000,to:150000}];
  const annotations=Array.from({length:2400},(_,i)=>({
    id:'note-'+i,
    at:doc.lineStart((i*79)%N)+1,
    text:'annotation '+i
  }));
  let sliceCalls=0;
  const observed={
    get length(){return doc.length;},
    get lineCount(){return doc.lineCount;},
    lineStart:(row)=>doc.lineStart(row),
    slice:(a,b)=>{sliceCalls++;return doc.slice(a,b);}
  };
  const captured=captureProjectionMetadata(observed,{folds,annotations});
  const changed=edit(doc,[caret(0)],'preface\n');
  const start=performance.now();
  const updated=rebaseProjectionMetadata(captured,observed,changed);
  const elapsedMs=performance.now()-start;
  assert.deepEqual(updated.folds,[{from:50001,to:150001}]);
  assert.equal(updated.annotations.length,annotations.length);
  assert.equal(updated.unresolved.length,0);
  assert.equal(sliceCalls,0,'rebase does not read or copy giant text');
  assert.equal(updated.annotations.at(-1).at,annotations.at(-1).at+8);
  const p=createDocumentProjection(observed,updated);
  assert.equal(p.sourceToView(doc.lineStart(100001)).kind,'folded-region');
  // Many disjoint changes in one confirmed TextEditSelections operation:
  // verify every annotation offset against an independent naive mapping.
  const secondCapture=captureProjectionMetadata(observed,updated);
  const caretPositions=Array.from({length:160},(_,i)=>{
    const row=i<80?20+i*490:170000+(i-80)*320;
    return doc.lineStart(row)+2;
  });
  const multiChanges=edit(doc,caretPositions.toReversed().map(caret),'*');
  const secondStart=performance.now();
  const second=rebaseProjectionMetadata(secondCapture,observed,multiChanges);
  const manyEditMs=performance.now()-secondStart;
  assert.deepEqual(second.folds,updated.folds);
  assert.equal(second.annotations.length,annotations.length);
  assert.equal(second.unresolved.length,0);
  for(let i=0;i<second.annotations.length;i++){
    const oldAt=updated.annotations[i].at;
    const expected=oldAt+multiChanges.filter(c=>c.start<oldAt).length;
    assert.equal(second.annotations[i].at,expected);
  }
  assert.equal(sliceCalls,0,'neither metadata rebase reads source text');
  console.log(JSON.stringify({manyEditCount:multiChanges.length,
    manyEditAnnotations:second.annotations.length,
    manyEditRebaseMs:+manyEditMs.toFixed(2),
    measuredNotAStableLatencyGuarantee:true}));
  console.log(JSON.stringify({largeDocumentLines:N,metadata:annotations.length,
    rebasedFolds:updated.folds.length,sourceSliceCalls:sliceCalls,
    elapsedMs:+elapsedMs.toFixed(2),singleRunnerNotLatencyGuarantee:true}));
}

console.log(JSON.stringify({pass:true,realBackends:3,backendCases,
  deliberatelyUnresolved:uncertain,sourceInvariant:true,
  rebasedSourceAnchors:true,explicitAffinity:true,
  hiddenFoldInvalidation:true,noListeners:true,noDOM:true,noHistory:true}));
