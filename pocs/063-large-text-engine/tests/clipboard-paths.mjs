// Source-behavior characterization only: not a GUI or native MadEdit-Mod test.
// Port of observable counting/normalization and a model of the AutoFill condition.
import assert from 'node:assert/strict';
import {columnPastePlan} from '../src/transactions.mjs';

function normalizedPlain(text){
 const lineCount=text.length===0?0:1+(text.match(/\r\n|\r|\n/g)?.length??0);
 const normalized=text.replace(/\r\n|\r/g,'\n');
 // MadEdit.cpp GetColumnDataFromClipboard appends EOL for ordinary text.
 return {lineCount,insertable:lineCount>0?normalized+'\n':''};
}
function logicalRows(info){return info.lineCount>0?info.insertable.split('\n').slice(0,info.lineCount):[];}
function selectedPlainRows(text,destinationRows,{selected=true,autofill=true}={}){
 const info=normalizedPlain(text),lines=logicalRows(info);
 if(!lines.length)return {sourceLines:0,rows:[],autofilled:false};
 const repeat=autofill && selected && destinationRows>info.lineCount;
 return {sourceLines:info.lineCount,rows:Array.from({length:repeat?destinationRows:info.lineCount},(_,i)=>lines[i%lines.length]),autofilled:repeat};
}
for(const [input,count,rows] of [
  ['A',1,['A']],['A\nB',2,['A','B']],['A\nB\n',3,['A','B','']],
  ['A\r\nB',2,['A','B']],['A\rB',2,['A','B']],['',0,[]]
]){
 const n=normalizedPlain(input);assert.equal(n.lineCount,count);assert.deepEqual(logicalRows(n),rows);
}
assert.deepEqual(selectedPlainRows('A\nB',5).rows,['A','B','A','B','A']);
assert.deepEqual(selectedPlainRows('A\nB\n',5).rows,['A','B','','A','B']);
assert.equal(selectedPlainRows('A\nB',5,{selected:false}).rows.length,2);
assert.equal(selectedPlainRows('A\nB',5,{autofill:false}).rows.length,2);
assert.equal(selectedPlainRows('A\nB',1).rows.length,2); // excess source rows remain, not clipped by selection count
// Important intentional discrepancy: the original experimental planner clips extra
// source lines to targets. This is NOT MadEdit-Mod parity and is not asserted as correct.
const provisional=columnPastePlan([{start:0,end:0}], 'A\nB');
assert.equal(provisional.length,1);
assert.equal(selectedPlainRows('A\nB',1).rows.length,2);
console.log(JSON.stringify({pass:true,cases:6,provisionalMismatch:'more source rows than selected targets',nativeGuiVerified:false}));
