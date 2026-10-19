import test from 'node:test';
import assert from 'node:assert/strict';
import {Accumulator} from '../accumulate-core.mjs';
const msg=(key,html='<article>content</article>',kind='added')=>
  ({kind,key,html,hash:html,role:'assistant',stable:true});
const frame=keys=>({kind:'frame',keys,htmlClass:'dark',
  bodyClass:'font-sans'});
test('retains original nodes after unmount and reconstructs overlap order',()=>{
  const a=new Accumulator();
  for(const p of [msg('a'),msg('b'),frame(['a','b']),
    msg('a','<article>content</article>','removed'),
    msg('c'),frame(['b','c']),msg('d'),frame(['c','d'])])
    a.ingest(p);
  const r=a.report();
  assert.deepEqual(r.keys,['a','b','c','d']);
  assert.equal(r.distinct,4);
  assert.equal(r.orderComponents,1);
  assert.equal(r.orderCycle,false);
  assert.equal(a.nodes.get('a').html,'<article>content</article>');
  assert.equal(a.nodes.get('a').removed,true);
  assert.equal(r.completeExportVerified,false);
});
test('identical remounts remain accounted for and no nodes are discarded',()=>{
  const a=new Accumulator();
  a.ingest(msg('a'));
  a.ingest(msg('a','<article>content</article>','removed'));
  a.ingest(msg('a'));
  assert.equal(a.remounts,1);
  assert.equal(a.nodes.size,1);
  assert.equal(a.nodes.get('a').removed,false);
});
test('disconnected slices are retained but not claimed continuous',()=>{
  const a=new Accumulator();
  for(const p of [msg('a'),msg('b'),frame(['a','b']),
    msg('z'),msg('y'),frame(['z','y'])])a.ingest(p);
  const r=a.report();
  assert.equal(r.distinct,4);
  assert.equal(r.orderComponents,2);
  assert.equal(r.completeExportVerified,false);
});
test('conflicting adjacency cycles are reported instead of silently sorted',()=>{
  const a=new Accumulator();
  for(const p of [msg('x'),msg('y'),frame(['x','y']),
    frame(['y','x'])])a.ingest(p);
  assert.equal(a.report().orderCycle,true);
  assert.equal(a.report().keys.length,2);
});
test('unstable IDs remain visible in the audit',()=>{
  const a=new Accumulator();
  a.ingest({...msg('testid:turn-2'),stable:false});
  assert.equal(a.report().unstableIdentities,1);
});
