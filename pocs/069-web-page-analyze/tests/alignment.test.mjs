import test from 'node:test';
import assert from 'node:assert/strict';
import {contentAnchors,contentAnchorShift} from '../alignment.mjs';

const source=
[
  {key:'24:101',line:0,top:120},
  {key:'28:202',line:0,top:320},
  {key:'34:303',line:0,top:520}
];

test('detects uniform MHTML displacement by text identity',()=>
{
  const archive=source.map(item=>({...item,top:item.top+17}));
  const measured=contentAnchorShift(source,archive);
  assert.equal(measured.usable,true);
  assert.equal(measured.shift,17);
  assert.equal(measured.matches,3);
  assert.equal(measured.spread,0);
});

test('rejects reflow, even when all strings match',()=>
{
  const archive=source.map((item,i)=>({...item,top:item.top+i*19}));
  const measured=contentAnchorShift(source,archive);
  assert.equal(measured.usable,false);
  assert.equal(measured.reason,'content-reflow');
});

test('ignores texts not present in reopened document',()=>
{
  const archive=source.map(item=>({...item,top:item.top+9}));
  archive[1].key='different-content';
  const measured=contentAnchorShift(source,archive);
  assert.equal(measured.usable,true);
  assert.equal(measured.matches,2);
  assert.equal(measured.shift,9);
});

test('cannot infer displacement from zero or one anchor',()=>
{
  assert.equal(contentAnchorShift([],[]).usable,false);
  const measured=contentAnchorShift(source,[source[0]]);
  assert.equal(measured.usable,false);
  assert.equal(measured.reason,'insufficient-matching-content');
});

test('browser DOM paths may change but unique rendered text still matches',async()=>
{
  const texts=
  [
    {textContent:'A long unique paragraph about the first observed event',top:120},
    {textContent:'Another distinct sentence describing the second event',top:280},
    {textContent:'The third unique sentence stays mounted after MHTML export',top:470}
  ];
  const root={};
  const document=
  {
    scrollingElement:root,
    createTreeWalker()
    {
      let index=0;
      return {nextNode:()=>texts[index++]||null};
    },
    createRange()
    {
      let text;
      return {
        selectNodeContents(node){text=node;},
        getClientRects()
        {
          return [{top:text.top,bottom:text.top+24,
            left:40,right:740,width:700,height:24}];
        }
      };
    }
  };
  const browser=
  {
    async evaluate(_page,expression)
    {
      const execute=new Function
      (
        'document','NodeFilter','innerWidth','innerHeight',
        'return '+expression
      );
      return execute(document,{SHOW_TEXT:4},900,800);
    }
  };
  const before=await contentAnchors(browser,'page','document.scrollingElement');
  assert.equal(before.length,3);
  texts.reverse();
  texts.forEach(item=>{item.top+=13;});
  const after=await contentAnchors(browser,'page',
    'document.scrollingElement',before);
  const shift=contentAnchorShift(before,after);
  assert.equal(shift.usable,true);
  assert.equal(shift.shift,13);
});

test('repeated text is excluded rather than arbitrarily paired',async()=>
{
  const texts=
  [
    {textContent:'The same repeated paragraph appears twice',top:100},
    {textContent:'The same repeated paragraph appears twice',top:300}
  ];
  const root={};
  const document=
  {
    scrollingElement:root,
    createTreeWalker()
    {
      let index=0;
      return {nextNode:()=>texts[index++]||null};
    },
    createRange()
    {
      let text;
      return {
        selectNodeContents(node){text=node;},
        getClientRects()
        {
          return [{top:text.top,bottom:text.top+20,
            left:40,right:740,width:700,height:20}];
        }
      };
    }
  };
  const browser=
  {
    async evaluate(_page,expression)
    {
      return new Function
      (
        'document','NodeFilter','innerWidth','innerHeight',
        'return '+expression
      )(document,{SHOW_TEXT:4},900,800);
    }
  };
  const anchors=await contentAnchors(browser,'page','document.scrollingElement');
  assert.equal(anchors.length,0);
});
