'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {browserSelectRemainingControl,browserPrepareRemainingControl,
  browserReadRemainingControl,browserDeferRemainingControl,
  browserPrepareRemainingPopupButton,
  browserReadRemainingPopupButton,probeRemainingControls,summarizeRemainingControls}
  from '../inspect-remaining-controls.mjs';

function withGlobals(work)
{
  const originals={};
  for(const name of ['document','globalThis','window','location',
    'innerWidth','innerHeight','getComputedStyle','__rumiaiRemaining'])
    originals[name]=globalThis[name];
  try{return work();}
  finally{
    for(const [name,value] of Object.entries(originals))
    {
      if(name==='globalThis')continue;
      if(value===undefined)delete globalThis[name];
      else globalThis[name]=value;
    }
  }
}
test('Fonti and singleton selection excludes +N and deduplicates mounted controls',()=>
  withGlobals(()=>{
    function childSpan(text){return {textContent:text,children:[],
      querySelectorAll(){return []}};}
    const fonti={localName:'button',textContent:'Fonti',getAttribute(){return null}};
    const singleton={localName:'span',textContent:'Source card',
      getAttribute(name){return name==='aria-haspopup'?'dialog':null;},
      querySelector(selector){if(selector==='[aria-haspopup]')return null;
        if(selector==='img')return {closest(){return null;}};return null;},
      querySelectorAll(selector){return selector==='span'?[]:[];},
      closest(){return null;}};
    const plus={localName:'span',textContent:'OpenAI +1',
      getAttribute(){return 'dialog';},
      querySelector(selector){return selector==='img'?{}:null;},
      querySelectorAll(selector){return selector==='span'?
        [childSpan('+1')]:[];},
      closest(){return null;}};
    const wrapper={
      parentElement:{closest(){return null;}},
      matches(){return false;},
      querySelector(selector){
        if(selector.startsWith('[data-testid'))return {
          getAttribute(){return 'conversation-turn-4';}};
        return null;
      },
      querySelectorAll(selector){
        if(selector==='button')return [fonti];
        if(selector==='[aria-haspopup]')return [singleton,plus];
        return [];
      }
    };
    globalThis.document={querySelectorAll(){return [wrapper];}};
    delete globalThis.__rumiaiRemaining;
    assert.deepEqual(browserSelectRemainingControl(),{
      selected:true,ordinal:4,kind:'fonti',index:0,
      ariaControls:false,tag:'button'});
    assert.deepEqual(browserSelectRemainingControl(),{
      selected:true,ordinal:4,kind:'singleton',index:0,
      ariaControls:false,tag:'span'});
    assert.equal(browserSelectRemainingControl().selected,false);
  })
);
test('remaining-control CDP clicks require Fetch guard, and URLs remain private',async()=>
{
  const calls=[],events=[];
  const cdp={blockRequests:false,blockedRequestEvents:[],async send(method,payload){
    calls.push(method);
    if(method==='Fetch.enable')return {};
    if(method==='Input.dispatchMouseEvent'||method==='Input.dispatchKeyEvent')return {};
    if(method==='Runtime.evaluate')
    {
      if(payload.expression.includes('browserSelectRemainingControl'))
        return {result:{value:calls.filter(x=>x==='Runtime.evaluate').length===1?
          {selected:true,ordinal:2,kind:'singleton',index:0,tag:'span'}:
          {selected:false}}};
      if(payload.expression.includes('browserPrepareRemainingControl'))
        return {result:{value:{status:'ready',x:20,y:20}}};
      if(payload.expression.includes('browserReadRemainingControl'))
        return {result:{value:{active:true,
          opened:['https://example.org/private-target'],
          anchors:[],panelObserved:false}}};
    }
    throw Error('Unexpected method '+method);
  }};
  await probeRemainingControls(cdp,'sid',row=>events.push(row));
  assert.equal(calls[0],'Fetch.enable');
  assert.equal(calls.filter(x=>x==='Input.dispatchMouseEvent').length,3);
  assert.equal(events.length,1);
  assert.equal(events[0].status,'dispatched');
  assert.equal(events[0].opened.length,1);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-other-controls-'));
  try{
    fs.writeFileSync(path.join(root,'events.jsonl'),
      events.map(JSON.stringify).join('\n')+'\n');
    const report=summarizeRemainingControls(root);
    assert.equal(report.controls.length,1);
    assert.equal(report.controls[0].opened,1);
    assert.ok(!JSON.stringify(report).includes('private-target'));
  }finally{fs.rmSync(root,{force:true,recursive:true});}
});
test('network interception failure prevents every remaining-control pointer event',async()=>
{
  const calls=[],events=[];
  await probeRemainingControls({
    blockRequests:false,async send(method){calls.push(method);
      throw Error('Cannot establish Fetch guard');}
  },'sid',row=>events.push(row));
  assert.deepEqual(calls,['Fetch.enable']);
  assert.equal(events[0].kind,'interaction.remaining-guard-unavailable');
});
test('probe mode rejects unsafe or mixed CLI configurations before launching browser',()=>
{
  const script=new URL('../render-probe.mjs',import.meta.url).pathname;
  for(const flags of [
    ['--probe-remaining-controls','--sweep','--observe-interactions'],
    ['--probe-remaining-controls','--sweep','--headless'],
    ['--probe-remaining-controls','--sweep','--headless',
      '--observe-interactions','--probe-trusted-source-card-actions']
  ])
  {
    const r=spawnSync(process.execPath,[script,'https://example.org/',
      '/tmp/poc068-unused-target',...flags],{encoding:'utf8',timeout:5000});
    assert.equal(r.status,2);
    assert.match(r.stderr,/Usage: node render-probe/);
  }
});


test('trusted inner popup button is independently hit-tested before its URL intent is read',()=>
  withGlobals(()=>{
    const card={isConnected:true,getBoundingClientRect(){
      return {left:20,right:120,top:40,bottom:80,width:100,height:40};
    },contains(node){return node===this;}};
    globalThis.innerWidth=1024;
    globalThis.innerHeight=768;
    globalThis.document={elementFromPoint(){return card;}};
    globalThis.__rumiaiRemaining={target:{kind:'singleton'},
      popupButton:card,hooks:{active:null}};
    let ready=browserPrepareRemainingPopupButton();
    assert.deepEqual(ready,{status:'ready',x:70,y:60});
    globalThis.__rumiaiRemaining.hooks.active.opened.push(
      'https://private.example/original-link');
    const recorded=browserReadRemainingPopupButton();
    assert.equal(recorded.active,true);
    assert.deepEqual(recorded.opened,['https://private.example/original-link']);
    assert.equal(globalThis.__rumiaiRemaining.popupButton,null);
    assert.equal(browserPrepareRemainingPopupButton().status,
      'no-unique-popup-button');
  })
);

test('native nested popup click is distinct from parent trigger click',async()=>
{
  const calls=[],events=[];
  let picked=0;
  const cdp={blockRequests:false,blockedRequestEvents:[],async send(method,payload){
    calls.push(method);
    if(method==='Fetch.enable'||method==='Input.dispatchMouseEvent'||
       method==='Input.dispatchKeyEvent')return {};
    if(method==='Runtime.evaluate'){
      const command=payload.expression;
      if(command.includes('browserSelectRemainingControl')){
        picked++;
        return {result:{value:picked===1?
          {selected:true,ordinal:8,kind:'singleton',index:0,tag:'span'}:
          {selected:false}}};
      }
      if(command.includes('browserPrepareRemainingControl'))
        return {result:{value:{status:'ready',x:50,y:60}}};
      if(command.includes('browserReadRemainingControl'))
        return {result:{value:{active:true,panelObserved:true,
          panelButtons:1,opened:[],anchors:[],turnChanged:false,
          popupButtonHasImage:true}}};
      if(command.includes('browserPrepareRemainingPopupButton'))
        return {result:{value:{status:'ready',x:70,y:80}}};
      if(command.includes('browserReadRemainingPopupButton'))
        return {result:{value:{active:true,
          opened:['https://example.org/private-card-target'],anchors:[]}}};
    }
    throw Error('Unexpected method '+method);
  }};
  await probeRemainingControls(cdp,'session',row=>events.push(row));
  assert.equal(events.length,1);
  assert.equal(events[0].status,'dispatched');
  assert.equal(events[0].opened.length,0);
  assert.equal(events[0].popupCardStatus,'dispatched');
  assert.equal(events[0].popupCardOpened.length,1);
  assert.equal(calls[0],'Fetch.enable');
  assert.equal(calls.filter(x=>x==='Input.dispatchMouseEvent').length,6);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-nested-singleton-'));
  try{
    fs.writeFileSync(path.join(dir,'events.jsonl'),
      events.map(JSON.stringify).join('\n')+'\n');
    const report=summarizeRemainingControls(dir);
    assert.equal(report.controls[0].popupCardOpened,1);
    assert.equal(report.controls[0].popupCardStatus,'dispatched');
    assert.equal(report.controls[0].popupButtonHasImage,true);
    assert.ok(!JSON.stringify(report).includes('private-card-target'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('offscreen virtualized Fonti is retried only after scroll cursor moves',()=>
  withGlobals(()=>{
    let cursor=100;
    const fonti={localName:'button',textContent:'Fonti',
      getAttribute(){return null;}};
    const wrapper={parentElement:{closest(){return null;}},matches(){return false;},
      querySelector(){return {getAttribute(){return 'conversation-turn-6';}};},
      querySelectorAll(selector){
        if(selector==='button')return [fonti];
        if(selector==='[aria-haspopup]')return [];
        return [];
      }};
    globalThis.document={
      querySelectorAll(){return [wrapper];},
      querySelector(selector){
        assert.equal(selector,'[data-scroll-root]');
        return {scrollTop:cursor};
      }
    };
    delete globalThis.__rumiaiRemaining;
    assert.equal(browserSelectRemainingControl().selected,true);
    assert.equal(browserDeferRemainingControl(),true);
    assert.equal(browserSelectRemainingControl().selected,false,
      'the next scan at the same cursor must not retry');
    cursor=550;
    assert.deepEqual(browserSelectRemainingControl().kind,'fonti');
    assert.equal(browserDeferRemainingControl(),true);
    cursor=1200;
    assert.equal(browserSelectRemainingControl().selected,true);
    assert.equal(browserDeferRemainingControl(),false,
      'a third failure completes the bounded attempt count');
    cursor=1800;
    assert.equal(browserSelectRemainingControl().selected,false);
  })
);
