'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserPrepareTrustedSourceCard,browserReadTrustedSourceCard,
  probeTrustedSourceGroup,summarizeTrustedSourceCards}
  from '../inspect-trusted-source-cards.mjs';

test('browser source-card preparation checks pointer hit and records attempts',()=>
{
  const old={document:globalThis.document,window:globalThis.window,
    location:globalThis.location,innerWidth:globalThis.innerWidth,
    innerHeight:globalThis.innerHeight,active:globalThis.__rumiaiSourceActive,
    trusted:globalThis.__rumiaiTrustedSourceIntent};
  const card={isConnected:true,getBoundingClientRect(){
    return {left:10,right:110,top:20,bottom:60,width:100,height:40};
  },contains(node){return node===this;}};
  const window={open(){throw Error('Would navigate');}};
  try{
    globalThis.window=window;
    globalThis.location={href:'https://chatgpt.com/share/example'};
    globalThis.innerWidth=1024;
    globalThis.innerHeight=768;
    globalThis.document={getElementById(id){
      assert.equal(id,'sources');return {querySelectorAll(){return [card];}};
    },elementFromPoint(){return card;}};
    globalThis.__rumiaiSourceActive={trigger:{
      getAttribute(name){return name==='aria-controls'?'sources':null;}
    }};
    delete globalThis.__rumiaiTrustedSourceIntent;
    const prepared=browserPrepareTrustedSourceCard(0,1);
    assert.equal(prepared.status,'ready');
    assert.equal(prepared.x,60);
    window.open('https://example.org/private-source');
    const evidence=browserReadTrustedSourceCard();
    assert.equal(evidence.active,true);
    assert.equal(evidence.windowOpen.length,1);
    assert.equal(browserReadTrustedSourceCard().active,false);
    assert.equal(browserPrepareTrustedSourceCard(1,1).status,'card-unmounted');
    assert.equal(browserPrepareTrustedSourceCard(0,2).status,'card-count-mismatch');
  }finally{
    for(const [name,val] of [
      ['document',old.document],['window',old.window],['location',old.location],
      ['innerWidth',old.innerWidth],['innerHeight',old.innerHeight],
      ['__rumiaiSourceActive',old.active],
      ['__rumiaiTrustedSourceIntent',old.trusted]
    ]){
      if(val===undefined)delete globalThis[name];
      else globalThis[name]=val;
    }
  }
});

test('trusted source action requires Fetch guard before pointer dispatch',async()=>
{
  const calls=[],events=[];
  const cdp={blockRequests:false,blockedRequestEvents:[],
    async send(method,params){
      calls.push(method);
      if(method==='Fetch.enable')return {};
      if(method==='Input.dispatchMouseEvent')return {};
      if(method==='Runtime.evaluate'){
        if(params.expression.includes('browserPrepareTrustedSourceCard'))
          return {result:{value:{status:'ready',x:50,y:60}}};
        if(params.expression.includes('browserReadTrustedSourceCard'))
          return {result:{value:{active:true,
            windowOpen:['https://example.org/secret-source'],anchorClick:[]}}};
      }
      throw Error('Unexpected CDP method');
    }
  };
  await probeTrustedSourceGroup(cdp,'session',e=>events.push(e),
    {ordinal:2,index:1,expectedSources:1});
  assert.deepEqual(calls,[
    'Fetch.enable','Runtime.evaluate',
    'Input.dispatchMouseEvent','Input.dispatchMouseEvent',
    'Input.dispatchMouseEvent','Runtime.evaluate']);
  assert.equal(events.length,1);
  assert.equal(events[0].attempts[0].status,'dispatched');
  assert.equal(cdp.blockRequests,true);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-trusted-'));
  try{
    fs.writeFileSync(path.join(dir,'events.jsonl'),
      events.map(x=>JSON.stringify(x)).join('\n'));
    const summary=summarizeTrustedSourceCards(dir);
    assert.equal(summary.groups[0].opened,1);
    assert.equal(summary.groups[0].dispatched,1);
    assert.ok(!JSON.stringify(summary).includes('secret-source'));
  }finally{fs.rmSync(dir,{force:true,recursive:true});}
});

test('trusted source input is skipped if network interception fails',async()=>
{
  const calls=[],events=[];
  const cdp={blockRequests:false,blockedRequestEvents:[],async send(method){
    calls.push(method);throw Error('Guard unavailable');
  }};
  await probeTrustedSourceGroup(cdp,'session',e=>events.push(e),
    {ordinal:2,index:0,expectedSources:2});
  assert.deepEqual(calls,['Fetch.enable']);
  assert.deepEqual(events.map(x=>x.kind),
    ['interaction.trusted-source-guard-unavailable']);
});
