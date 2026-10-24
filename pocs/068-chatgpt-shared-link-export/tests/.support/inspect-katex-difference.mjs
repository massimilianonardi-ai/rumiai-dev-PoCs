'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import katex from 'katex';
import {inspectKatexDifference} from '../../inspect-katex-difference.mjs';
import {renderSameSessionOffline} from '../../render-same-session-offline.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-real-math-diff-'));
const capture=path.join(tmp,'capture');
fs.mkdirSync(path.join(capture,'turns'),{recursive:true});
try
{
  const original=katex.renderToString(
    'x_{j+1}^{2}+\\frac{y_k}{1+z_{n-1}}',
    {output:'html',displayMode:true,throwOnError:true});
  const bytes=Buffer.from(
    '<section data-turn-id-container="secret-turn"><div data-testid="conversation-turn-2">'+
    '<div data-message-id="secret-message"><p>La relazione può essere vista così:</p>'+
    '<div class="markdown">'+original+'</div></div></div></section>');
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(capture,'turns',hash+'.html'),bytes);
  const event={kind:'turn.snapshot',sequence:1,turnId:'secret-turn',
    sessionId:'secret-session',messageIds:['secret-message'],
    sha256:hash,bytes:bytes.length,file:'turns/'+hash+'.html',
    imageSelections:[]};
  fs.writeFileSync(path.join(capture,'events.jsonl'),JSON.stringify(event)+'\n');
  const output=path.join(tmp,'reading');
  const read=renderSameSessionOffline(capture,output);
  assert.equal(read.visualKatexFormulas,1);
  const report=inspectKatexDifference(capture,output);
  assert.equal(report.examinedTurns,1);
  assert.equal(report.formulaBearingTurns,1);
  assert.equal(report.referencePhraseMatches,1);
  assert.equal(report.totals.formulas,1);
  assert.equal(report.totals.nodeTagMismatches,0);
  assert.equal(report.totals.classTokenMismatches,0);
  assert.equal(report.totals.formulaNodeCountMismatches,0);
  assert.equal(Object.values(report.totals.stylePropertyLosses).reduce((a,b)=>a+b,0),0);

  // Mutate only the private output fixture to reproduce a layout regression.
  const content=fs.readFileSync(path.join(output,'index.html'),'utf8');
  const altered=content.replace(/position:absolute/g,'position:fixed')
    .replace(/font-size:(-?[\d.]+(?:em|px))/g,'');
  assert.notEqual(altered,content);
  fs.writeFileSync(path.join(output,'index.html'),altered);
  const broken=inspectKatexDifference(capture,output);
  const differences=Object.values(broken.totals.stylePropertyLosses).reduce((a,b)=>a+b,0)+
    Object.values(broken.totals.styleValueChanges).reduce((a,b)=>a+b,0);
  assert(differences>0,'Actual captured styles must be compared, not synthetic expectations');
  assert.equal(broken.turns[0].ordinal,2);
  assert(broken.turns[0].referencePhrasePresent);
  const json=JSON.stringify(broken);
  for(const privateValue of ['secret-turn','secret-message','secret-session',
    'x_{j+1}','\\frac','position:fixed','position:absolute',
    'La relazione può essere vista così:',hash])
    assert(!json.includes(privateValue),'Private data leaked: '+privateValue);
  console.log('PASS: private-safe comparison of real captured KaTeX HTML versus saved offline output detects lost CSS layout');
}
finally {fs.rmSync(tmp,{recursive:true,force:true});}
