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
    getAttribute(name){
      if(name==='aria-expanded')return expanded?'true':'false';
      if(name==='aria-controls')return 'empty-popup-container';
      return null;
    },
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
      getElementById(){return {
        querySelectorAll(){return [];},
        getBoundingClientRect(){return {width:180,height:80};}
      };}
    };
    const first=liveHoverSource();
    assert.equal(first.attempted,1);
    assert.equal(first.expectedSources,2);
    assert.equal(clicks,1);
    present=true;
    const popover=liveReadHoverLinks();
    assert.equal(popover.scopeType,'single-new-popup',
      'empty aria-controls panel must not block a newly visible popup');
    assert.equal(popover.controlledLinkCount,0);
    assert.equal(popover.newVisiblePopupCandidates,1);
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


test('a nonempty aria-controls panel takes precedence over unscoped page links',()=>
{
  const previous=globalThis.__rumiaiSourceActive;
  const former=globalThis.document;
  const linked=[
    {href:'https://example.com/verified-one'},
    {href:'https://example.com/verified-two'}
  ];
  const controlled={
    querySelectorAll(){return linked;},
    getBoundingClientRect(){return {width:150,height:100};}
  };
  try
  {
    globalThis.__rumiaiSourceActive={
      trigger:{getAttribute(name){
        if(name==='aria-controls')return 'popup';
        if(name==='aria-expanded')return 'true';
        return null;
      }},
      beforeAnchors:new Set(),
      beforePopups:new Set()
    };
    globalThis.document={
      querySelectorAll(selector){
        if(selector==='a[href]')return linked;
        return [];
      },
      getElementById(id){assert.equal(id,'popup');return controlled;}
    };
    const result=liveReadHoverLinks();
    assert.equal(result.scopeType,'aria-controls');
    assert.equal(result.links.length,2);
    assert.equal(result.controlledLinkCount,2);
  }
  finally
  {
    if(previous===undefined)delete globalThis.__rumiaiSourceActive;
    else globalThis.__rumiaiSourceActive=previous;
    if(former===undefined)delete globalThis.document;
    else globalThis.document=former;
  }
});
