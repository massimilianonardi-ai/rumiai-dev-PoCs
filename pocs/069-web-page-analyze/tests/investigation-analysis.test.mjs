import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTrace,analyzeCoverage} from '../analyze-investigation.mjs';
import {safeResourceUrl,investigationPaths} from '../investigate.mjs';

function snap(at,y,ids,nested=0){
  return {at,scroll:{windowY:y,rootY:y,scrollHeight:12000},
    boxes:Array.from({length:nested},()=>({actualScroller:true})),
    messages:ids.map(key=>({key,visible:true}))};
}
test('manual root-page scrolling and stable div identity transitions support virtualization hypothesis',()=>{
  const snapshots=[
    snap(1,0,['turn-A','turn-B']),
    snap(2,500,['turn-B','turn-C']),
    snap(3,1000,['turn-C','turn-D']),
    snap(4,0,['turn-A','turn-B'])
  ];
  const mutations=[
    {op:'added',key:'turn-A'},{op:'added',key:'turn-B'},
    {op:'removed',key:'turn-A'}, {op:'added',key:'turn-C'},
    {op:'removed',key:'turn-B'},{op:'added',key:'turn-D'},
    {op:'removed',key:'turn-D'},{op:'added',key:'turn-A'}
  ];
  const report=analyzeTrace(snapshots,mutations,[
    {label:'initial',snapshot:snapshots[0]},
    {label:'bottom',snapshot:snapshots[2]},
    {label:'top-again',snapshot:snapshots[3]}
  ]);
  assert.equal(report.candidateVirtualization,true);
  assert.equal(report.distinctMountedIdentities,4);
  assert.equal(report.remountedAfterRemoval,1);
  assert.equal(report.maxNestedActualScrollers,0);
  assert.equal(report.rootScrollObserved,true);
  assert.equal(report.checkpointStartEndOverlap,2);
  assert.equal(report.exactImplementationVerified,false);
});
test('without stable removal evidence no virtualizer is certified',()=>{
  const r=analyzeTrace([snap(1,0,['a']),snap(2,0,['a'])],[],[]);
  assert.equal(r.candidateVirtualization,false);
  assert.equal(r.remountedAfterRemoval,0);
  assert.equal(r.rootScrollObserved,false);
});
test('executed ranges are linked to collected JS source and kept phase-scoped',()=>{
  const report=analyzeCoverage({top:[
    {scriptId:'12',functions:[{ranges:[{count:1}]},
      {ranges:[{count:0}]}]},
    {scriptId:'13',functions:[{ranges:[{count:2}]}]}
  ]},[{scriptId:'12',url:'https://chatgpt.com/assets/a.js',
    sourceFile:'scripts/0001.js',sha256:'abc'}]);
  assert.equal(report.top.executing,2);
  assert.equal(report.top.mostActiveScripts[0].executedFunctionRanges,1);
  assert.equal(report.top.mostActiveScripts.find(x=>
    x.sourceFile==='scripts/0001.js').sourceSha256,'abc');
});
test('resource URL scrubs query tokens and fragments',()=>{
  assert.equal(safeResourceUrl(
    'https://chatgpt.com/assets/main.js?secret=TOKEN#section'),
    'https://chatgpt.com/assets/main.js');
  assert.equal(safeResourceUrl('data:text/javascript,x'),'data:');
});
test('path contract rejects parent and empty run names',()=>{
  assert.throws(()=>investigationPaths('../leak'),/invalid-name/);
  assert.throws(()=>investigationPaths(''),/invalid-name/);
  assert.match(investigationPaths('inspect-01'),/investigations\/inspect-01$/);
});
