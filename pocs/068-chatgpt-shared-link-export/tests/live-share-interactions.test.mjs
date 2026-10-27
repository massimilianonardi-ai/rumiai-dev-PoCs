'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {liveExpandMessages,liveHoverSource,liveReadHoverLinks,
  sampleLiveShareInteractions,summarizeLiveShareInteractions}
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


test('finds a nested show-more label despite additional button text', () =>
{
  let clicked=0;
  const leaf={children:[],textContent:'Mostra di più'};
  const button={textContent:'Mostra di più Mostra meno',
    querySelectorAll(selector){assert.equal(selector,'span');return [leaf];},
    closest(selector){assert.equal(selector,'[data-can-expand]');return {};},
    click(){clicked++;}
  };
  const former=globalThis.document;
  try
  {
    globalThis.document={querySelectorAll(selector)
    {
      assert.match(selector,/data-conversation-preview-interactive/);
      return [button];
    }};
    const result=liveExpandMessages();
    assert.deepEqual(result,{candidates:1,labelMatches:1,clicked:1});
    assert.equal(clicked,1);
  }
  finally
  {
    if(former===undefined)delete globalThis.document;
    else globalThis.document=former;
  }
});


test('a +N source group activates its aria-haspopup owner and scopes popup links',()=>
{
  const former={
    document:globalThis.document,MouseEvent:globalThis.MouseEvent,
    PointerEvent:globalThis.PointerEvent,
    sourceSeen:globalThis.__rumiaiSourceHovered,
    sourceActive:globalThis.__rumiaiSourceActive
  };
  let clicks=0,expanded=false;
  const trigger={
    localName:'span',
    getAttribute(name){return name==='aria-expanded'?(expanded?'true':'false'):null;},
    dispatchEvent(){},
    click(){clicks++;expanded=true;}
  };
  const leaf={
    children:[],textContent:'+1',
    closest(selector){assert.equal(selector,'[aria-haspopup]');return trigger;}
  };
  const marker={getAttribute(){return 'conversation-turn-2';}};
  const wrapper={
    querySelector(){return marker;},
    querySelectorAll(){return [leaf];}
  };
  const anchors=[
    {href:'https://example.com/s1'},
    {href:'https://example.org/s2'}
  ];
  const popup={
    querySelectorAll(){return anchors;},
    getBoundingClientRect(){return {width:200,height:150};},
    contains(node){return node===this;}
  };
  let present=false;
  try
  {
    delete globalThis.__rumiaiSourceHovered;
    delete globalThis.__rumiaiSourceActive;
    globalThis.MouseEvent=class {constructor(){}};
    globalThis.PointerEvent=class {constructor(){}};
    globalThis.document={
      querySelectorAll(selector)
      {
        if(selector==='[data-turn-id-container]')return [wrapper];
        if(selector==='a[href]')return present?anchors:[];
        if(selector.includes('[role="dialog"]'))return present?[popup]:[];
        throw Error('Unexpected selector: '+selector);
      },
      getElementById(){return null;}
    };
    const first=liveHoverSource();
    assert.equal(first.attempted,1);
    assert.equal(first.expectedSources,2);
    assert.equal(clicks,1);
    present=true;
    const popover=liveReadHoverLinks();
    assert.equal(popover.scopeType,'single-new-popup');
    assert.equal(popover.triggerExpanded,true);
    assert.equal(popover.links.length,2);
    assert.equal(popover.observedNewAnchors,2);
  }
  finally
  {
    for(const [key,value] of [
      ['document',former.document],['MouseEvent',former.MouseEvent],
      ['PointerEvent',former.PointerEvent],
      ['__rumiaiSourceHovered',former.sourceSeen],
      ['__rumiaiSourceActive',former.sourceActive]])
    {
      if(value===undefined)delete globalThis[key];
      else globalThis[key]=value;
    }
  }
});
