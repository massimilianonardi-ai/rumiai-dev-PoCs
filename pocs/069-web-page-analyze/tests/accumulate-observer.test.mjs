import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('a removed and later remounted identical DIV is emitted each time',async()=>{
  const original=await readFile(new URL('../accumulate-observer.js',import.meta.url),
    'utf8');
  let observerCallback;
  const timers=[];
  class Element {
    constructor(id){
      this.id=id;this.parentElement=null;this.isConnected=true;
      this.localName='div';this.attributes=[];
      this.ownerDocument={createElement:()=>new Element('image')};
      this.outerHTML='<div data-message-id="'+id+'"><p>same</p></div>';
    }
    getAttribute(name){return name==='data-message-id'?this.id:null;}
    matches(selector){return selector.includes('[data-message-id]');}
    closest(selector){return selector.includes('[data-message-id]')?this:null;}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    cloneNode(){return new Element(this.id);}
  }
  class MutationObserver {
    constructor(cb){observerCallback=cb;}
    observe(){}
  }
  const window={};
  const document={readyState:'loading',addEventListener(){},
    querySelector(){return null}};
  runInNewContext(original,{window,document,Element,MutationObserver,
    performance:{now:()=>7},setTimeout:fn=>{timers.push(fn);return timers.length;},
    Node:{DOCUMENT_POSITION_FOLLOWING:4,DOCUMENT_POSITION_PRECEDING:2}});
  const msg=new Element('uuid-001');
  function mutate(kind){
    observerCallback([{type:'childList',
      addedNodes:kind==='added'?[msg]:[],
      removedNodes:kind==='removed'?[msg]:[],target:{}}]);
    while(timers.length)timers.shift()();
    return window.__rumiaiAccumulate.drain(20).items;
  }
  const a=mutate('added'),b=mutate('removed'),c=mutate('added');
  assert.equal(a.length,1);assert.equal(a[0].kind,'added');
  assert.equal(b.length,1);assert.equal(b[0].kind,'removed');
  assert.equal(c.length,1);assert.equal(c[0].kind,'added');
  assert.equal(c[0].key,a[0].key);
  assert.equal(c[0].html,a[0].html);
});
