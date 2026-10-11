import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';
import {createDocumentProjection} from '../src/document-projection-probe.mjs';
import {resolveVisibleLineSelection} from '../src/advanced-selection-probe.mjs';

// Same immutable source, two independent views. Folds affect representation,
// never physical bytes or the selections owned by TextEditSelections.
let cases=0;
for(const Store of [FlatDocument,PieceDocument,AdaptiveRepackDocument]){
  const lines=[
    'header',
    'x\t😀e\u0301漢Z',
    'hidden note line',
    'hidden last line',
    'tail'
  ];
  const original=lines.join('\n');
  const doc=new Store(original);
  const atHidden=doc.lineStart(2)+1;
  const noteAt=doc.lineStart(1)+2;
  const annotations=[
    {id:'inside',at:atHidden,text:'hidden diagnostic'},
    {id:'near',at:noteAt,text:'visible note'},
    {id:'end',at:doc.length,text:'EOF note'}
  ];
  const plain=createDocumentProjection(doc,{annotations});
  const folded=createDocumentProjection(doc,{
    folds:[{from:1,to:3}],annotations
  });
  assert.equal(doc.slice(0,doc.length),original,'projection does not mutate text');
  assert.equal(plain.visibleLineCount,5);
  assert.equal(folded.visibleLineCount,3);
  const all=plain.projectWindow({from:0,count:5});
  const view=folded.projectWindow({from:0,count:3});
  assert.deepEqual(all.rows.map(r=>r.logicalLine),[0,1,2,3,4]);
  assert.deepEqual(view.rows.map(r=>r.logicalLine),[0,1,4]);
  assert.equal(all.rows[2].parts.find(p=>p.kind==='annotation').label,'hidden diagnostic');
  const middle=view.rows[1];
  assert.equal(middle.parts[0].value,'x\t😀e\u0301漢Z');
  assert.deepEqual(middle.parts.map(p=>p.kind),['text','fold','annotation']);
  assert.equal(middle.parts[1].hiddenLines,2);
  assert.equal(middle.parts[1].hiddenAnnotations,1);
  assert.equal(middle.parts[2].anchor,noteAt);
  assert.equal(view.rows[2].parts.find(p=>p.id==='end').anchor,doc.length);
  assert.equal(view.readUnits,lines[0].length+lines[1].length+lines[4].length);

  const start=doc.lineStart(1);
  assert.deepEqual(middle.parts[0].graphemeBoundaries,
    [start,start+1,start+2,start+4,start+6,start+7,start+8]);
  assert.deepEqual(folded.viewToSource({viewLine:1,grapheme:3}),
    {kind:'offset',offset:start+4});
  assert.deepEqual(folded.viewToSource({viewLine:1,grapheme:4}),
    {kind:'offset',offset:start+6});
  assert.equal(folded.sourceToView(start+3).kind,'visible',
    'source offsets remain legal even inside surrogate pair');
  const hiddenSpan={
    start:doc.lineStart(2),
    end:doc.lineStart(4)
  };
  assert.deepEqual(folded.viewToSource({viewLine:1,part:'fold'}),
    {kind:'folded-region',source:hiddenSpan});
  assert.deepEqual(folded.sourceToView(atHidden),{
    kind:'folded-region',viewLine:1,source:hiddenSpan
  });
  assert.deepEqual(folded.viewToSource({viewLine:0,part:'fold'}),
    {kind:'unresolved',reason:'no-fold'});
  assert.deepEqual(folded.viewToSource({viewLine:1,grapheme:100}),
    {kind:'unresolved',reason:'grapheme-outside-line'});
  assert.deepEqual(resolveVisibleLineSelection(doc,folded,{from:1,to:2}),[
    {start:doc.lineStart(1),end:doc.lineStart(2),forward:true},
    {start:doc.lineStart(4),end:doc.length,forward:true}
  ]);
  assert.deepEqual(resolveVisibleLineSelection(doc,folded,{
    from:1,to:2,includeFolded:true
  }),[{start:doc.lineStart(1),end:doc.length,forward:true}]);
  assert.deepEqual(resolveVisibleLineSelection(doc,folded,{
    from:1,to:1,includeFolded:true
  }),[{start:doc.lineStart(1),end:doc.lineStart(4),forward:true}],
  'a selected folded header explicitly includes its hidden source interval');

  assert.throws(()=>createDocumentProjection(doc,{
    folds:[{from:0,to:2},{from:1,to:3}]
  }),/overlapping\/nested/);
  assert.throws(()=>createDocumentProjection(doc,{
    folds:[{from:3,to:3}]
  }),/invalid fold/);
  assert.throws(()=>folded.projectWindow({from:0,count:257}),/window/);
  assert.throws(()=>folded.viewLineToSource(3),/visible line/);

  // Selection translation is purely logical: the unchanged selection editor
  // edits only the two visible source lines. Hidden lines survive intact.
  const editor=new TextEditSelections(doc);
  editor.setSelections(resolveVisibleLineSelection(doc,folded,{from:1,to:2}));
  editor.replace(['REPLACED\n','AFTER']);
  assert.equal(doc.slice(0,doc.length),
    'header\nREPLACED\nhidden note line\nhidden last line\nAFTER');
  assert.equal(folded.projectWindow({from:1,count:2}).rows[0].parts[0].value,
    'REPLACED','source is projected again on demand, without listeners');
  const refreshed=createDocumentProjection(doc,{
    folds:[{from:1,to:3}],
    annotations:[{id:'end',at:doc.length,text:'EOF note'}]
  });
  assert.equal(refreshed.projectWindow({from:2,count:1}).rows[0].parts.at(-1).anchor,
    doc.length,'caller explicitly recreates annotation anchors after editing');
  cases++;
}

// Multiple folds: O(log fold-count) mapping in both directions.
{
  const doc=new PieceDocument(Array.from({length:10},(_,i)=>'line-'+i).join('\n'));
  const p=createDocumentProjection(doc,{
    folds:[{from:1,to:3},{from:6,to:8}]
  });
  assert.deepEqual(p.projectWindow({from:0,count:20}).rows.map(r=>r.logicalLine),
    [0,1,4,5,6,9]);
  assert.equal(p.viewLineToSource(5),9);
  assert.deepEqual(p.sourceLineToView(7),{
    kind:'folded',viewLine:4,
    fold:{from:6,to:8,viewHeader:4,hiddenThrough:4}
  });
  assert.deepEqual(p.sourceLineToView(9),{kind:'visible',viewLine:5});
  cases++;
}

// A clipped giant line has no executable caret mapping. Annotations are
// bounded per visible row, never confused with source characters.
{
  const big='A'.repeat(2*1024*1024);
  const doc=new PieceDocument('prefix\n'+big+'\nlast');
  const at=doc.lineStart(1);
  const p=createDocumentProjection(doc,{
    annotations:Array.from({length:50},(_,i)=>({
      id:'note-'+i,at:at+i,text:'note payload '+i
    }))
  });
  const row=p.projectWindow({from:1,count:1}).rows[0];
  assert.equal(row.parts[0].value.length,512);
  assert.equal(row.parts[0].graphemeBoundaries,null);
  assert.equal(row.parts.filter(x=>x.kind==='annotation').length,16);
  assert.equal(row.omittedAnnotations,34);
  assert.deepEqual(p.viewToSource({viewLine:1,grapheme:1}),{
    kind:'unresolved',reason:'truncated-line'
  });
  cases++;
}

// No full-document mirror, 200k rows, a huge folded line and dispersed
// positions; read costs remain bounded by requested window and row limits.
{
  const N=200000,lines=new Array(N);
  for(let i=0;i<N;i++)lines[i]=
    i===90000?'☃'.repeat(1024*1024):
    'row-'+String(i).padStart(6,'0')+(i%67===0?'😀e\u0301':'');
  const doc=new PieceDocument(lines.join('\n'));
  let slicedUnits=0,maxSlice=0,sliceCalls=0;
  const port={
    get length(){return doc.length;},
    get lineCount(){return doc.lineCount;},
    lineStart:(line)=>doc.lineStart(line),
    slice:(a,b)=>{slicedUnits+=b-a;maxSlice=Math.max(maxSlice,b-a);
      sliceCalls++;return doc.slice(a,b);}
  };
  const p=createDocumentProjection(port,{
    folds:[{from:40000,to:150000}]
  });
  assert.equal(p.visibleLineCount,N-(150000-40000));
  assert.equal(p.sourceToView(doc.lineStart(90000)).kind,'folded-region');
  assert.equal(p.viewLineToSource(40001),150001);
  const started=performance.now();
  let maxRows=0,maxRead=0;
  for(let i=0;i<350;i++){
    const from=(i*6737)%p.visibleLineCount;
    const x=p.projectWindow({from,count:20});
    maxRows=Math.max(maxRows,x.rows.length);
    maxRead=Math.max(maxRead,x.readUnits);
    assert.equal(x.rows[0]?.logicalLine,p.viewLineToSource(from));
    assert.ok(x.readUnits<=x.rows.length*512);
  }
  const elapsedMs=performance.now()-started;
  assert.ok(maxRows<=20);
  assert.ok(maxRead<=10240);
  assert.ok(maxSlice<=512,'must never read a full selected or hidden giant line');
  assert.ok(slicedUnits<350*20*530);
  assert.deepEqual(resolveVisibleLineSelection(doc,p,{from:40000,to:40001,includeFolded:true}),[
    {start:doc.lineStart(40000),end:doc.lineStart(150002),forward:true}
  ]);
  console.log(JSON.stringify({scaleRows:N,foldedRows:110000,projections:350,
    maxRows,maxRead,maxSlice,sliceCalls,slicedUnits,
    elapsedMs:+elapsedMs.toFixed(2),
    timeIsOnlySingleRunnerObservation:true}));
  cases++;
}
console.log(JSON.stringify({pass:true,backendCases:3,cases,
  noDOM:true,noListeners:true,noHistory:true,
  UTF16SourceMapping:true,graphemeBoundaries:true,
  foldPlaceholderAndHiddenNotes:true,distinctViews:true,
  explicitIncludeExcludeFoldedSelection:true,
  boundedRowsAndGiantLine:true}));
