import assert from 'node:assert/strict';
import {FlatDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {ForegroundHistory} from '../src/foreground-history.mjs';
import {probeLine,locateColumn,probeRectangles} from '../src/visual-column-probe.mjs';
const text = 'a\t😀e\u0301漢Z\r\nx\n\n';
const widthOf = s => s==='😀'||s==='漢' ? 2 : 1;
const opts = {tabSize:4,widthOf};
for (const Doc of [FlatDocument,AdaptiveRepackDocument]) {
  const doc = new Doc(text);
  assert.equal(doc.lineCount,4);
  const g=probeLine(doc,0,opts);
  assert.deepEqual(g.cells.map(c=>[c.text,c.columnStart,c.columnEnd,c.start,c.end]),[
    ['a',0,1,0,1],['\t',1,4,1,2],['😀',4,6,2,4],['e\u0301',6,7,4,6],['漢',7,9,6,7],['Z',9,10,7,8]
  ]);
  assert.equal(g.textEnd,8);
  assert.equal(g.end,10); // CRLF stripped from the display but not document.
  assert.deepEqual(locateColumn(g,11),{kind:'virtual',offset:8,virtualSpaces:1});
  assert.equal(locateColumn(g,2).kind,'inside-grapheme');
  assert.equal(locateColumn(g,5).kind,'inside-grapheme');
  assert.equal(locateColumn(g,4).offset,2);
  assert.equal(locateColumn(g,6).offset,4);
  assert.equal(locateColumn(g,7).offset,6);
  assert.equal(probeLine(doc,1,opts).textEnd,11);
  assert.equal(probeLine(doc,2,opts).columns,0);
  assert.equal(probeLine(doc,3,opts).columns,0);
  assert.throws(()=>probeLine(doc,0,{widthOf:()=>0}),/width/);
  assert.throws(()=>probeLine(doc,0,{tabSize:0,widthOf}),/tabSize/);
  assert.throws(()=>probeLine(doc,0),/widthOf/);
  const one=probeRectangles(doc,[{lineFrom:0,lineTo:2,columnFrom:4,columnTo:4}],opts);
  assert.equal(one.targets.length,3);
  assert.equal(one.unresolved.length,0);
  assert.deepEqual(one.targets.map(t=>[t.start,t.end,t.virtualSpaces]),[[2,2,0],[11,11,3],[12,12,4]]);
  const unsnapped=probeRectangles(doc,[{lineFrom:0,lineTo:1,columnFrom:2,columnTo:5}],opts);
  assert.equal(unsnapped.unresolved.length,1);
  assert.equal(unsnapped.unresolved[0].line,0);
  assert.equal(unsnapped.targets.length,1);
  const duplicates=probeRectangles(doc,[{lineFrom:1,lineTo:1,columnFrom:0,columnTo:0},{lineFrom:1,lineTo:1,columnFrom:0,columnTo:0}],opts);
  assert.equal(duplicates.collisions.length,1);
  const nested=probeRectangles(doc,[{lineFrom:0,lineTo:0,columnFrom:0,columnTo:10},{lineFrom:0,lineTo:0,columnFrom:1,columnTo:1},{lineFrom:0,lineTo:0,columnFrom:4,columnTo:4}],opts);
  assert.equal(nested.collisions.length,2,'nested overlaps both detected');
  const choice=probeRectangles(doc,[{lineFrom:0,lineTo:2,columnFrom:4,columnTo:4}],opts);
  const state={primary:0,ranges:choice.targets.map(t=>({anchor:t.start,head:t.end,virtualColumn:t.columnFrom}))};
  const history = new ForegroundHistory(doc,state);
  const edits=choice.targets.map(t=>({start:t.start,end:t.end,insert:' '.repeat(t.virtualSpaces)+'P'}));
  const after={primary:2,ranges:choice.targets.map(t=>({anchor:t.start,head:t.start,virtualColumn:t.columnFrom+1}))};
  history.commit(edits,after);
  assert.equal(doc.toString(),'a\tP😀e\u0301漢Z\r\nx   P\n    P\n');
  assert.deepEqual(history.selection,after);
  assert.equal(history.undo(),true);assert.equal(doc.toString(),text);assert.deepEqual(history.selection,state);
  assert.equal(history.redo(),true);assert.equal(doc.toString(),'a\tP😀e\u0301漢Z\r\nx   P\n    P\n');
}
console.log(JSON.stringify({pass:true,engines:['FlatDocument','AdaptiveRepackDocument'],cases:['tab','emoji','combining','wide','CRLF','empty','virtual','ambiguous','multiple-rectangles','atomic-edit-undo-redo'],nativeMadEditGuiVerified:false}));
