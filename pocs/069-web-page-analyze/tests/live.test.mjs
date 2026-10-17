import test from 'node:test';
import assert from 'node:assert/strict';
import {interpret, stabilizePosition} from '../live.mjs';

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
      if(resetOnce&&this.top!==0){
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
