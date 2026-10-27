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


test('off-screen card scrolls once, then must pass a new viewport and hit test',()=>
{
  const old={document:globalThis.document,window:globalThis.window,
    location:globalThis.location,innerWidth:globalThis.innerWidth,
    innerHeight:globalThis.innerHeight,active:globalThis.__rumiaiSourceActive,
    trusted:globalThis.__rumiaiTrustedSourceIntent};
  let top=1500,scrolled=0;
  const card={isConnected:true,getBoundingClientRect(){
    return {left:10,right:110,top,bottom:top+40,width:100,height:40};
  },scrollIntoView(opts){
    assert.equal(opts.block,'center');
    scrolled++;
    top=70;
  },contains(node){return node===this;}};
  try{
    globalThis.window={open(){throw Error('Unexpected navigation');}};
    globalThis.location={href:'https://chatgpt.com/share/test'};
    globalThis.innerWidth=800;
    globalThis.innerHeight=400;
    globalThis.document={getElementById(){
      return {querySelectorAll(){return [card];}};
    },elementFromPoint(){return card;}};
    globalThis.__rumiaiSourceActive={trigger:{
      getAttribute(){return 'source-list';}
    }};
    delete globalThis.__rumiaiTrustedSourceIntent;
    const before=browserPrepareTrustedSourceCard(0,1);
    assert.equal(before.status,'scroll-pending');
    assert.equal(scrolled,1);
    const after=browserPrepareTrustedSourceCard(0,1,false);
    assert.equal(after.status,'ready');
    assert.equal(after.y,90);
    assert.equal(scrolled,1);
  }finally{
    for(const [key,value] of Object.entries({
      document:old.document,window:old.window,location:old.location,
      innerWidth:old.innerWidth,innerHeight:old.innerHeight,
      __rumiaiSourceActive:old.active,
      __rumiaiTrustedSourceIntent:old.trusted
    })){
      if(value===undefined)delete globalThis[key];
      else globalThis[key]=value;
    }
  }
});

test('off-screen retry does not dispatch any mouse input when still invisible',async()=>
{
  const calls=[],events=[];
  let prepareCalls=0;
  const cdp={blockRequests:false,blockedRequestEvents:[],async send(method,params){
    calls.push(method);
    if(method==='Fetch.enable')return {};
    if(method==='Runtime.evaluate'){
      if(params.expression.includes('browserPrepareTrustedSourceCard')){
        prepareCalls++;
        return {result:{value:prepareCalls===1?
          {status:'scroll-pending'}:{status:'card-not-visible'}}};
      }
      throw Error('Unexpected readback');
    }
    throw Error('Unexpected CDP method '+method);
  }};
  await probeTrustedSourceGroup(cdp,'session',event=>events.push(event),
    {ordinal:6,index:1,expectedSources:1});
  assert.deepEqual(calls,
    ['Fetch.enable','Runtime.evaluate','Runtime.evaluate']);
  assert.equal(events[0].attempts[0].status,'card-not-visible');
  assert.equal(events[0].attempts[0].scrollAttempted,true);
  assert.equal(events[0].attempts[0].windowOpen.length,0);
});
