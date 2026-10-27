'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectSourceHoverAttribution}
  from '../inspect-source-hover-attribution.mjs';

test('compares a +N indicator with exact href counts, without outputting URLs', () =>
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-source-group-'));
  try
  {
    fs.mkdirSync(path.join(root,'turns'));
    const html=Buffer.from('<div data-turn-id-container="private">' +
      '<div data-testid="conversation-turn-2"><span>+1</span>' +
      '<span>+2</span></div></div>');
    const sha=crypto.createHash('sha256').update(html).digest('hex');
    fs.writeFileSync(path.join(root,'turns',sha+'.html'),html);
    const events=[
      {kind:'turn.snapshot',sequence:1,file:'turns/'+sha+'.html',
        sha256:sha,bytes:html.length},
      {kind:'interaction.source-hover',ordinal:2,index:0,
        links:['https://example.org/private-key','https://example.net/abc']},
      {kind:'interaction.source-hover',ordinal:2,index:1,links:[]}
    ];
    fs.writeFileSync(path.join(root,'events.jsonl'),
      events.map(e=>JSON.stringify(e)).join('\n')+'\n');
    const result=inspectSourceHoverAttribution(root);
    assert.equal(result.exactCountMatches,1);
    assert.deepEqual(result.groups.map(g=>g.countConsistent),[true,false]);
    assert.deepEqual(result.groups.map(g=>g.expectedLinks),[2,3]);
    assert.ok(!JSON.stringify(result).includes('private-key'));
  }
  finally {fs.rmSync(root,{recursive:true,force:true});}
});
