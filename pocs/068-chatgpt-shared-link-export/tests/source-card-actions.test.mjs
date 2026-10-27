'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserSourceCardIntent,probeSourceCardIntent,
  summarizeSourceCardIntents} from '../inspect-source-card-actions.mjs';

test('browser source probe intercepts popup and anchor clicks, without opening sites',
  async () =>
{
  const prior={window:globalThis.window,document:globalThis.document,
    location:globalThis.location,HTMLAnchorElement:globalThis.HTMLAnchorElement,
    active:globalThis.__rumiaiSourceActive,seen:globalThis.__rumiaiSourceActionSeen};
  let actualOpens=0,actualAnchorClicks=0;
  class Anchor{};
  Anchor.prototype.click=function(){actualAnchorClicks++;};
  const browser={open(){actualOpens++;}};
  const cardOne={isConnected:true,click(){
    globalThis.window.open('https://source.example/one');
  }};
  const cardTwo={isConnected:true,click(){
    const a=new Anchor();
    a.href='https://source.example/two';
    a.click();
  }};
  const popup={querySelectorAll(sel){
    assert.equal(sel,'button');
    return [cardOne,cardTwo];
  }};
  try{
    globalThis.window=browser;
    globalThis.location={href:'https://chatgpt.com/share/example'};
    globalThis.HTMLAnchorElement=Anchor;
    globalThis.__rumiaiSourceActive={trigger:{
      getAttribute(name){return name==='aria-controls'?'test-popup':null;}
    }};
    globalThis.document={getElementById(){return popup;}};
    delete globalThis.__rumiaiSourceActionSeen;
    const result=await browserSourceCardIntent();
    assert.equal(result.status,'probed');
    assert.equal(result.cards.length,2);
    assert.deepEqual(result.cards[0].attemptedOpen,
      ['https://source.example/one']);
    assert.deepEqual(result.cards[1].anchorClick,
      ['https://source.example/two']);
    assert.equal(actualOpens,0);
    assert.equal(actualAnchorClicks,0);
    assert.equal((await browserSourceCardIntent()).status,'already-probed');
  }finally{
    for(const [key,val] of Object.entries({
      window:prior.window,document:prior.document,location:prior.location,
      HTMLAnchorElement:prior.HTMLAnchorElement,
      __rumiaiSourceActive:prior.active,__rumiaiSourceActionSeen:prior.seen
    })){
      if(val===undefined)delete globalThis[key]; else globalThis[key]=val;
    }
  }
});

test('network guard must be enabled before any source-button action',async ()=>
{
  const recorded=[],methods=[];
  const cdp={blockRequests:false,blockedRequestEvents:[],
    async send(method){
      methods.push(method);
      if(method==='Fetch.enable')return {};
      if(method==='Runtime.evaluate')return {result:{value:{
        status:'probed',cards:[{index:0,clicked:true,
          attemptedOpen:['https://source.example/private-path'],
          anchorClick:[],handlerError:false,connected:true}]
      }}};
      throw Error('Unexpected method: '+method);
    }
  };
  await probeSourceCardIntent(cdp,'session',row=>recorded.push(row),
    {ordinal:6,index:1});
  assert.deepEqual(methods,['Fetch.enable','Runtime.evaluate']);
  assert.equal(cdp.blockRequests,true);
  assert.equal(recorded[0].kind,'interaction.source-card-intents');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-action-intent-'));
  try{
    fs.writeFileSync(path.join(dir,'events.jsonl'),
      recorded.map(x=>JSON.stringify(x)).join('\n')+'\n');
    const summary=summarizeSourceCardIntents(dir);
    assert.equal(summary.groups[0].windowOpenTargets,1);
    assert.ok(!JSON.stringify(summary).includes('private-path'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('guard failure prevents Runtime.evaluate and records unavailability',
  async () =>
{
  const records=[],methods=[];
  const cdp={blockRequests:false,blockedRequestEvents:[],
    async send(method){methods.push(method);throw Error('guard unavailable');}};
  await probeSourceCardIntent(cdp,'session',row=>records.push(row),
    {ordinal:2,index:0});
  assert.deepEqual(methods,['Fetch.enable']);
  assert.deepEqual(records.map(x=>x.kind),
    ['interaction.source-card-intents-unavailable',
      'interaction.navigation-guard-unavailable']);
  assert.equal(cdp.blockRequests,true);
});
