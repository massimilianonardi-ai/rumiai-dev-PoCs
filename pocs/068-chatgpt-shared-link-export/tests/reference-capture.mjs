import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureReferencePage } from '../capture-share-reference.mjs';

function fixtureControl(options = {}) {
  const calls = [];
  let pageClosed = false, sessionClosed = false;
  const png = Buffer.from('png-bytes');
  const probes = {
    meta: { href:'https://chatgpt.com/share/abc', title:'Fixture',
      readyState:'complete', visibilityState:'visible' },
    html: '<html><body><img src="blob:test"></body></html>',
    text: 'fixture text',
    turns: [{index:0,attributes:{'data-turn-key':'turn-1'},text:'turn',rect:{}}],
    images: [{index:0,src:'blob:test',currentSrc:'blob:test',
      naturalWidth:1,naturalHeight:1,attributes:{src:'blob:test'},rect:{}}],
    sources: [],
    links: [],
    buttons: [],
    media: [],
    iframes: [],
    attributes: [],
    resources: [{index:0,name:'blob:test',initiatorType:'img'}],
    candidates: [{url:'blob:test',evidence:[{kind:'img-src',index:0}]}],
    'svg-inventory': [{index:0,attributes:{},rect:{},context:null,outerHTMLLength:20}],
    'canvas-inventory': [{index:0,width:1,height:1,attributes:{},rect:{},context:null}],
    'inline-json-inventory': [{index:0,id:'data',
      attributes:{type:'application/json'},textLength:11}]
  };

  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0,3).join(' ');
    if (cmd === 'page new') return {id:'page-1'};
    if (args[0] === 'page' && args[1] === 'close') {
      pageClosed = true; return {closed:true};
    }
    if (cmd === 'debug session open') return {session:'debug-1'};
    if (cmd === 'debug session close') {
      sessionClosed = true; return {closed:true};
    }
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
        marker:'page-reference-settle',href:'https://chatgpt.com/share/abc',
        title:'Fixture',readyState:'complete',htmlLength:100,textLength:10,
        imageCount:1,resourceCount:1,turnCount:1
      }}}};

    const probeMatch = params.expression.match(/const kind = "([^"]+)"/);
    if (params.expression.includes('page-reference-probe') && probeMatch) {
      const kind = probeMatch[1];
      if (kind === options.failProbe)
        return {result:{result:{type:'undefined'}}};
      return {result:{result:{value:{
        marker:'page-reference-probe',kind,value:probes[kind]
      }}}};
    }

    if (params.expression.includes("kind:'svg'"))
      return {result:{result:{value:{
        marker:'page-reference-body',kind:'svg',index:0,
        value:'<svg><circle/></svg>'
      }}}};
    if (params.expression.includes("kind:'canvas'"))
      return {result:{result:{value:{
        marker:'page-reference-body',kind:'canvas',index:0,
        value:'data:image/png;base64,' + png.toString('base64')
      }}}};
    if (params.expression.includes("kind:'inline-json'"))
      return {result:{result:{value:{
        marker:'page-reference-body',kind:'inline-json',index:0,value:'{"ok":true}'
      }}}};

    if (params.expression.includes('page-reference-share-fetch'))
      return {result:{result:{value:{marker:'page-reference-share-fetch',result:[
        {source:'backend-anon',status:200,contentType:'application/json',
          byteLength:11,body:'{"ok":true}',tooLarge:false},
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

  return {
    control,calls,png,
    closed: () => ({pageClosed,sessionClosed})
  };
}

test('captures shared-page evidence through independent probes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'share-reference-'));
  const fixture = fixtureControl();
  try {
    const result = await captureReferencePage(
      'https://chatgpt.com/share/abc',root,{seconds:1,controller:fixture.control});
    assert.equal(result.title,'Fixture');
    assert.equal(result.counts.images,1);
    assert.equal(result.counts.candidates_downloaded,1);
    assert.equal(result.counts.probes_ok,16);
    assert.equal(result.counts.probes_failed,0);

    const files = await fs.readdir(result.directory);
    for (const expected of [
      'SUMMARY.json','README.txt','page.html','page.txt','page.mhtml','page.png',
      'elements.json','resources.json','dom-snapshot.json','accessibility-tree.json',
      'frame-tree.json','layout-metrics.json','share-fetch.json',
      'candidate-resources.json','inline-json.json','svg.json','canvas.json',
      'PROBES.json','probe-meta.json','probe-images.json','probe-candidates.json'
    ]) assert.ok(files.includes(expected),expected);

    const candidates = JSON.parse(await fs.readFile(
      path.join(result.directory,'candidate-resources.json'),'utf8'));
    assert.equal(candidates[0].url,'blob:test');
    assert.equal(candidates[0].sha256,
      'ea80334363eed145dfeee51ebae7dc3f1cd7d0c7879f8bfd2070c061d3c33f56');

    const probes = JSON.parse(await fs.readFile(
      path.join(result.directory,'PROBES.json'),'utf8'));
    assert.equal(probes.meta.ok,true);
    assert.equal(probes.candidates.ok,true);

    assert.deepEqual(fixture.closed(),{pageClosed:true,sessionClosed:true});
    const expressions = fixture.calls.filter(x=>x[4]==='Runtime.evaluate')
      .map(x=>JSON.parse(x[5]).expression);
    assert.ok(!expressions.some(x=>x.includes('/api/auth/session')));
    assert.ok(!expressions.some(x=>x.includes('localStorage')));
    assert.ok(!expressions.some(x=>x.includes('sessionStorage')));
    assert.ok(!expressions.some(x=>x.includes('document.cookie')));
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('one unavailable evidence probe does not discard other page evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'share-reference-partial-'));
  const fixture = fixtureControl({failProbe:'buttons'});
  try {
    const result = await captureReferencePage(
      'https://chatgpt.com/share/abc',root,{seconds:1,controller:fixture.control});
    assert.equal(result.counts.probes_ok,15);
    assert.equal(result.counts.probes_failed,1);

    const probes = JSON.parse(await fs.readFile(
      path.join(result.directory,'PROBES.json'),'utf8'));
    assert.equal(probes.buttons.ok,false);
    assert.equal(probes.meta.ok,true);
    assert.equal(probes.images.ok,true);

    const elements = JSON.parse(await fs.readFile(
      path.join(result.directory,'elements.json'),'utf8'));
    assert.deepEqual(elements.buttons,[]);
    assert.equal(elements.images.length,1);
    assert.ok((await fs.stat(path.join(result.directory,'page.html'))).size > 0);
    assert.deepEqual(fixture.closed(),{pageClosed:true,sessionClosed:true});
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});
