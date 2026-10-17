import test from 'node:test';
import assert from 'node:assert/strict';
import {contentAnchors,contentAnchorShift} from '../alignment.mjs';

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

test('browser expression locates the same text elements across MHTML states',async()=>
{
  const root={children:[],parentElement:null};
  const body={children:[],parentElement:root};
  root.children=[body];
  const positions=[120,260,490];
  for(let i=0;i<positions.length;i++)
  {
    const element={
      textContent:'Stable paragraph used to match browser viewport text',
      parentElement:body,
      children:[],
      getBoundingClientRect:()=>({
        top:positions[i],left:30,right:650,width:620,height:30
      })
    };
    body.children.push(element);
  }
  root.querySelectorAll=()=>body.children;
  const document={documentElement:root,scrollingElement:root};
  const browser={
    async evaluate(_page,expression)
    {
      return new Function('document','innerWidth','innerHeight',
        'getComputedStyle','return '+expression)(
          document,900,800,()=>({position:'static'}));
    }
  };
  const first=await contentAnchors(browser,'page','document.scrollingElement');
  assert.equal(first.length,3);
  positions.forEach((value,index)=>{positions[index]=value+11;});
  const second=await contentAnchors(browser,'page',
    'document.scrollingElement',first);
  assert.equal(contentAnchorShift(first,second).shift,11);
});
