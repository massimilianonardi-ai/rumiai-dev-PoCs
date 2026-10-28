'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {browserSelectRemainingControl,browserPrepareRemainingControl,
  browserReadRemainingControl,probeRemainingControls,summarizeRemainingControls}
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
