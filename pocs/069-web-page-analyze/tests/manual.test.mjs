import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkActivity,shouldSampleCapture,compareMessageCoverage}
  from '../manual.mjs';

test('network lifecycle preserves inflight and finish/failure counts',()=>{
  const net=new NetworkActivity();
  net.consume([
    {sequence:1,method:'Network.requestWillBeSent',
      params:{requestId:'one',type:'Fetch'}},
    {sequence:2,method:'Network.requestWillBeSent',
      params:{requestId:'two',type:'Image'}}
  ],100);
  assert.equal(net.summary().pending,2);
  net.consume([
    {sequence:3,method:'Network.loadingFinished',params:{requestId:'one'}},
    {sequence:4,method:'Network.loadingFailed',params:{requestId:'two'}}
  ],200);
  assert.deepEqual({pending:net.summary().pending,
    finished:net.summary().finished,failed:net.summary().failed},
    {pending:0,finished:1,failed:1});
  assert.equal(net.lastChange,200);
});

test('long lived background streams are not treated as network blockers',()=>{
  const net=new NetworkActivity();
  net.consume([{sequence:1,method:'Network.requestWillBeSent',
    params:{requestId:'stream',type:'EventSource'}}],100);
  assert.equal(net.summary().pending,0);
  assert.equal(net.summary().started,1);
});

test('out of order event sequences are rejected',()=>{
  const net=new NetworkActivity();
  net.consume([{sequence:1,method:'Network.loadingFinished',
    params:{requestId:'one'}}],100);
  assert.throws(()=>net.consume([{sequence:1,method:'Network.loadingFailed',
    params:{requestId:'one'}}],200),/manual.network-events-not-monotonic/);
});

test('manual screenshots are driven by observed activity and quiet intervals',()=>{
  assert.equal(shouldSampleCapture({initial:true}).capture,true);
  assert.equal(shouldSampleCapture({changed:false,sinceCapture:2500}).capture,false);
  assert.equal(shouldSampleCapture({changed:true,sinceCapture:400,
    quietFor:800,networkPending:0}).capture,false);
  const quiet=shouldSampleCapture({changed:true,sinceCapture:900,
    quietFor:800,networkPending:0});
  assert.deepEqual(quiet,{capture:true,settled:true,reason:'observed-quiescence'});
  const busy=shouldSampleCapture({changed:true,sinceCapture:2100,
    quietFor:10,networkPending:3});
  assert.deepEqual(busy,{capture:true,settled:false,reason:'active-progress'});
});

test('user prompts observed manually but missing on replay are reported',()=>{
  const manual={messageSignatures:{user:['u1','u2'],assistant:['a1']}};
  const replay=[{messageInventory:[
    {role:'user',signature:'u1'},{role:'assistant',signature:'a1'}]}];
  const result=compareMessageCoverage(manual,replay);
  assert.equal(result.status,'missing-observed-messages');
  assert.deepEqual(result.missingSignatures.user,['u2']);
  assert.equal(result.entireConversationVerified,false);
});

test('unknown role markup is never silently interpreted as no user prompts',()=>{
  const result=compareMessageCoverage(
    {messageSignatures:{user:[],assistant:[]}},[]);
  assert.equal(result.status,'manual-role-unverified');
});

test('matching observed samples do not prove the entire virtualized chat',()=>{
  const result=compareMessageCoverage(
    {messageSignatures:{user:['u1'],assistant:['a1']}},
    [{messageInventory:[{role:'user',signature:'u1'},
      {role:'assistant',signature:'a1'}]}]);
  assert.equal(result.status,'matching-observed-samples');
  assert.equal(result.entireConversationVerified,false);
});
