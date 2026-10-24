'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectMathCapture} from '../../inspect-math-capture.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-math-struct-'));
const capture=path.join(root,'capture');
fs.mkdirSync(path.join(capture,'turns'),{recursive:true});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const events=[];
function add(ord,seq,body)
{
  const html='<section data-turn-id-container="turn-'+ord+'">'+
    '<div data-testid="conversation-turn-'+ord+'">'+
    '<div data-message-id="message-'+ord+'">'+body+'</div></div></section>';
  const bytes=Buffer.from(html),hash=sha(bytes),file='turns/'+hash+'.html';
  fs.writeFileSync(path.join(capture,file),bytes);
  events.push({kind:'turn.snapshot',sequence:seq,sessionId:'secret-session',
    turnId:'turn-'+ord,messageIds:['message-'+ord],sha256:hash,
    file,bytes:bytes.length});
}
try
{
  add(1,1,'<span class="katex"><math><mfrac><mi>SECRET</mi><mi>x</mi>'+
    '</mfrac></math></span>');
  add(1,2,'<span class="katex"><span class="katex-html">'+
    '<span class="mord">SECRET</span></span></span>');
  add(2,3,'<span class="katex" data-latex="\\frac{SECRET}{x}">'+
    '<span class="katex-html">SECRET</span></span>');
  add(3,4,'<span class="katex-mathml">SECRET</span>');
  add(4,5,'<math><mi>SECRET</mi></math>');
  fs.writeFileSync(path.join(capture,'events.jsonl'),
    events.map(e=>JSON.stringify(e)).join('\n')+'\n');
  const report=inspectMathCapture(capture);
  assert.equal(report.inspectedTurns,4);
  assert.equal(report.totals.katexRoots,2);
  assert.equal(report.totals.visualOnlyKatex,2);
  assert.equal(report.totals.unrecoverableKatex,1);
  assert.equal(report.totals.texAttributes,1);
  assert.equal(report.totals.mathElementsOutsideKatex,1);
  assert.equal(report.totals.legacySubstringMathFalsePositives,1);
  assert.equal(report.alternativeSnapshots.turnsWithMathmlInEarlierButNotSelected,1);
  const exported=JSON.stringify(report);
  for(const forbidden of ['SECRET','\\frac','secret-session','message-','turn-',
    'sha256','/turns/'])
    assert(!exported.includes(forbidden),'Private content leaked: '+forbidden);
  console.log('PASS: math-structure survey, previous-snapshot comparison, no content leak');
}
finally {fs.rmSync(root,{force:true,recursive:true});}
