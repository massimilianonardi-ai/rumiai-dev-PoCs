// PoC-only equivalence checks for the bounded ASCII lookup candidate.
// These are real Flat/Adaptive documents, not mocks of the text storage.
import assert from 'node:assert/strict';
import {FlatDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {probeLine,locateColumn} from '../src/visual-column-probe.mjs';
import {locateColumnsAsciiCandidate} from '../src/visual-column-ascii-probe.mjs';

const glyphs=['a','\t','😀','e\u0301','漢','👩‍💻','👍🏽','🇮🇹','\n',
  '\r\n','x','1\u20e3','W','\r'];
const widthOf=g=>(g==='😀'||g==='👩‍💻'||g==='漢'||g==='W')?2:1;
let seed=0x3355eebb;
function rnd(n){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%n;}
const columns=Array.from({length:30},(_,i)=>i);
for(const Backend of [FlatDocument,AdaptiveRepackDocument]){
  for(const chunkUnits of [1,2,3,4,5,7,11,40]){
    for(let trial=0;trial<100;trial++){
      const value=Array.from({length:1+rnd(22)},()=>glyphs[rnd(glyphs.length)]).join('')+'\nEND';
      const doc=new Backend(value);
      for(let row=0;row<doc.lineCount;row++){
        const full=probeLine(doc,row,{widthOf});
        const candidate=locateColumnsAsciiCandidate(doc,row,columns,
          {widthOf,chunkUnits});
        assert.deepEqual(candidate.matches,columns.map(c=>locateColumn(full,c)),
          JSON.stringify({backend:Backend.name,chunkUnits,trial,row,value}));
      }
    }
  }
}
for(const Backend of [FlatDocument,AdaptiveRepackDocument]){
  const bytes=2*1048576;
  const doc=new Backend('x'.repeat(bytes)+'\nEND');
  const read={calls:0,units:0};
  const monitored={get length(){return doc.length;},
    get lineCount(){return doc.lineCount;},
    lineStart:r=>doc.lineStart(r),
    slice(a,b){read.calls++;read.units+=b-a;return doc.slice(a,b);}};
  const started=performance.now();
  const result=locateColumnsAsciiCandidate(monitored,0,[2],{widthOf});
  const elapsedMs=+(performance.now()-started).toFixed(3);
  assert.equal(result.fallback,false);
  assert.deepEqual(result.matches,[{kind:'exact',offset:2,virtualSpaces:0}]);
  assert.ok(read.units<8192,'candidate read entire long line');
  assert.equal(result.visited,3,'ASCII lookahead must verify target boundary');
  const fullColumn=locateColumnsAsciiCandidate(doc,0,[bytes-1,bytes,bytes+2],
    {widthOf});
  assert.deepEqual(fullColumn.matches,[
    {kind:'exact',offset:bytes-1,virtualSpaces:0},
    {kind:'exact',offset:bytes,virtualSpaces:0},
    {kind:'virtual',offset:bytes,virtualSpaces:2}
  ]);
  assert.equal(fullColumn.fallback,false);
  // Combining mark may join the ASCII '1'. It MUST force Unicode fallback,
  // not report the middle of that grapheme as a valid cursor position.
  const unicode=new Backend('1\u20e3rest');
  const check=locateColumnsAsciiCandidate(unicode,0,[1],{widthOf,chunkUnits:1});
  assert.equal(check.fallback,true);
  assert.deepEqual(check.matches,
    [locateColumn(probeLine(unicode,0,{widthOf}),1)]);
  console.log(JSON.stringify({pass:true,backend:Backend.name,
    hugeSelectedLineMiB:2,targetColumn:2,readUnits:read.units,
    elapsedMs,fullLineUnicodeFallbackTested:true}));
}
console.log(JSON.stringify({pass:true,scope:'ASCII candidate vs full Unicode geometry',
  deterministicCases:1600,chunkSizes:8,
  limitations:'full Unicode fallback; not yet viewport or product implementation'}));
