import test from 'node:test';
import assert from 'node:assert/strict';
import {Browser, interpret, stabilizePosition, archiveScrollTarget, replayStepSize, visibleTextOcclusion} from '../live.mjs';

function entry(n,kind,direction,top,max=900) {
  return {n,kind,selector:'#messages',direction,top,max,viewport:300};
}
test('bottom-to-top demonstration retains direction reversal',()=>{
  const plan=interpret([
    entry(1,'wheel','down',870),
    entry(2,'scroll',null,900),
    entry(3,'wheel','up',900),
    entry(4,'scroll',null,650),
    entry(5,'wheel','up',650),
    entry(6,'scroll',null,0)
  ]);
  assert.equal(plan.selector,'#messages');
  assert.deepEqual(plan.actions.map(a=>a.direction),['down','up']);
  assert.deepEqual(plan.actions.map(a=>a.target),['bottom','top']);
  assert.equal(plan.start.top,870);
});
test('observation from top down, then up, not hardcoded to top-down',()=>{
  const p=interpret([
    entry(1,'wheel','up',800),
    entry(2,'scroll',null,400),
    entry(3,'wheel','up',400),
    entry(4,'scroll',null,0)
  ]);
  assert.deepEqual(p.actions.map(a=>a.direction),['up']);
  assert.equal(p.start.top,800);
});
test('keyboard or scroll-bar changes are learned without wheel events',()=>{
  const p=interpret([
    entry(1,'scroll',null,0),
    entry(2,'scroll',null,280),
    entry(3,'scroll',null,600),
    entry(4,'scroll',null,350)
  ]);
  assert.deepEqual(p.actions.map(a=>a.direction),['down','up']);
  assert.equal(p.inference,'scroll-deltas');
});
test('disclosure boundaries remain ordered',()=>{
  const p=interpret([
    entry(1,'wheel','down',0),entry(2,'scroll',null,200),
    {n:3,kind:'disclosure',selector:'details > summary',element:'summary'},
    entry(4,'wheel','up',200),entry(5,'scroll',null,0)
  ]);
  assert.deepEqual(p.actions.map(a=>a.kind),['scroll','disclosure','scroll']);
});

function movableBrowser({top=0,max=900,resetOnce=false}={}){
  return {
    top,max,resetOnce,
    async evaluate(_page,expression){
      if(expression.includes('el.scrollTop=')){
        const match=expression.match(/el\.scrollTop=(-?\d+)/);
        if(!match)throw Error('mock: expected numeric scroll target');
        this.top=Math.max(0,Math.min(this.max,Number(match[1])));
        return true;
      }
      if(this.resetOnce&&this.top!==0){
        this.resetOnce=false;
        this.top=0; // a deferred application scroll overrides first attempt
      }
      return {top:this.top,max:this.max,viewport:300};
    }
  };
}
test('stabilizes target after a deferred SPA position restoration',async()=>{
  const browser=movableBrowser({resetOnce:true});
  const result=await stabilizePosition(browser,'page','#messages',600,
    {attempts:5,delayMs:0,tolerance:2});
  assert.equal(result.ok,true);
  assert.equal(result.position.top,600);
  assert.ok(result.observations.length>=3);
});
test('does not accept a target beyond current scrollable content',async()=>{
  const browser=movableBrowser({top:0,max:100});
  const result=await stabilizePosition(browser,'page','#messages',800,
    {attempts:2,delayMs:0,tolerance:2});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'position-restored-or-drifted');
});

test('MHTML comparison uses exact CSS-pixel scroll rather than height ratio',()=>{
  const offset=archiveScrollTarget(
    {top:14530,max:26925,viewport:900},
    {top:0,max:26470,viewport:900});
  assert.equal(offset.intended,14530);
  assert.equal(offset.target,14530);
  assert.equal(offset.extentDifference,-455);
  assert.equal(offset.clamped,false);
});
test('unreachable original position in reopened MHTML is flagged as incomplete',()=>{
  const offset=archiveScrollTarget(
    {top:26925,max:26925,viewport:900},
    {top:0,max:26712,viewport:900});
  assert.equal(offset.target,26712);
  assert.equal(offset.clamped,true);
});

test('replay stride is less than half the actual visible inner scroll box',()=>
{
  assert.equal(replayStepSize(1000,1000),450);
  assert.equal(replayStepSize(1000,620),279);
  assert.ok(replayStepSize(800,500)<500);
});
test('invalid visible viewport never claims continuous coverage',()=>
{
  assert.throws(()=>replayStepSize(900,0),/replay.visible-scroll-extent-unavailable/);
});

test('fixed input overlay decreases the safe capture stride',()=>{
  assert.equal(replayStepSize(1000,800,0),360);
  assert.equal(replayStepSize(1000,800,200),270);
  assert.ok(replayStepSize(1000,800,200)<replayStepSize(1000,800,0));
});
test('large occlusion estimates never abort scrolling of a valid viewport',()=>{
  assert.equal(replayStepSize(800,500,430),146);
  assert.equal(replayStepSize(800,500,10000),146);
  assert.throws(()=>replayStepSize(800,70,60),
    /replay.visible-scroll-extent-unavailable/);
});

test('observation detects source text actually masked by an overlay',async()=>{
  let overlaid=true;
  const root={getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:700})};
  const owner={contains:hit=>hit===owner};
  const node={textContent:'A useful line of chat text',parentElement:owner};
  const document={
    scrollingElement:{},
    querySelector:()=>root,
    elementFromPoint:()=>overlaid?{contains:()=>false}:owner,
    createTreeWalker:()=>{
      let used=false;
      return {nextNode:()=>used?null:(used=true,node)};
    },
    createRange:()=>({
      selectNodeContents(){},
      getClientRects:()=>[{top:620,bottom:644,left:100,right:500,
        width:400,height:24}]
    })
  };
  const browser={evaluate:async(_page,expression)=>new Function(
    'document','NodeFilter','innerWidth','innerHeight',
    'return '+expression)(document,{SHOW_TEXT:4},800,700)};
  const hidden=await visibleTextOcclusion(browser,'page','#messages');
  assert.equal(hidden.coveredTextLines,1);
  assert.equal(hidden.bottomCoveredCssPixels,80);
  overlaid=false;
  const clear=await visibleTextOcclusion(browser,'page','#messages');
  assert.equal(clear.coveredTextLines,0);
  assert.equal(clear.bottomCoveredCssPixels,0);
});

test('persistent CDP commands share the managed session and preserve envelope',async()=>{
  const browser=new Browser('/usr/bin/mock-browser');
  const issued=[];
  browser.cmd=async(...args)=>{
    issued.push(args);
    if(args[0]==='debug'&&args[1]==='session')
      return {session:'debug-1',result:{result:{value:17}}};
    return {result:{value:18}};
  };
  browser.registerDebugSession('page-1','debug-1');
  assert.equal((await browser.cdp('page-1','Runtime.evaluate',
    {expression:'17'})).result.value,17);
  assert.deepEqual(issued[0].slice(0,5),
    ['debug','session','send','debug-1','Runtime.evaluate']);
  browser.unregisterDebugSession('page-1');
  assert.equal((await browser.cdp('page-1','Runtime.evaluate',
    {expression:'18'})).result.value,18);
  assert.deepEqual(issued[1].slice(0,4),
    ['debug','cdp','page-1','Runtime.evaluate']);
});
