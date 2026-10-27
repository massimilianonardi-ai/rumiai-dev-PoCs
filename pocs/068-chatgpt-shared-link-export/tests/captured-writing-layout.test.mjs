'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectCapturedWritingLayout} from '../inspect-captured-writing-layout.mjs';

test('inspects captured writing-editor ancestors without exposing text or CSS values',()=>
{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-writing-layout-'));
  try
  {
    fs.mkdirSync(path.join(dir,'turns'));
    const html=Buffer.from('<div data-turn-id-container="turn-secret">' +
      '<div data-testid="conversation-turn-2">' +
      '<section data-d-component="writing-block">' +
      '<div style="--writing-block-editor-pl:0px;--writing-block-editor-pb:0px;' +
      'padding-inline-start:12px">secret body text</div></section></div></div>');
    const digest=crypto.createHash('sha256').update(html).digest('hex');
    fs.writeFileSync(path.join(dir,'turns',digest+'.html'),html);
    const event={kind:'turn.snapshot',sequence:1,sha256:digest,
      bytes:html.length,file:'turns/'+digest+'.html'};
    fs.writeFileSync(path.join(dir,'events.jsonl'),JSON.stringify(event)+'\n');
    const result=inspectCapturedWritingLayout(dir);
    assert.equal(result.candidateCount,1);
    assert.equal(result.editors[0].ordinal,2);
    assert.ok(result.editors[0].ancestry[0].styleKeys.includes('--writing-block-editor-pb'));
    const output=JSON.stringify(result);
    for(const secret of ['secret body text','turn-secret','0px','12px'])
      assert.ok(!output.includes(secret));
  }
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
