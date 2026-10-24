'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import katex from 'katex';
import {renderSameSessionOffline} from '../../render-same-session-offline.mjs';
import {inspectActualKatexComputed} from '../../inspect-katex-computed.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-computed-original-export-'));
const capture=path.join(tmp,'capture');
try
{
  fs.mkdirSync(path.join(capture,'turns'),{recursive:true});
  const math=katex.renderToString(
    '\\frac{x_{j+1}^2}{\\sqrt{1+y_k^2}} + \\sum_{i=1}^n a_i',
    {output:'html',displayMode:true,throwOnError:true});
  const html='<section data-turn-id-container="secret-turn">'+
    '<div data-testid="conversation-turn-2"><div data-message-id="secret-message">'+
    '<div class="markdown"><p>Private title</p>'+math+'</div></div></div></section>';
  const bytes=Buffer.from(html),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(capture,'turns',hash+'.html'),bytes);
  fs.writeFileSync(path.join(capture,'events.jsonl'),JSON.stringify({
    kind:'turn.snapshot',sequence:1,turnId:'secret-turn',messageIds:['secret-message'],
    sessionId:'secret-session',file:'turns/'+hash+'.html',sha256:hash,
    bytes:bytes.length,imageSelections:[]
  })+'\n');
  const reading=path.join(tmp,'reading');
  const built=renderSameSessionOffline(capture,reading);
  assert.equal(built.visualKatexFormulas,1);
  const clean=inspectActualKatexComputed(capture,reading);
  assert.equal(clean.examinedTurns,1);
  assert.equal(clean.totals.pairs,1);
  assert.equal(clean.totals.tagMismatches,0);
  assert.equal(clean.totals.nodeGeometryChanges,0);
  assert.equal(Object.values(clean.totals.computedStyleChanges)
    .reduce((a,b)=>a+b,0),0);

  // Validate that the real Chromium test catches an actual formula style
  // difference, not merely DOM inequality or a stylesheet string mismatch.
  const index=path.join(reading,'index.html');
  const prior=fs.readFileSync(index,'utf8');
  const altered=prior.replace('class="katex-html"',
    'class="katex-html" style="font-size:0.5em"');
  assert.notEqual(altered,prior);
  fs.writeFileSync(index,altered);
  const failure=inspectActualKatexComputed(capture,reading);
  assert(failure.totals.nodeGeometryChanges>0);
  assert((failure.totals.computedStyleChanges.fontSize||0)>0);
  const json=JSON.stringify(failure);
  for(const secret of ['secret-message','secret-session','secret-turn',
    'Private title','\\frac','x_{j+1}','font-size:0.5em',hash])
    assert(!json.includes(secret),'Leaked private content '+secret);
  console.log('PASS: real Chromium computes actual captured math geometry and detects browser style drift without revealing private values');
}
finally{fs.rmSync(tmp,{recursive:true,force:true});}
