'use strict';
// Local-only, private-safe survey of formula representation in captured turns.
// Never prints LaTeX, markup, signed URLs, hashes or message identifiers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {assemble} from './assemble-rendered-dom.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const snapshotPath = /^turns\/([a-f0-9]{64})\.html$/;
const classHas = (node,name) =>
  (node.getAttribute('class')||'').split(/\s+/).includes(name);
function evidence(node)
{
  const innerMath=node.querySelector('math');
  const annotations=[...node.querySelectorAll('annotation')];
  const annotationTex=annotations.some(n =>
    /^application\/x-tex$/i.test(n.getAttribute('encoding')||'') &&
    Boolean(n.textContent?.trim()));
  const attrs=['data-latex','data-tex','data-math','data-formula'];
  const sourceAttr=attrs.some(key => Boolean(node.getAttribute(key)?.trim()));
  const aria=Boolean(node.getAttribute('aria-label')?.trim());
  const visual=Boolean(node.querySelector('.katex-html, .mord, .mop, .mfrac, svg'));
  return {innerMath:!!innerMath,annotationTex,sourceAttr,aria,visual};
}
const zeros=()=>({katexRoots:0,mathmlInKatex:0,texAnnotations:0,texAttributes:0,
  ariaLabels:0,visualOnlyKatex:0,unrecoverableKatex:0,mathElementsOutsideKatex:0,
  legacySubstringMathFalsePositives:0});
function scan(wrapper)
{
  const counts=zeros();
  const roots=[...wrapper.querySelectorAll('*')].filter(n=>classHas(n,'katex'));
  const rootSet=new Set(roots);
  for(const node of roots)
  {
    if(node.parentElement?.closest('.katex')) continue;
    const e=evidence(node);
    counts.katexRoots++;
    if(e.innerMath) counts.mathmlInKatex++;
    if(e.annotationTex) counts.texAnnotations++;
    if(e.sourceAttr) counts.texAttributes++;
    if(e.aria) counts.ariaLabels++;
    if(e.visual && !e.innerMath) counts.visualOnlyKatex++;
    if(!e.innerMath && !e.annotationTex && !e.sourceAttr)
      counts.unrecoverableKatex++;
  }
  for(const math of wrapper.querySelectorAll('math'))
    if(!math.closest('.katex')) counts.mathElementsOutsideKatex++;
  for(const el of wrapper.querySelectorAll('[class]'))
  {
    const cls=el.getAttribute('class')||'';
    if(/\bkatex\b/.test(cls) && !classHas(el,'katex') &&
      !el.closest('.katex') && !['katex-display','katex-html'].includes(cls))
      counts.legacySubstringMathFalsePositives++;
  }
  return counts;
}
export function inspectMathCapture(captureDir)
{
  const capture=path.resolve(captureDir);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-math-survey-'));
  let selected;
  try
  {
    assemble(capture,path.join(tmp,'assembly'),null,{includeUnidentifiedImages:true});
    selected=JSON.parse(fs.readFileSync(path.join(tmp,'assembly','audit.json'),'utf8')).turns;
  }
  finally {fs.rmSync(tmp,{recursive:true,force:true});}
  const events=fs.readFileSync(path.join(capture,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))
    .filter(e=>e.kind==='turn.snapshot'||e.kind==='turn.unidentified-snapshot');
  const bySequence=new Map(events.map(e=>[e.sequence,e]));
  const totals=zeros(), turns=[];
  let earlierMathmlNotSelected=0,earlierTexNotSelected=0;
  function read(e)
  {
    const match=snapshotPath.exec(e.file||'');
    if(!match || match[1]!==e.sha256) throw Error('Invalid private snapshot identity');
    const bytes=fs.readFileSync(path.join(capture,e.file));
    if(digest(bytes)!==e.sha256 || bytes.length!==e.bytes)
      throw Error('Private snapshot failed SHA-256 verification');
    const {document}=parseHTML(bytes.toString('utf8'));
    const wrapper=document.querySelector('[data-turn-id-container]');
    if(!wrapper) throw Error('Snapshot wrapper missing');
    return scan(wrapper);
  }
  for(const turn of selected)
  {
    const e=bySequence.get(turn.selected.sequence);
    if(!e || e.file!==turn.selected.file) throw Error('Audit/event mismatch');
    const selectedScan=read(e);
    const earlier=turn.versions.filter(v=>v.sequence!==turn.selected.sequence);
    let previousMathml=false,previousTex=false;
    for(const v of earlier)
    {
      const other=bySequence.get(v.sequence);
      if(!other) throw Error('Missing earlier snapshot');
      const c=read(other);
      if(c.mathmlInKatex||c.mathElementsOutsideKatex) previousMathml=true;
      if(c.texAnnotations||c.texAttributes) previousTex=true;
    }
    const selectedMathml=selectedScan.mathmlInKatex+
      selectedScan.mathElementsOutsideKatex;
    if(!selectedMathml && previousMathml) earlierMathmlNotSelected++;
    if(!selectedScan.texAnnotations && !selectedScan.texAttributes && previousTex)
      earlierTexNotSelected++;
    for(const [key,value] of Object.entries(selectedScan)) totals[key]+=value;
    if(selectedScan.katexRoots||selectedScan.mathElementsOutsideKatex||
        selectedScan.legacySubstringMathFalsePositives||previousMathml||
        previousTex)
      turns.push({ordinal:turn.ordinal,...selectedScan,
        earlierMathmlNotSelected:!selectedMathml && previousMathml,
        earlierTexNotSelected:!selectedScan.texAnnotations &&
          !selectedScan.texAttributes && previousTex});
  }
  return {
    status:'private-safe-math-structure-only',
    inspectedTurns:selected.length,
    totals,turns,
    alternativeSnapshots:{
      turnsWithMathmlInEarlierButNotSelected:earlierMathmlNotSelected,
      turnsWithTexInEarlierButNotSelected:earlierTexNotSelected
    },
    interpretation:[
      'Counts describe parsed DOM structure only, never the rendered appearance',
      'No original formulas, identities, signed URLs or conversation content are included',
      'MathML and TeX absence in the selected DOM may still require another source of evidence',
      'An earlier snapshot with MathML does not alone justify discarding newer text/image changes'
    ]
  };
}
if(process.argv[1] && path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3)
  {
    console.error('Usage: node inspect-math-capture.mjs <existing-private-capture-dir>');
    process.exitCode=2;
  }
  else
  {
    try {console.log(JSON.stringify(inspectMathCapture(process.argv[2]),null,2));}
    catch(error) {console.error(error.message);process.exitCode=1;}
  }
}
