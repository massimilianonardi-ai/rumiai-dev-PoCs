import test from 'node:test';
import assert from 'node:assert/strict';
import {contentAnchorShift} from '../alignment.mjs';

const source=[
  {path:[1,0],top:120,fingerprint:101},
  {path:[1,1],top:320,fingerprint:202},
  {path:[1,2],top:520,fingerprint:303}
];

test('matches visible content translated by a uniform MHTML offset',()=>
{
  const archive=source.map(item=>({...item,top:item.top+17}));
  const measured=contentAnchorShift(source,archive);
  assert.equal(measured.usable,true);
  assert.equal(measured.shift,17);
  assert.equal(measured.matches,3);
  assert.equal(measured.spread,0);
});

test('refuses pixel correction when the archived content reflowed',()=>
{
  const archive=source.map((item,i)=>({...item,top:item.top+i*19}));
  const measured=contentAnchorShift(source,archive);
  assert.equal(measured.usable,false);
  assert.equal(measured.reason,'content-reflow');
});

test('does not confuse a reused DOM position with different text',()=>
{
  const archive=source.map(item=>({...item,top:item.top+9}));
  archive[1].fingerprint=999;
  const measured=contentAnchorShift(source,archive);
  assert.equal(measured.usable,true);
  assert.equal(measured.matches,2);
  assert.equal(measured.shift,9);
});

test('does not infer an offset from one or zero matching anchors',()=>
{
  assert.equal(contentAnchorShift([],[]).usable,false);
  const measured=contentAnchorShift(source,[source[0]]);
  assert.equal(measured.usable,false);
  assert.equal(measured.reason,'insufficient-matching-content');
});
