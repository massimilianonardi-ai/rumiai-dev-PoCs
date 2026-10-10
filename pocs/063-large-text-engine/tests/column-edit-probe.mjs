import assert from 'node:assert/strict';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';
import {planColumnPaste} from '../src/column-edit-probe.mjs';

const textOf=doc=>doc.slice(0,doc.length);
const geometry={tabSize:4,widthOf:g=>g==='猫'?2:1};
const scenarios=[];
for(const Store of [FlatDocument,PieceDocument,AdaptiveRepackDocument]){
  function run(initial,rectangle,clipboard,config={}){
    const document=new Store(initial),selections=new TextEditSelections(document,config.editor);
    const plan=planColumnPaste(document,{rectangle,clipboard,...geometry,...config.options});
    if(plan.noop)return {document,plan,selections,oldText:initial};
    selections.setSelections(plan.selections);
    const result=selections.replace(plan.texts);
    return {document,plan,selections,result,oldText:initial};
  }
  const rectangle={lineFrom:0,lineTo:2,columnFrom:4,columnTo:4};
  // MadEdit-Mod source-inspired selected-area autofill, independent of
  // the core: one source row per target, cycling only when enabled.
  const filled=run('aa\nb\n\n',rectangle,'A\nB',{options:{autofill:true}});
  assert.equal(textOf(filled.document),'aa  A\nb   B\n    A\n');
  assert.deepEqual(filled.plan.texts,['  A','   B','    A']);
  assert.equal(filled.plan.autofilled,true);
  assert.equal(filled.result.changes.length,3);
  // One external undo action: direct application of exact inverse fragments.
  for(let i=filled.result.changes.length-1;i>=0;i--){
    const c=filled.result.changes[i];
    filled.document.replace(c.inverseStart,c.inverseEnd,c.removed);
  }
  filled.selections.setSelections(filled.result.before);
  assert.equal(textOf(filled.document),filled.oldText);
  assert.deepEqual(filled.selections.getSelections(),filled.plan.selections);

  const noFill=run('aa\nb\n\n',rectangle,'A\nB');
  assert.equal(textOf(noFill.document),'aa  A\nb   B\n\n');
  assert.equal(noFill.plan.targetRows,2);
  assert.equal(noFill.plan.autofilled,false);

  // A final newline is an extra empty *plain-text* clipboard row.
  const trailing=run('aa\nb\n\n',rectangle,'A\nB\n',{options:{autofill:true}});
  assert.equal(trailing.plan.sourceRows,3);
  assert.equal(trailing.plan.autofilled,false);
  assert.equal(textOf(trailing.document),'aa  A\nb   B\n    \n');

  // Native clipboard carries an explicit source row count. Its terminal
  // newline is not forced to become a third data row.
  const native=run('aa\nb\n\n',rectangle,{
    kind:'madedit-column',text:'A\nB\n',rowCount:2
  },{options:{autofill:true}});
  assert.equal(native.plan.sourceRows,2);
  assert.equal(native.plan.autofilled,true);
  assert.equal(textOf(native.document),'aa  A\nb   B\n    A\n');

  // Source longer than target: extend geometrical target rows already
  // present in document; do NOT silently clip the source.
  const overflow=run('a\nb\nc\nd',
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},'X\nY\nZ');
  assert.equal(overflow.plan.extended,true);
  assert.equal(overflow.plan.targetRows,3);
  assert.equal(textOf(overflow.document),'aX\nbY\ncZ\nd');

  // Row drag orientation is meaningful: the user's first target is row 2.
  const up=run('a\nb\nc',{lineFrom:2,lineTo:0,columnFrom:1,columnTo:1},{
    kind:'rows',rows:['1','2','3']
  });
  assert.deepEqual(up.plan.texts,['1','2','3']);
  assert.deepEqual(up.plan.selections.map(s=>s.start),[5,3,1]);
  assert.equal(textOf(up.document),'a3\nb2\nc1');

  // Backward *column* orientation is preserved. Only the selected higher
  // implementation chooses how backward input transforms the payload.
  const backward=run('abc\nxyz',
    {lineFrom:0,lineTo:1,columnFrom:2,columnTo:1},
    {kind:'rows',rows:['AB','CD']},
    {editor:{onBackward:({selection,text})=>({
      start:selection.start,end:selection.end,
      insert:Array.from(text).reverse().join('')
    })}});
  assert.deepEqual(backward.plan.selections.map(s=>s.forward),[false,false]);
  assert.equal(textOf(backward.document),'aBAc\nxDCz');

  const crlf=run('a\r\nb\r\n',
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},'X\r\nY');
  assert.equal(textOf(crlf.document),'aX\r\nbY\r\n');

  const noOp=planColumnPaste(new Store('a'),{
    rectangle:{lineFrom:0,lineTo:0,columnFrom:0,columnTo:0},
    clipboard:'',...geometry
  });
  assert.equal(noOp.noop,true);
  const invalid=new Store('a\nb');
  assert.throws(()=>planColumnPaste(invalid,{
    rectangle:{lineFrom:0,lineTo:0,columnFrom:1,columnTo:1},
    clipboard:'X\nY\nZ',...geometry
  }),/external document row materialization/);
  assert.equal(textOf(invalid),'a\nb');

  const tab=new Store('a\tb\nx');
  assert.throws(()=>planColumnPaste(tab,{
    rectangle:{lineFrom:0,lineTo:0,columnFrom:2,columnTo:2},
    clipboard:'!',...geometry
  }),/inside a grapheme or tab/);
  assert.equal(textOf(tab),'a\tb\nx');
  const wide=new Store('猫\n');
  assert.throws(()=>planColumnPaste(wide,{
    rectangle:{lineFrom:0,lineTo:0,columnFrom:1,columnTo:1},
    clipboard:'!',...geometry
  }),/inside a grapheme or tab/);
  assert.equal(textOf(wide),'猫\n');
  assert.throws(()=>planColumnPaste(new Store('a'),{
    rectangle:{lineFrom:0,lineTo:0,columnFrom:0,columnTo:0},
    clipboard:{kind:'madedit-column',text:'A\nB',rowCount:1},...geometry
  }),/native column row count/);

  // Opt-in beyond-EOF continuation: no extra method on TextEditBase.
  // At EOF the last physical row edit and all new rows fuse into ONE target.
  const eof=run('a\nb',
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},
    'X\nY\nZ\nW',{options:{materializeRows:true}});
  assert.equal(textOf(eof.document),'aX\nbY\n Z\n W');
  assert.equal(eof.plan.targetRows,4);
  assert.equal(eof.plan.materializedRows,2);
  assert.equal(eof.plan.selections.length,2);
  assert.equal(eof.result.changes.length,2);
  for(let i=eof.result.changes.length-1;i>=0;i--){
    const c=eof.result.changes[i];
    eof.document.replace(c.inverseStart,c.inverseEnd,c.removed);
  }
  eof.selections.setSelections(eof.result.before);
  assert.equal(textOf(eof.document),eof.oldText);

  // A document already ending in a newline has an existing empty last row.
  // Reusing its EOF caret must not introduce duplicate edit positions.
  const trailingEof=run('a\nb\n',
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},
    'X\nY\nZ\nW',{options:{materializeRows:true}});
  assert.equal(textOf(trailingEof.document),'aX\nbY\n Z\n W');
  assert.equal(trailingEof.plan.materializedRows,1);
  assert.equal(trailingEof.plan.selections.length,3);

  // A non-EOF target on the last line gets a separate EOF insertion; it
  // preserves the existing text following the selected column.
  const suffix=run('a\nbbbb',
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},
    'X\nY\nZ',{options:{materializeRows:true}});
  assert.equal(textOf(suffix.document),'aX\nbYbbb\n Z');
  assert.equal(suffix.plan.selections.length,3);
  assert.deepEqual(suffix.plan.texts,['X','Y','\n Z']);

  // Inherit CRLF from the final existing line terminator, or use a caller-
  // selected newline. A native rowCount does not create an empty extra row.
  const crlfEof=run('a\r\nb',
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},
    'X\nY\nZ',{options:{materializeRows:true}});
  assert.equal(textOf(crlfEof.document),'aX\r\nbY\r\n Z');
  const explicitLf=run('a\r\nb',
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},
    'X\nY\nZ',{options:{materializeRows:true,lineEnding:'\n'}});
  assert.equal(textOf(explicitLf.document),'aX\r\nbY\n Z');
  const nativeEof=run('a\nb',
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},
    {kind:'madedit-column',text:'X\nY\nZ\n',rowCount:3},
    {options:{materializeRows:true}});
  assert.equal(textOf(nativeEof.document),'aX\nbY\n Z');
  assert.equal(nativeEof.plan.sourceRows,3);

  // Visual columns of synthesized empty rows are all virtual spaces;
  // existing rows continue to be measured by the actual grapheme geometry.
  const wideEof=run('猫\nb',
    {lineFrom:0,lineTo:1,columnFrom:2,columnTo:2},
    'X\nY\nZ',{options:{materializeRows:true}});
  assert.equal(textOf(wideEof.document),'猫X\nb Y\n  Z');

  // Unsupported orientations are explicit. No write happens in a planner.
  const untouched=new Store('a\nb');
  for(const rectangle of [
    {lineFrom:1,lineTo:0,columnFrom:1,columnTo:1},
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:0}
  ]){
    assert.throws(()=>planColumnPaste(untouched,{
      rectangle,clipboard:'X\nY\nZ',
      materializeRows:true,...geometry
    }),/materialization/);
  }
  assert.equal(textOf(untouched),'a\nb');
  const ambiguous=new Store('a\tb\nc');
  assert.throws(()=>planColumnPaste(ambiguous,{
    rectangle:{lineFrom:0,lineTo:1,columnFrom:2,columnTo:2},
    clipboard:'X\nY\nZ',materializeRows:true,...geometry
  }),/inside a grapheme or tab/);
  assert.equal(textOf(ambiguous),'a\tb\nc');
  assert.throws(()=>planColumnPaste(untouched,{
    rectangle:{lineFrom:0,lineTo:1,columnFrom:1,columnTo:1},
    clipboard:'X\nY\nZ',materializeRows:true,lineEnding:'\r',...geometry
  }),/lineEnding/);
  scenarios.push({backend:Store.name,autofill:true,trailingNewline:true,
    nativeRowCount:true,overflowExistingRows:true,reverseRowOrder:true,
    reverseColumnOrientation:true,crlf:true,virtualPadding:true,
    rejectUnmaterializedRows:true,rejectAmbiguousGrapheme:true,
    materializeEofRows:true,undoAfterOverflow:true,crlfContinuation:true,
    rejectUnsupportedOverflowOrientation:true});
}
console.log(JSON.stringify({pass:true,scenarios,sourceBehaviorNotNativeGUI:true,
  noHistoryInCore:true,baseSingleRange:true}));
