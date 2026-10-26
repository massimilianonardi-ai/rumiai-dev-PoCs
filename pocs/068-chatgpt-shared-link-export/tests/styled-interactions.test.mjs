'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectStyledInteractions} from '../inspect-styled-interactions.mjs';

test('reports control shape without leaking private text, URLs or IDs', () =>
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-controls-'));
  try
  {
    fs.mkdirSync(path.join(root,'turns'));
    const html=Buffer.from('<div data-turn-id-container="private-id">' +
      '<div data-testid="conversation-turn-2" data-message-id="private-message">' +
      '<div style="-webkit-line-clamp:3">' +
      'secret-conversation-sentence' +
      '<button aria-expanded="false"><span>Mostra di più</span></button>' +
      '</div><button data-state="closed"><span>OpenAI</span><span>+1</span></button>' +
      '<a href="https://openai.com/?secret=private-token">reference</a>' +
      '</div></div>');
    const hash=crypto.createHash('sha256').update(html).digest('hex');
    fs.writeFileSync(path.join(root,'turns',hash+'.html'),html);
    fs.writeFileSync(path.join(root,'events.jsonl'),JSON.stringify({
      kind:'turn.snapshot',sequence:1,file:'turns/'+hash+'.html',
      sha256:hash,bytes:html.length
    })+'\n');
    const report=inspectStyledInteractions(root);
    assert.equal(report.examinedTurns,1);
    const kinds=report.turns[0].controls.map(item=>item.kind);
    assert.ok(kinds.includes('expand-message'));
    assert.ok(kinds.includes('source-label'));
    assert.ok(kinds.includes('source-count'));
    assert.equal(report.turns[0].styledClampElements,1);
    const serialized=JSON.stringify(report);
    for(const secret of ['private-id','private-message',
      'private-token','secret-conversation-sentence','https://openai.com/'])
      assert.ok(!serialized.includes(secret));
  }
  finally {fs.rmSync(root,{recursive:true,force:true});}
});
