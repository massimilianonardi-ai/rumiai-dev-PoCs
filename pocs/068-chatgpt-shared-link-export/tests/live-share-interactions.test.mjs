'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sampleLiveShareInteractions,summarizeLiveShareInteractions}
  from '../inspect-live-share-interactions.mjs';

test('live interaction observation records private URLs but CLI summary excludes them',
  async () =>
  {
    const recorded=[];
    const cdp={async send(method, params, sid)
    {
      assert.equal(method,'Runtime.evaluate');
      assert.equal(sid,'session');
      if(params.expression.includes('liveExpandMessages')) return {result:{value:{clicked:2}}};
      if(params.expression.includes('liveHoverSource'))
        return {result:{value:{attempted:1,ordinal:6,index:0}}};
      if(params.expression.includes('liveReadHoverLinks'))
        return {result:{value:{links:['https://example.org/private?token=abc']}}};
      throw Error('Unexpected browser evaluation');
    }};
    await sampleLiveShareInteractions(cdp,'session',e=>recorded.push(e));
    assert.deepEqual(recorded.map(e=>e.kind),
      ['interaction.show-more-clicked','interaction.source-hover']);
    assert.equal(recorded[1].links.length,1);
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-interactions-'));
    try
    {
      fs.writeFileSync(path.join(root,'events.jsonl'),
        recorded.map(e=>JSON.stringify(e)).join('\n')+'\n');
      const summary=summarizeLiveShareInteractions(root);
      assert.equal(summary.expandedClickAttempts,2);
      assert.equal(summary.sourceHoverAttempts,1);
      assert.equal(summary.distinctCapturedTargetUrls,1);
      assert.equal(summary.sourceOrdinals[0].ordinal,6);
      assert.ok(!JSON.stringify(summary).includes('private?token=abc'));
    }
    finally {fs.rmSync(root,{recursive:true,force:true});}
  });

test('failed live interactions are explicitly reported without source data', async () =>
{
  const recorded=[];
  const cdp={async send(){throw Error('private browser exception');}};
  await sampleLiveShareInteractions(cdp,'session',e=>recorded.push(e));
  assert.deepEqual(recorded.map(e=>e.kind),
    ['interaction.show-more-unavailable','interaction.source-hover-unavailable']);
  assert.ok(!JSON.stringify(recorded).includes('private browser exception'));
});
