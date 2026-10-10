// Local PoC check: the geometry adapter requests only selected logical lines.
// This does not claim small memory for a selected *very long* line.
import assert from 'node:assert/strict';
import {AdaptiveRepackDocument} from '../src/documents.mjs';
import {probeRectangles} from '../src/visual-column-probe.mjs';
const miB=Number(process.argv[2]??16);
if(!Number.isInteger(miB)||miB<1||miB>128)throw RangeError('MiB');
const body='z'.repeat(miB*1048576);
const d=new AdaptiveRepackDocument('top\n'+body+'\nbottom\n');
const read={calls:0,units:0};
const observed={get length(){return d.length;},get lineCount(){return d.lineCount;},lineStart:r=>d.lineStart(r),slice(a,b){read.calls++;read.units+=b-a;return d.slice(a,b);}};
const widthOf=()=>1;
const before=performance.now();
const result=probeRectangles(observed,[{lineFrom:0,lineTo:0,columnFrom:2,columnTo:2},{lineFrom:2,lineTo:2,columnFrom:2,columnTo:2}],{widthOf});
const elapsedMs=performance.now()-before;
assert.equal(result.targets.length,2);
assert.equal(result.unresolved.length,0);
assert.ok(read.units<128,'unexpectedly materialized long unselected line: '+read.units);
assert.equal(d.slice(result.targets[0].start,result.targets[0].start+1),'p');
assert.equal(d.slice(result.targets[1].start,result.targets[1].start+1),'t');
console.log(JSON.stringify({pass:true,documentMiB:miB,visitedRows:2,sliceCalls:read.calls,sliceUnits:read.units,elapsedMs:+elapsedMs.toFixed(2),unselectedHugeLine:true,longSelectedLineNotValidated:true}));
