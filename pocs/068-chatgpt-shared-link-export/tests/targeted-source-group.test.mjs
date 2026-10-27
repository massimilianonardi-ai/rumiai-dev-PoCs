'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {liveHoverSource,sampleLiveShareInteractions}
  from '../inspect-live-share-interactions.mjs';

test('targeted source activation skips every other group, including earlier pills',()=>
{
  const old={document:globalThis.document,MouseEvent:globalThis.MouseEvent,
    PointerEvent:globalThis.PointerEvent,
    seen:globalThis.__rumiaiSourceHovered,
    active:globalThis.__rumiaiSourceActive};
  const clicks=[],scrolls=[];
  function trigger(ordinal,index){
    return {localName:'button',
      getAttribute(name){
        if(name==='aria-expanded')return 'false';
        if(name==='aria-controls')return ordinal+'-'+index;
        return null;
      },
      closest(){return null;},
      scrollIntoView(){scrolls.push(ordinal+':'+index);},
      dispatchEvent(){},
      click(){clicks.push(ordinal+':'+index);}
    };
  }
  function wrapper(ordinal,count)
  {
    const spans=Array.from({length:count},(_,index)=>({
      textContent:'+1',children:[],
      closest(sel){assert.equal(sel,'[aria-haspopup]');return trigger(ordinal,index);}
    }));
    return {
      querySelector(){return {getAttribute(){return 'conversation-turn-'+ordinal;}};},
      querySelectorAll(selector){assert.equal(selector,'span');return spans;}
    };
  }
  try{
    globalThis.MouseEvent=class{constructor(){}};
    globalThis.PointerEvent=class{constructor(){}};
    globalThis.document={querySelectorAll(selector){
      if(selector==='[data-turn-id-container]')
        return [wrapper(2,3),wrapper(4,2),wrapper(6,3)];
      if(selector==='a[href]'||selector.includes('[role="dialog"]'))return [];
      throw Error('Unexpected selector '+selector);
    }};
    delete globalThis.__rumiaiSourceHovered;
    delete globalThis.__rumiaiSourceActive;
    const result=liveHoverSource(true,4,1);
    assert.deepEqual({attempted:result.attempted,ordinal:result.ordinal,
      index:result.index,expectedSources:result.expectedSources},
      {attempted:1,ordinal:4,index:1,expectedSources:2});
    assert.deepEqual(clicks,['4:1']);
    assert.deepEqual(scrolls,['4:1']);
    assert.deepEqual([...globalThis.__rumiaiSourceHovered],['4:1']);
  }finally{
    for(const [name,value] of [
      ['document',old.document],['MouseEvent',old.MouseEvent],
      ['PointerEvent',old.PointerEvent],
      ['__rumiaiSourceHovered',old.seen],
      ['__rumiaiSourceActive',old.active]]){
      if(value===undefined)delete globalThis[name];
      else globalThis[name]=value;
    }
  }
});

test('target selection is passed only to the original React hover routine',async()=>
{
  const expressions=[],events=[],callbacks=[];
  const cdp={async send(method,params){
    assert.equal(method,'Runtime.evaluate');
    expressions.push(params.expression);
    if(params.expression.includes('liveExpandMessages'))
      return {result:{value:{clicked:0}}};
    if(params.expression.includes('liveHoverSource'))
      return {result:{value:{attempted:1,ordinal:4,index:1,expectedSources:2}}};
    if(params.expression.includes('liveReadHoverLinks'))
      return {result:{value:{links:[],scopeType:'none'}}};
    throw Error('Unexpected evaluation');
  }};
  await sampleLiveShareInteractions(cdp,'session',event=>events.push(event),
    async(_,__,___,row)=>callbacks.push(row),true,{ordinal:4,index:1});
  assert.ok(expressions.some(expr=>
    expr.includes('liveHoverSource')&&expr.endsWith('(true,4,1)')));
  assert.deepEqual(callbacks.map(x=>[x.ordinal,x.index]),[[4,1]]);
  assert.equal(events.filter(e=>e.kind==='interaction.source-hover').length,1);
});

test('target flag is rejected outside explicitly guarded trusted mode',()=>
{
  const result=spawnSync(process.execPath,[
    new URL('../render-probe.mjs',import.meta.url).pathname,
    'https://example.org/','/tmp/poc068-should-not-create',
    '--source-group','4:1','--headless','--sweep'],{
    encoding:'utf8',timeout:5000});
  assert.equal(result.status,2);
  assert.match(result.stderr,/Usage: node render-probe/);
});
