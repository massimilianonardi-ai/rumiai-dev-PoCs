import test from 'node:test';
import assert from 'node:assert/strict';
import {observableAdvance,traverseAutomatically}
  from '../accumulate-auto.mjs';

const state=(count,signature,scroll=0)=>(
  {probe:{distinct:count,rootY:0,windowY:0,
    pointer:{x:480,y:320,chain:[{tag:'main',top:scroll}]}},
  geometry:signature,visual:signature}
);

test('new virtualized turns are progress even when root scroll remains zero',()=>
{
  assert.deepEqual(observableAdvance(state(17,'same'),state(34,'same')),
    {newIdentities:true,viewportMoved:false,endVerified:false});
  assert.equal(observableAdvance(state(17,'a'),state(17,'b')).viewportMoved,true);
  assert.equal(observableAdvance(state(17,'a'),state(17,'a')).endVerified,false);
});

test('automatic navigation tries actual browser input, then finishes without manual terminal',async()=>
{
  const operations=[];
  const source={
    bringToFront:async()=>{operations.push('front');},
    evaluate:async()=>{operations.push('evaluate');},
    keyboard:{press:async key=>{operations.push(key);}},
    mouse:{move:async()=>{},wheel:async()=>{operations.push('wheel');}}
  };
  const results=[];
  const report=await traverseAutomatically
  ({
    source,
    sample:async()=>state(17,'static'),
    flush:async()=>{results.push('drained');},
    onStep:async event=>{results.push(event.mode);},
    maxSteps:40,idleLimit:2,pauseMs:0
  });
  assert.deepEqual(operations.filter(x=>['PageDown','wheel'].includes(x)),
    ['PageDown','PageDown','wheel','wheel']);
  assert.equal(operations.filter(x=>x==='evaluate').length,3);
  assert.deepEqual(results.filter(x=>x!=='drained'),
    ['keyboard','keyboard','wheel','wheel','last-turn','last-turn']);
  assert.equal(report.steps,6);
  assert.equal(report.stopReason,'automatic-navigation-stalled');
  assert.equal(report.endVerified,false);
});

test('every newly acquired segment is flushed before the next movement',async()=>
{
  const calls=[];
  let count=17;
  const source={
    bringToFront:async()=>{},evaluate:async()=>{},
    keyboard:{press:async()=>{count++;calls.push('key');}},
    mouse:{move:async()=>{},wheel:async()=>{}}
  };
  const report=await traverseAutomatically
  ({
    source,
    sample:async()=>state(count,String(count)),
    flush:async()=>{calls.push('flush');},
    onStep:async()=>{},maxSteps:3,idleLimit:2,pauseMs:0
  });
  assert.deepEqual(calls,['key','flush','key','flush','key','flush']);
  assert.equal(report.newIdentitySteps,3);
  assert.equal(report.steps,3);
  assert.equal(report.stopReason,'automatic-step-budget');
});
