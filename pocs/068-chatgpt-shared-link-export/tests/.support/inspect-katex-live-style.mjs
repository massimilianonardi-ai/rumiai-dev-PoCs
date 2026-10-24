'use strict';
import assert from 'node:assert/strict';
import {browserKatexExpression,compareLiveAndOfflineMath}
  from '../../inspect-katex-live-style.mjs';

const sample=(fontSize,fontFamily)=>({
  tag:'span',s:[fontSize,fontFamily,'400','normal','baseline','static',
    'inline','auto','auto','none','0px','0px','0px','0px'],
  g:[0,0,15,20]
});
const live={turns:[
  {ordinal:2,math:[[sample('14px','KaTeX_Main')],[sample('12px','KaTeX_Math')]]},
  {ordinal:4,math:[[sample('12px','KaTeX_Main')]]}
],fontFaces:{known:4,loaded:4,loading:0}};
const offline={turns:[
  {ordinal:2,math:[[sample('16px','Arial')],[sample('12px','KaTeX_Math')]]},
  {ordinal:6,math:[[sample('10px','Arial')]]}
],fontFaces:{known:0,loaded:0,loading:0}};
const report=compareLiveAndOfflineMath(live,offline);
assert.equal(report.source.formulaRoots,3);
assert.equal(report.offline.formulaRoots,3);
assert.equal(report.comparison.pairedRoots,2);
assert.equal(report.comparison.stylePropertyDifferences.fontSize,1);
assert.equal(report.comparison.stylePropertyDifferences.fontFamily,1);
assert.deepEqual(report.comparison.sourceOnlyOrdinals,[4]);
assert(report.comparison.perTurn.some(t=>t.ordinal===6&&t.sourceObserved===false));
const privateValue='hypersensitive-untrusted-formula';
const json=JSON.stringify(report);
assert(!json.includes('KaTeX_Main'));
assert(!json.includes('Arial'));
assert(!json.includes(privateValue));
const expression=browserKatexExpression();
assert(expression.includes('conversation-turn-'));
assert(!expression.includes('hypersensitive-untrusted-formula'));
new Function('document','getComputedStyle', 'return '+expression);
console.log('PASS: KaTeX live-vs-offline comparison finds font and size changes without emitting computed values or formula content');
