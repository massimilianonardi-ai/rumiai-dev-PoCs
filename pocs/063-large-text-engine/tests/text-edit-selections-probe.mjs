import assert from 'node:assert/strict';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';
import {probeRectangles} from '../src/visual-column-probe.mjs';

const caret=(at,forward=true)=>({start:at,end:at,forward});
const selection=(start,end,forward=true)=>({start,end,forward});
const textOf=model=>model.slice(0,model.length);
const results=[];
for(const Store of [FlatDocument,PieceDocument,AdaptiveRepackDocument]){
  // TextEditBase has only the ordinary SINGLE-range text interface;
  // the existing store type has no idea how many selections were configured.
  const raw=new Store('abcd');
  assert.equal(raw.slice(1,3),'bc');
  assert.equal(typeof raw.replace,'function');
  assert.equal('selectionRanges' in raw,false);
  raw.replace(1,3,'Z');
  assert.equal(textOf(raw),'aZd');

  // Array pairing is in user-specified selection order, deliberately
  // different from physical text-offset sort order.
  const doc=new Store('a|b|c'),edit=new TextEditSelections(doc);
  const userOrder=[caret(4),caret(0),caret(2)];
  edit.setSelections(userOrder);
  const applied=edit.replace(['C','A','B']);
  assert.equal(textOf(doc),'Aa|Bb|Cc');
  assert.deepEqual(applied.changes.map(x=>x.selectionId),[1,2,0]);
  assert.deepEqual(applied.changes.map(x=>x.inserted),['A','B','C']);
  assert.deepEqual(applied.before,userOrder);
  assert.deepEqual(edit.getSelections(),[caret(7),caret(1),caret(4)]);
  assert.throws(()=>edit.replace(['only two','items']),/one string per selection/);
  assert.throws(()=>edit.replace([1,2,3]),/one string per selection/);
  assert.equal(textOf(doc),'Aa|Bb|Cc');

  // One string is replicated; the array remains a separate exact mapping.
  const other=new Store('a|b|c'),multi=new TextEditSelections(other);
  multi.setSelections(userOrder);
  const repeated=multi.replace('X');
  assert.equal(textOf(other),'Xa|Xb|Xc');
  assert.deepEqual(repeated.changes.map(x=>x.selectionId),[1,2,0]);

  // Oriented selections are retained; the caller chooses the *semantics*
  // of backwards operations rather than a hidden TextEditBase assumption.
  const reversed=new Store('abcde');
  const graphemes=new Intl.Segmenter('en',{granularity:'grapheme'});
  const reverseGraphemes=({selection:range,text})=>({
    start:range.start,end:range.end,
    insert:Array.from(graphemes.segment(text),x=>x.segment).reverse().join('')
  });
  const reverseEdit=new TextEditSelections(reversed,{onBackward:reverseGraphemes});
  reverseEdit.setSelections([selection(1,3,false)]);
  const reversedResult=reverseEdit.replace('e\u0301💡');
  assert.equal(textOf(reversed),'a💡e\u0301de');
  assert.deepEqual(reversedResult.before,[selection(1,3,false)]);
  assert.deepEqual(reverseEdit.getSelections(),[caret(5,false)]);
  const toRight=new Store('abcde');
  const appendAfterSelection=({selection:range,text})=>({
    start:range.end,end:range.end,insert:text
  });
  const shiftEdit=new TextEditSelections(toRight,{onBackward:appendAfterSelection});
  shiftEdit.setSelections([selection(1,3,false)]);
  shiftEdit.replace('ZZ');
  assert.equal(textOf(toRight),'abcZZde');
  assert.deepEqual(shiftEdit.getSelections(),[caret(5,false)]);
  assert.equal('onBackward' in toRight,false);

  // A direction policy can move a backwards target past another selection.
// Cached physical order must detect this and re-sort, while preserving
// array-to-user-selection association and both selection orientations.
{
  const document=new FlatDocument('abcdefghi');
  const edit=new TextEditSelections(document,{
    onBackward:({text})=>({start:7,end:7,insert:text})
  });
  edit.setSelections([caret(1,false),caret(4)]);
  const applied=edit.replace(['X','Y']);
  assert.equal(textOf(document),'abcdYefgXhi');
  assert.deepEqual(applied.changes.map(change=>change.selectionId),[1,0]);
  assert.deepEqual(edit.getSelections(),[caret(9,false),caret(5)]);
  // The execution-order cache remains usable on subsequent edits.
  edit.replace(['Z','W']);
  assert.equal(textOf(document),'abcdYWefZgXhi');
}
// Duplicate, overlapping and malformed selections/behavior rejected.
  const collision=new Store('abcdef'),invalid=new TextEditSelections(collision);
  invalid.setSelections([caret(2),caret(2)]);
  assert.throws(()=>invalid.replace('!'),/overlapping\/duplicate/);
  assert.equal(textOf(collision),'abcdef');
  invalid.setSelections([selection(1,4),selection(2,5)]);
  assert.throws(()=>invalid.replace('!'),/overlapping\/duplicate/);
  assert.equal(textOf(collision),'abcdef');
  assert.throws(()=>invalid.setSelections([selection(-1,0)]),/invalid oriented selection/);

  // Column geometry and padding are prepared by the UPPER layer.
  const columns=new Store('aa\nb\n\n');
  const rect=probeRectangles(columns,[{
    lineFrom:0,lineTo:2,columnFrom:4,columnTo:4
  }],{tabSize:4,widthOf:()=>1});
  assert.equal(rect.unresolved.length,0);
  assert.equal(rect.targets.length,3);
  const selections=rect.targets.map(target=>caret(target.start,false));
  const payload=rect.targets.map((target,i)=>' '.repeat(target.virtualSpaces)+['A','B','C'][i]);
  const layered=new TextEditSelections(columns);
  layered.setSelections(selections);
  const original=textOf(columns);
  const result=layered.replace(payload);
  assert.equal(textOf(columns),'aa  A\nb   B\n    C\n');
  assert.equal(result.changes.length,3);
  // External history wrapper can derive undo from explicit results. No
  // listener, history, or undo operation is installed in either lower layer.
  for(let i=result.changes.length-1;i>=0;i--){
    const d=result.changes[i];
    columns.replace(d.inverseStart,d.inverseEnd,d.removed);
  }
  layered.setSelections(result.before);
  assert.equal(textOf(columns),original);
  assert.deepEqual(layered.getSelections(),selections);
  const redo=layered.replace(payload);
  assert.equal(textOf(columns),'aa  A\nb   B\n    C\n');
  assert.deepEqual(redo.after,result.after);
  assert.equal('undo' in layered,false);
  assert.equal('subscribe' in layered,false);

  results.push({store:Store.name,selectionOrder:true,repeat:true,
    orientedReverse:true,orientedRightEdge:true,threeRowColumn:true,externalInverse:true});
}
// A backend failure on otherwise valid inputs is exceptional. For speed,
// TextEditSelections does NOT attempt rollback: one earlier (high offset)
// replacement may remain. The error must propagate; no success result exists.
{
  const real=new FlatDocument('aa\nbb\ncc');
  let calls=0;
  const observed={get length(){return real.length;},
    slice:(a,b)=>real.slice(a,b),
    replace(a,b,s){calls++;if(calls===2)throw Error('injected before-mutation error');return real.replace(a,b,s);}
  };
  const editor=new TextEditSelections(observed);
  const before=[caret(0),caret(3),caret(6)];editor.setSelections(before);
  assert.throws(()=>editor.replace(['A','B','C']),/injected before-mutation error/);
  assert.equal(textOf(real),'aa\nbb\nCcc','one prior replace remains, no rollback');
  assert.deepEqual(editor.getSelections(),before,'do not pretend success by changing selections');
  assert.equal(calls,2,'no recovery replace calls after exceptional failure');
}
// Ordinary input errors are detected before any TextEditBase replacement.
// Even a bad direction plan after an earlier valid plan does not mutate.
{
  const real=new FlatDocument('abcd');
  let calls=0;
  const observed={get length(){return real.length;},
    slice:(a,b)=>real.slice(a,b),
    replace(a,b,s){calls++;return real.replace(a,b,s);}
  };
  const editor=new TextEditSelections(observed,{onBackward:()=>({start:99,end:99,insert:'?'})});
  editor.setSelections([caret(0),caret(2,false)]);
  assert.throws(()=>editor.replace(['X','Y']),/invalid direction-specific edit/);
  assert.equal(calls,0);
  assert.equal(textOf(real),'abcd');
}
// Direction callback failure and mismatched input cannot mutate the base.
{
  const store=new FlatDocument('abc');
  const editor=new TextEditSelections(store,{onBackward:()=>({start:7,end:7,insert:'!'} )});
  editor.setSelections([caret(1,false)]);
  assert.throws(()=>editor.replace('!'),/invalid direction-specific edit/);
  assert.equal(textOf(store),'abc');
}
console.log(JSON.stringify({pass:true,candidate:'TextEditBase -> TextEditSelections',
  variants:results,backendCount:results.length,baseHasNoSelections:true,
  perTargetPrimitiveOnly:true,orientationDefinedByCaller:true,
  columnPolicyExternal:true,noUndoOrListeners:true,
  prevalidatedBeforeMutation:true,rollbackNotAttempted:true,partialWriteOnBackendError:true,guiTested:false}));
