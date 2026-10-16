import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureReferencePage } from '../capture-share-reference.mjs';

test('captures direct share-page diagnostic evidence without auth/session state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'share-reference-'));
  const calls = [];
  let pageClosed = false, sessionClosed = false;
  const png = Buffer.from('png-bytes');
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0,3).join(' ');
    if (cmd === 'page new') return {id:'page-1'};
    if (cmd === 'page close') { pageClosed = true; return {closed:true}; }
    if (cmd === 'debug session open') return {session:'debug-1'};
    if (cmd === 'debug session close') { sessionClosed = true; return {closed:true}; }
    if (cmd !== 'debug session send') throw new Error('unexpected command ' + cmd);
    const method = args[4];
    const params = JSON.parse(args[5]);
    if (method === 'Page.navigate') return {result:{frameId:'frame-1'}};
    if (method === 'DOMSnapshot.captureSnapshot')
      return {result:{documents:[{nodes:{nodeName:[0]}}],strings:['HTML']}};
    if (method === 'Accessibility.enable' || method === 'Accessibility.disable')
      return {result:{}};
    if (method === 'Accessibility.getFullAXTree')
      return {result:{nodes:[{nodeId:'1',role:{value:'document'}}]}};
    if (method === 'Page.getFrameTree')
      return {result:{frameTree:{frame:{id:'frame-1',url:'https://chatgpt.com/share/abc'}}}};
    if (method === 'Page.getLayoutMetrics')
      return {result:{cssContentSize:{width:100,height:200}}};
    if (method === 'Page.captureSnapshot')
      return {result:{data:'From: <Saved by Blink>\nContent-Type: text/html\n\n<html></html>'}};
    if (method === 'Page.captureScreenshot')
      return {result:{data:png.toString('base64')}};
    if (method !== 'Runtime.evaluate') throw new Error('unexpected method ' + method);

    if (params.expression.includes('page-reference-settle'))
      return {result:{result:{value:{
        marker:'page-reference-settle', href:'https://chatgpt.com/share/abc',
        title:'Fixture', readyState:'complete', htmlLength:100, textLength:10,
        imageCount:1, resourceCount:1, turnCount:1
      }}}};
    if (params.expression.includes('page-reference-evidence'))
      return {result:{result:{value:{
        marker:'page-reference-evidence',
        meta:{href:'https://chatgpt.com/share/abc',title:'Fixture'},
        html:'<html><body><img src="blob:test"></body></html>',
        text:'fixture text', turns:[{index:0}], images:[{index:0,src:'blob:test'}],
        sources:[], links:[], buttons:[], svgs:[{
          index:0,outerHTML:'<svg><circle/></svg>',outerHTMLLength:20
        }], canvases:[{
          index:0,width:1,height:1,
          dataUrl:'data:image/png;base64,' + png.toString('base64'),error:null
        }], media:[], iframes:[], interestingAttributes:[],
        resources:[{index:0,name:'blob:test',initiatorType:'img'}],
        candidates:[{url:'blob:test',evidence:[{kind:'img-src',index:0}]}],
        inlineJsonScripts:[{index:0,id:'data',attributes:{type:'application/json'},
          text:'{"ok":true}'}]
      }}}};
    if (params.expression.includes('page-reference-share-fetch'))
      return {result:{result:{value:{marker:'page-reference-share-fetch',result:[
        {source:'backend-anon',status:200,contentType:'application/json',
          byteLength:13,body:'{"ok":true}',tooLarge:false},
        {source:'backend-api',status:401,contentType:'application/json',
          byteLength:2,body:'{}',tooLarge:false}
      ]}}}};
    if (params.expression.includes('page-reference-resource-fetch'))
      return {result:{result:{value:{
        marker:'page-reference-resource-fetch',status:200,finalUrl:'blob:test',
        redirected:false,contentType:'image/png',contentDisposition:null,
        byteLength:png.length,base64:png.toString('base64')
      }}}};
    throw new Error('unknown Runtime.evaluate expression');
  };

  try {
    const result = await captureReferencePage(
      'https://chatgpt.com/share/abc',root,{seconds:1,controller:control});
    assert.equal(result.title,'Fixture');
    assert.equal(result.counts.images,1);
    assert.equal(result.counts.candidates_downloaded,1);
    const files = await fs.readdir(result.directory);
    for (const expected of [
      'SUMMARY.json','README.txt','page.html','page.txt','page.mhtml','page.png',
      'elements.json','resources.json','dom-snapshot.json','accessibility-tree.json',
      'frame-tree.json','layout-metrics.json','share-fetch.json',
      'candidate-resources.json','inline-json.json','svg.json','canvas.json'
    ]) assert.ok(files.includes(expected),expected);
    assert.equal(await fs.readFile(path.join(result.directory,'page.png'),'utf8'),
      png.toString('utf8'));
    const candidates = JSON.parse(await fs.readFile(
      path.join(result.directory,'candidate-resources.json'),'utf8'));
    assert.equal(candidates[0].url,'blob:test');
    assert.equal(candidates[0].sha256,
      'ea80334363eed145dfeee51ebae7dc3f1cd7d0c7879f8bfd2070c061d3c33f56');
    assert.equal(pageClosed,true);
    assert.equal(sessionClosed,true);
    const expressions = calls.filter(x=>x[4]==='Runtime.evaluate')
      .map(x=>JSON.parse(x[5]).expression);
    assert.ok(!expressions.some(x=>x.includes('/api/auth/session')));
    assert.ok(!expressions.some(x=>x.includes('localStorage')));
    assert.ok(!expressions.some(x=>x.includes('sessionStorage')));
    assert.ok(!expressions.some(x=>x.includes('document.cookie')));
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});
