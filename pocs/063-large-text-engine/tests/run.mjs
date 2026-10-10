import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {FlatDocument,PieceDocument} from '../src/documents.mjs';
import {History,columnPastePlan} from '../src/transactions.mjs';
const selection={primary:1,ranges:[{anchor:3,head:7,virtualColumn:11},{anchor:20,head:20,virtualColumn:5}]};
for(const T of [FlatDocument,PieceDocument]) {
  const doc=new T('one\ntwo\nthree\n');
  const h=new History(doc,selection);
  const next={primary:0,ranges:[{anchor:5,head:5,virtualColumn:8}]};
  h.commit([{start:0,end:3,insert:'1'},{start:8,end:13,insert:'THREE'}],next);
  assert.equal(doc.toString(),'1\ntwo\nTHREE\n');
  assert.deepEqual(h.selection,next);
  assert.equal(doc.lineStart(2),6);
  assert.equal(h.undo(),true);
  assert.equal(doc.toString(),'one\ntwo\nthree\n');
  assert.deepEqual(h.selection,selection);
  assert.equal(h.redo(),true);
  assert.equal(doc.toString(),'1\ntwo\nTHREE\n');
  assert.deepEqual(h.selection,next);
  const plan=columnPastePlan([{start:0,end:0},{start:2,end:2},{start:6,end:6}], 'AA\nBB',{fill:'cycle'});
  assert.deepEqual(plan.map(x=>x.insert),['AA','BB','AA']);
  h.commit([{start:0,end:1,insert:'ONE'}]);
  assert.equal(h.redo(),false);
  for(let i=0;i<64;i++) h.commit([{start:0,end:0,insert:'x'}]);
  for(let i=0;i<64;i++)assert.equal(h.undo(),true);
  assert.equal(doc.toString(),'ONE\ntwo\nTHREE\n');
}
const fixtures=JSON.parse(readFileSync(new URL('../fixtures/column-cases.json',import.meta.url),'utf8'));
for(const f of fixtures){
  const plan=columnPastePlan(f.targets,f.clipboard,{fill:f.fill});
  assert.deepEqual(plan.map(e=>e.insert),f.expected,f.id);
}
// Seeded deterministic equivalence property test; includes newline changes,
// Unicode UTF-16 content and exact random ranges.
let rng=0x55511122;const rnd=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;};
const flat=new FlatDocument('alpha\nbeta\n你好\nemoji 😀\n'.repeat(100));
const tree=new PieceDocument(flat.toString());
const inserts=['','X','\n','😀','e\u0301','\r\n','\t','KQW'];
for(let i=0;i<4000;i++) {
  const p=rnd()%(flat.length+1);const len=Math.min(flat.length-p,rnd()%7);
  const str=inserts[rnd()%inserts.length];
  flat.replace(p,p+len,str);tree.replace(p,p+len,str);
  if(i%40===0) {
    assert.equal(tree.toString(),flat.toString(),"text diverged at "+i);
    assert.equal(tree.lineCount,flat.lineCount,"line count diverged at "+i);
    if(tree.lineCount>0){const line=rnd()%tree.lineCount;assert.equal(tree.lineStart(line),flat.lineStart(line),"line "+line+" at "+i);}
    const from=rnd()%(tree.length+1),to=from+(rnd()%(tree.length-from+1));
    assert.equal(tree.slice(from,to),flat.slice(from,to));
  }
}
assert.equal(tree.toString(),flat.toString());
const stats=tree.stats();assert.ok(stats.maxDepth<100,"tree unexpectedly deep "+stats.maxDepth);
console.log(JSON.stringify({pass:true,deterministicEdits:4000,tree:stats,fixtures:fixtures.length}));
