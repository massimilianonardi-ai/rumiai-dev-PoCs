import test from 'node:test';
import assert from 'node:assert/strict';
import {extractChatMetadata} from '../share-metadata.mjs';

function page({title='Integrare Chat e Work',
  firstUserTime=1791457678.553,hasUser=true}={})
{
  const values=['linear_conversation',[],'message','author','role',
    'create_time','user','system'];
  const ref=value=>(values.push(value),values.length-1);
  const author=ref({'_4':hasUser?6:7});
  const timestamp=ref(firstUserTime);
  const message=ref({'_3':author,'_5':timestamp});
  const node=ref({'_2':message});
  values[1]=[node];
  const serialized=JSON.stringify(JSON.stringify(values)+'\n');
  return '<!doctype html><html><head><title>ChatGPT - '+
    title+'</title><meta property="og:title" content="Generic share"></head>'+
    '<body><script>streamController.enqueue('+serialized+')</script></body></html>';
}

test('original title and first user date are extracted, never the generic og title',()=>{
  const found=extractChatMetadata(page());
  assert.deepEqual(found,{
    title:'Integrare Chat e Work',
    createdAt:new Date(1791457678.553*1000).toISOString(),
    date:'2026-10-08'
  });
});

test('chat start is formatted in Europe/Rome rather than UTC date',()=>{
  const timestamp=Date.parse('2026-10-08T23:30:00.000Z')/1000;
  assert.equal(extractChatMetadata(page({firstUserTime:timestamp})).date,
    '2026-10-09');
});

test('missing or generic original title refuses publication',()=>{
  assert.throws(()=>extractChatMetadata(page({title:'ChatGPT'})),
    /title/);
  assert.throws(()=>extractChatMetadata(page().replace(
    'ChatGPT - Integrare Chat e Work','A generic offline archive')),/title/);
});

test('missing first user timestamp refuses publication',()=>{
  assert.throws(()=>extractChatMetadata(page({hasUser:false})),
    /timestamp/);
  assert.throws(()=>extractChatMetadata(page({firstUserTime:'invalid'})),
    /timestamp/);
});

test('invalid hydration refuses publication',()=>{
  assert.throws(()=>extractChatMetadata('<title>ChatGPT - Example</title>'),
    /conversation/);
});
