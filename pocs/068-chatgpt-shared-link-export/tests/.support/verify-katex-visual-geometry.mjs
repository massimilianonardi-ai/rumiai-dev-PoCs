'use strict';
// Real-browser regression: original KaTeX HTML and its sanitized offline
// projection must yield the same font sizes and on-screen geometry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import katex from 'katex';
import {parseHTML} from 'linkedom';
import {embeddedKatexCss} from '../../embed-katex-css.mjs';
import {renderSemanticTree,createSemanticStats}
  from '../../render-semantic-content.mjs';

const equations=[
  'x_i^2 + y_{n+1} = z^{\\alpha}_j',
  '\\sum_{i=1}^{n} \\frac{a_i^2}{b_{i+1}} + \\sqrt{x^2+y^2}',
  '\\left(\\begin{matrix}a_{11}&a_{12}\\\\a_{21}&a_{22}\\end{matrix}\\right) \\vec{x}_{k+1} = A\\vec{x}_k',
  '\\left[\\begin{aligned}u_{k+1}&=u_k+K(y_k-r)\\\\y_k&=\\frac{x_{k-1}}{1+x_k^2}\\end{aligned}\\right]'
];
const content=equations.map((equation,index)=>{
  const original=katex.renderToString(equation,{output:'html',displayMode:true,
    throwOnError:true,trust:false});
  const root=parseHTML('<div>'+original+'</div>').document.querySelector('div');
  const stats=createSemanticStats();
  const sanitized=renderSemanticTree(root,()=>null,stats);
  assert.equal(stats.mathVisualPreserved,1,'Formula '+index+' lost visual root');
  assert.equal(stats.mathUnavailable,0);
  assert(!sanitized.includes('katex-mathml'),'Expected HTML-only KaTeX');
  return '<div class="case"><div class="baseline">'+original+
    '</div><div class="projected">'+sanitized+'</div></div>';
}).join('\n');
const measure=[
  "const verdict=document.getElementById('verdict');",
  "function geometry(root) {",
  " const origin=root.querySelector('.katex-html')?.getBoundingClientRect();",
  " if(!origin)return [];",
  " return Array.from(root.querySelectorAll('.katex-html *')).map(element=>{",
  "  const r=element.getBoundingClientRect();",
  "  const computed=getComputedStyle(element);",
  "  const round=x=>Math.round(x*1000)/1000;",
  "  return {tag:element.localName,",
  "   x:round(r.x-origin.x),y:round(r.y-origin.y),",
  "   w:round(r.width),h:round(r.height),",
  "   font:round(parseFloat(computed.fontSize)),position:computed.position};",
  " });",
  "}",
  "function compare() {",
  " const data=[];",
  " document.querySelectorAll('.case').forEach((item,index)=>{",
  "   const a=geometry(item.querySelector('.baseline'));",
  "   const b=geometry(item.querySelector('.projected'));",
  "   let worst=0,changes=0,first='';",
  "   const n=Math.min(a.length,b.length);",
  "   for(let i=0;i<n;i++) {",
  "     if(a[i].tag!==b[i].tag){changes++;if(!first)first='tag';continue;}",
  "     for(const key of ['x','y','w','h','font']){",
  "       const delta=Math.abs(a[i][key]-b[i][key]);",
  "       if(delta>1){changes++;if(!first)first=key;}",
  "       if(delta>worst)worst=delta;",
  "     }",
  "     if(a[i].position!==b[i].position) {changes++;if(!first)first='position';}",
  "   }",
  "   data.push({index,nodes:a.length,sanitizedNodes:b.length,",
  "    maximumPixelDelta:Math.round(worst*1000)/1000,",
  "    changedProperties:changes,first});",
  " });",
  " verdict.textContent=JSON.stringify({ready:true,cases:data});",
  "}",
  "document.fonts.ready.then(compare).catch(error=>{",
  " verdict.textContent=JSON.stringify({ready:false,error:String(error).slice(0,80)});",
  "});"
].join('\n');
const html='<!doctype html><html><head><meta charset="utf-8"><style>'+
  embeddedKatexCss()+
  '\nbody{font:16px/1.6 system-ui,sans-serif}.case{margin:1em 0}'+
  '</style></head><body>'+content+'<output id="verdict">pending</output>'+
  '<script>'+measure+'</script></body></html>';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-math-geometry-'));
try
{
  const file=path.join(dir,'geometry.html');
  fs.writeFileSync(file,html,{mode:0o600});
  const dumped=execFileSync('chromium',[
    '--headless','--no-sandbox','--disable-gpu',
    '--disable-dev-shm-usage','--disable-extensions',
    '--no-first-run','--virtual-time-budget=10000',
    '--dump-dom','file://'+file
  ],{encoding:'utf8',timeout:45000,maxBuffer:20*1024*1024,
    stdio:['ignore','pipe','pipe']});
  const match=/<output id="verdict">([^<]+)<\/output>/.exec(dumped);
  assert(match,'Chromium did not report KaTeX browser layout measurements');
  const outcome=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  assert.equal(outcome.ready,true);
  assert.equal(outcome.cases.length,equations.length);
  for(const result of outcome.cases)
  {
    assert(result.nodes>20,'Expected nontrivial KaTeX layout nodes');
    assert.equal(result.sanitizedNodes,result.nodes,'KaTeX geometry node disappeared');
    assert(result.maximumPixelDelta<=1.0 && result.changedProperties===0,
      'KaTeX computed visual geometry drift: '+JSON.stringify(result));
  }
  console.log('PASS: real Chromium original-vs-offline KaTeX sub/superscripts, fractions, matrices and radicals (bounded pixel geometry)');
}
finally {fs.rmSync(dir,{recursive:true,force:true});}
