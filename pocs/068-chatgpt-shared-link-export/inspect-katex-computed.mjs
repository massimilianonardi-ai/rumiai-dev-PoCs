'use strict';
// Compare actual captured vs exported KaTeX geometry with identical archived
// offline CSS in Chromium. Formula text, URLs, styles and HTML never emitted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseHTML} from 'linkedom';
import {selectedSnapshots,orderedVisualOutput} from './inspect-katex-difference.mjs';

const getFormulas=scope=>[...scope.querySelectorAll('.katex')].filter(node=>
  node.getAttribute('class')?.split(/\s+/).includes('katex') &&
  !node.parentElement?.closest('.katex'));
const browserScript=[
"(() => {",
"const output=document.getElementById('result');",
"const props=['fontSize','fontFamily','fontWeight','lineHeight','verticalAlign',",
" 'position','display','borderTopWidth','borderBottomWidth',",
" 'borderLeftWidth','borderRightWidth','transform'];",
"const round=n=>Math.round(n*1000)/1000;",
"function take(root){",
" const start=root.getBoundingClientRect();",
" return [root,...root.querySelectorAll('*')].map(el=>{",
" const b=el.getBoundingClientRect(),s=getComputedStyle(el),style={};",
" for(const k of props)style[k]=s[k];",
" return {tag:el.localName,style,x:round(b.x-start.x),y:round(b.y-start.y),",
" w:round(b.width),h:round(b.height)};});}",
"function compare(pair){",
" const a=take(pair.querySelector('.reference .katex'));",
" const b=take(pair.querySelector('.exported .katex'));",
" const r={sourceNodes:a.length,exportNodes:b.length,tagMismatches:0,",
"   nodeGeometryChanges:0,maximumPixelDelta:0,computedStyleChanges:{}};",
" for(let i=0;i<Math.min(a.length,b.length);i++){",
"  if(a[i].tag!==b[i].tag){r.tagMismatches++;continue;}",
"  let changed=false;",
"  for(const coord of ['x','y','w','h']){",
"    const delta=Math.abs(a[i][coord]-b[i][coord]);",
"    r.maximumPixelDelta=Math.max(r.maximumPixelDelta,delta);",
"    if(delta>0.75)changed=true;",
"  }",
"  if(changed)r.nodeGeometryChanges++;",
"  for(const p of props)if(a[i].style[p]!==b[i].style[p])",
"    r.computedStyleChanges[p]=(r.computedStyleChanges[p]||0)+1;",
" }return r;}",
"function done(){",
" const rows=[...document.querySelectorAll('[data-math-pair]')].map(el=>({",
"  ordinal:Number(el.dataset.ordinal),...compare(el)}));",
" const total={pairs:rows.length,sourceNodes:0,exportNodes:0,",
"  tagMismatches:0,nodeGeometryChanges:0,maximumPixelDelta:0,",
"  computedStyleChanges:{}};",
" const turns=[];",
" for(const r of rows){",
"  for(const key of ['sourceNodes','exportNodes','tagMismatches','nodeGeometryChanges'])",
"    total[key]+=r[key];",
"  total.maximumPixelDelta=Math.max(total.maximumPixelDelta,r.maximumPixelDelta);",
"  let t=turns.find(v=>v.ordinal===r.ordinal);",
"  if(!t){t={ordinal:r.ordinal,pairs:0,changedGeometryNodes:0,",
"     maximumPixelDelta:0,computedStyleChanges:{}};turns.push(t);}",
"  t.pairs++;t.changedGeometryNodes+=r.nodeGeometryChanges;",
"  t.maximumPixelDelta=Math.max(t.maximumPixelDelta,r.maximumPixelDelta);",
"  for(const [key,n] of Object.entries(r.computedStyleChanges)){",
"    total.computedStyleChanges[key]=(total.computedStyleChanges[key]||0)+n;",
"    t.computedStyleChanges[key]=(t.computedStyleChanges[key]||0)+n;",
"  }",
" }",
" output.textContent=JSON.stringify({ready:true,totals:total,turns});",
"}",
"document.fonts.ready.then(done).catch(()=>{",
" output.textContent=JSON.stringify({ready:false,error:'font-readiness'});",
"});",
"})();"
].join('\n');
function readCss(reading)
{
  const {document}=parseHTML(fs.readFileSync(path.join(reading,'index.html'),'utf8'));
  const css=document.querySelector('style')?.textContent||'';
  if(css.length<10000||css.length>10000000||
      /@import\b|<\/style/i.test(css)||
      /url\(\s*(?!"?data:)/i.test(css))
    throw Error('Unexpected non-inert offline stylesheet');
  return css;
}
function safeMath(root)
{
  const tags=new Set(['span','svg','path','g','rect','line','br']);
  for(const element of [root,...root.querySelectorAll('*')])
  {
    if(!tags.has(element.localName))throw Error('KaTeX DOM has unsupported tag');
    for(const name of element.getAttributeNames())
      if(/^on/i.test(name)||['src','href','srcdoc','xmlns:xlink'].includes(name.toLowerCase()))
        throw Error('KaTeX DOM has executable or URL attribute');
    if(/@import|url\s*\(|expression\s*\(/i.test(element.getAttribute('style')||''))
      throw Error('KaTeX DOM has URL-bearing CSS');
  }
  return root.outerHTML;
}
export function inspectActualKatexComputed(captureDir,readingDir)
{
  const sources=selectedSnapshots(path.resolve(captureDir));
  const outputs=orderedVisualOutput(path.resolve(readingDir));
  if(sources.length!==outputs.length)throw Error('Turn count mismatch');
  const css=readCss(readingDir);
  let content='',pairs=0;
  for(let i=0;i<sources.length;i++)
  {
    const original=getFormulas(sources[i].wrapper);
    const exported=getFormulas(outputs[i]);
    if(original.length!==exported.length)
      throw Error('Formula root count mismatch in ordinal '+sources[i].ordinal);
    for(let j=0;j<original.length;j++)
    {
      if(++pairs>1000)throw Error('Too many formulas');
      content+='<section data-math-pair data-ordinal="'+sources[i].ordinal+
        '"><div class="reference">'+safeMath(original[j])+
        '</div><div class="exported">'+safeMath(exported[j])+'</div></section>';
    }
  }
  if(!pairs)throw Error('No KaTeX formulas');
  const nonce=crypto.randomBytes(24).toString('base64');
  const html='<!doctype html><html><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;;'+
    ' script-src &#39;nonce-'+nonce+'&#39;; style-src &#39;unsafe-inline&#39;;'+
    '&#39;; font-src data:; img-src data:; connect-src &#39;none&#39;;'+
    ' base-uri &#39;none&#39;; form-action &#39;none&#39;">'+
    '<style nonce="'+nonce+'">'+css+
    '\nbody{font:16px/1.6 system-ui,sans-serif}section[data-math-pair]{margin:20px 0}'+
    '</style></head><body>'+content+'<output id="result">pending</output>'+
    '<script nonce="'+nonce+'">'+browserScript+'</script></body></html>';
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-real-katex-css-'));
  try
  {
    const target=path.join(tmp,'comparison.html');
    fs.writeFileSync(target,html,{mode:0o600});
    const browser=execFileSync('chromium',[
      '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--disable-extensions','--no-first-run',
      '--user-data-dir='+path.join(tmp,'profile'),
      '--virtual-time-budget=12000','--dump-dom','file://'+target
    ],{encoding:'utf8',timeout:60000,maxBuffer:60*1024*1024,
      stdio:['ignore','pipe','pipe']});
    const match=/<output id="result">([^<]*)<\/output>/.exec(browser);
    if(!match)throw Error('Chromium did not produce computed results');
    const result=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
    if(result.ready!==true||result.totals.pairs!==pairs)
      throw Error('Chromium measurement incomplete');
    return {status:'private-safe-actual-katex-same-css-comparison',
      examinedTurns:sources.length,...result,
      limitations:[
        'Original DOM and exported DOM were compared under the SAME EXPORTED CSS/fonts, not original live ChatGPT CSS',
        'Zero differences here do not imply visual fidelity to ChatGPT',
        'No formula text, HTML, CSS values, signed URLs or identifiers are included in this report',
        'Temporary private browser files are deleted after measurement'
      ]};
  }
  finally {fs.rmSync(tmp,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===
    path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==4)
  {
    console.error('Usage: node inspect-katex-computed.mjs <capture-dir> <existing-reading-dir>');
    process.exitCode=2;
  }
  else
  {
    try {console.log(JSON.stringify(inspectActualKatexComputed(process.argv[2],process.argv[3]),null,2));}
    catch(error){console.error(error.message);process.exitCode=1;}
  }
}
