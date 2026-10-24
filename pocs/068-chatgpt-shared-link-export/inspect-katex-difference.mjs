'use strict';
// Private-only structural regression diagnosis for already-saved KaTeX HTML.
// Nothing from conversation text, formula content, signed URLs, raw class
// tokens, IDs, style values or file paths is emitted in the JSON report.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {assemble} from './assemble-rendered-dom.mjs';

const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const snapshotPattern=/^turns\/([0-9a-f]{64})\.html$/;
const allowedCSSKeys=new Set([
  'height','width','min-height','min-width','max-height','max-width',
  'top','left','right','bottom','margin-left','margin-right','margin-top',
  'margin-bottom','padding-left','padding-right','padding-top',
  'padding-bottom','vertical-align','font-size','position',
  'border-bottom-width','border-right-width','border-left-width',
  'border-top-width','border-bottom-style','border-right-style',
  'border-left-style','border-top-style','text-align','background-color',
  'color','opacity','transform','z-index','display','line-height',
  'font-weight','font-family','border-color','border-width'
]);
const geometryAttrs=new Set([
  'width','height','viewBox','preserveAspectRatio','d','x','y',
  'x1','x2','y1','y2','rx','ry','fill','stroke','stroke-width',
  'stroke-linecap','stroke-linejoin','style','class'
]);
const knownTag=new Set(['span','svg','path','g','rect','line','br','math']);
const nontext=element=>[...element.querySelectorAll('*')];
const cssEntries=node=>{
  const raw=node.getAttribute?.('style')||'';
  const items=new Map();
  for (const part of raw.split(';'))
  {
    const idx=part.indexOf(':');
    if(idx<0)continue;
    const property=part.slice(0,idx).trim().toLowerCase();
    if(allowedCSSKeys.has(property))
      items.set(property,part.slice(idx+1).trim());
  }
  return items;
};
const increment=(map,key,n=1)=>map[key]=(map[key]||0)+n;
const empty=()=>({
  formulas:0,sourceNodes:0,exportNodes:0,
  formulaNodeCountMismatches:0,nodeTagMismatches:0,
  classTokenMismatches:0,stylePropertyLosses:{},styleValueChanges:{},
  addedStyleProperties:{},svgGeometryAttributeLosses:{},
  sourceUnknownTagCounts:0
});
function formulas(scope)
{
  return [...scope.querySelectorAll('.katex')].filter(n=>
    n.getAttribute('class')?.split(/\s+/).includes('katex') &&
    !n.parentElement?.closest('.katex'));
}
function compareFormula(source,output,report)
{
  report.formulas++;
  const before=nontext(source),after=nontext(output);
  report.sourceNodes+=before.length;
  report.exportNodes+=after.length;
  if(before.length!==after.length)report.formulaNodeCountMismatches++;
  for (const node of before)
    if(!knownTag.has(node.localName))report.sourceUnknownTagCounts++;
  for(let i=0;i<Math.min(before.length,after.length);i++)
  {
    const x=before[i],y=after[i];
    if(x.localName!==y.localName)
    {
      report.nodeTagMismatches++;
      continue;
    }
    const cls=element=>new Set((element.getAttribute('class')||'')
      .split(/\s+/).filter(Boolean));
    const cx=cls(x),cy=cls(y);
    if(cx.size!==cy.size||[...cx].some(v=>!cy.has(v)))
      report.classTokenMismatches++;
    const sx=cssEntries(x),sy=cssEntries(y);
    for (const [key,value] of sx)
    {
      if(!sy.has(key))increment(report.stylePropertyLosses,key);
      else if(sy.get(key)!==value)increment(report.styleValueChanges,key);
    }
    for (const key of sy.keys())
      if(!sx.has(key))increment(report.addedStyleProperties,key);
    if(['svg','path','g','rect','line'].includes(x.localName))
      for(const key of geometryAttrs)
        if(x.hasAttribute(key)&&!y.hasAttribute(key) && key!=='style')
          increment(report.svgGeometryAttributeLosses,key);
  }
}
function selectedSnapshots(capture)
{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-katex-diff-'));
  let turns;
  try
  {
    assemble(capture,path.join(scratch,'audit'),null,{includeUnidentifiedImages:true});
    turns=JSON.parse(fs.readFileSync(path.join(scratch,'audit','audit.json'),'utf8')).turns;
  }
  finally {fs.rmSync(scratch,{recursive:true,force:true});}
  const eventRows=fs.readFileSync(path.join(capture,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x))
    .filter(e=>e.kind==='turn.snapshot'||e.kind==='turn.unidentified-snapshot');
  const bySequence=new Map(eventRows.map(e=>[e.sequence,e]));
  return turns.map(t=>{
    const e=bySequence.get(t.selected.sequence);
    if(!e || e.file!==t.selected.file || e.sha256!==t.selected.sha256)
      throw Error('Selected source/event identity mismatch');
    const match=snapshotPattern.exec(e.file||'');
    if(!match||match[1]!==e.sha256)
      throw Error('Untrusted snapshot pathname');
    const bytes=fs.readFileSync(path.join(capture,e.file));
    if(sha256(bytes)!==e.sha256||bytes.length!==e.bytes)
      throw Error('Snapshot content integrity failed');
    const {document}=parseHTML(bytes.toString('utf8'));
    const wrapper=document.querySelector('[data-turn-id-container]');
    if(!wrapper) throw Error('Snapshot wrapper missing');
    return {ordinal:t.ordinal,wrapper};
  });
}
function orderedVisualOutput(output)
{
  const file=path.join(output,'index.html');
  const html=fs.readFileSync(file,'utf8');
  const {document}=parseHTML(html);
  return [...document.querySelectorAll('article.turn')];
}
export function inspectKatexDifference(captureDir,readingDir)
{
  const source=selectedSnapshots(path.resolve(captureDir));
  const output=orderedVisualOutput(path.resolve(readingDir));
  if(source.length!==output.length)throw Error('Turn count mismatch');
  const grand=empty(),perTurn=[];
  let markedReferenceTurns=0;
  // This phrase was supplied by the operator; the formula itself never
  // leaves the private host or enters this output.
  const marker='La relazione può essere vista così:';
  for(let index=0;index<source.length;index++)
  {
    const turn=source[index];
    const original=formulas(turn.wrapper);
    const projected=formulas(output[index]);
    if(!original.length&&!projected.length)continue;
    const local=empty();
    local.outputFormulaCount=projected.length;
    local.sourceFormulaCount=original.length;
    const count=Math.min(original.length,projected.length);
    for(let i=0;i<count;i++)compareFormula(original[i],projected[i],local);
    local.unmatchedFormulaRoots=Math.abs(original.length-projected.length);
    const referenceFound=turn.wrapper.textContent?.includes(marker)===true;
    if(referenceFound)markedReferenceTurns++;
    perTurn.push({ordinal:turn.ordinal,referencePhrasePresent:referenceFound,...local});
    for(const key of ['formulas','sourceNodes','exportNodes',
      'formulaNodeCountMismatches','nodeTagMismatches',
      'classTokenMismatches','sourceUnknownTagCounts'])
      grand[key]+=local[key];
    for(const key of ['stylePropertyLosses','styleValueChanges',
      'addedStyleProperties','svgGeometryAttributeLosses'])
      for(const [name,n] of Object.entries(local[key]))
        increment(grand[key],name,n);
  }
  return {
    status:'private-only-captured-vs-exported-katex-structure',
    examinedTurns:source.length,formulaBearingTurns:perTurn.length,
    referencePhraseMatches:markedReferenceTurns,totals:grand,
    turns:perTurn,
    limitations:[
      'Compare original saved DOM against an already rendered offline HTML; no new browsing',
      'Only supported CSS property names and counts are exposed, never values/formula content',
      'A structurally equal formula may still differ in browser geometry due to font/CSS/container context',
      'This report does not establish visual correctness and cannot replace operator acceptance'
    ]
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===
    path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==4)
  {
    console.error('Usage: node inspect-katex-difference.mjs <private-capture-dir> <private-reading-dir>');
    process.exitCode=2;
  }
  else
  {
    try {
      console.log(JSON.stringify(inspectKatexDifference(process.argv[2],
        process.argv[3]),null,2));
    }
    catch(error){console.error(error.message);process.exitCode=1;}
  }
}
