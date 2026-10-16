import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { captureStructuredSnapshot, recordJsonShape,
  shareUrl } from '../snapshot-acquire.mjs';

function snapshot() {
  return { conversation_id: 'abc', current_node: 'one',
    mapping: { one: { parent: null, message: {
      author: { role: 'user' }, content: { parts: ['a'] }
    } } } };
}

test('share URL validation remains restricted to ChatGPT shared links', () => {
  assert.equal(shareUrl('https://chatgpt.com/share/abc'), 'https://chatgpt.com/share/abc');
  for (const url of ['http://chatgpt.com/share/a', 'https://bad.invalid/share/a',
    'https://chatgpt.com/share/a?auth=secret']) {
    assert.throws(() => shareUrl(url), /share.invalid-url/);
  }
});

test('page-context fetch returns structured shared conversation without event domains', async () => {
  const calls = [];
  let navigated = false;
  const control = async (...args) => {
    calls.push(args);
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session close') return { closed: true };
    if (cmd === 'debug session events')
      throw new Error('event polling must not be used');
    if (cmd === 'debug session send') {
      if (args[4] === 'Page.navigate') {
        navigated = true;
        return { result: { frameId: 'frame-1' } };
      }
      if (args[4] === 'Runtime.evaluate') {
        const params = JSON.parse(args[5]);
        if (params.expression === "location.origin + '|' + document.readyState")
          return { result: { result: { value:
            navigated ? 'https://chatgpt.com|complete' : 'data:|complete' } } };
        if (params.expression.includes('backend-anon')) {
          assert.equal(params.awaitPromise, true);
          return { result: { result: { value: {
            attempts: [{ source: 'backend-anon', status: 200 }],
            snapshot: JSON.stringify(snapshot())
          } } } };
        }
        return { result: { result: { value: [] } } };
      }
      return { result: {} };
    }
    return {};
  };

  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'page-fetch');
  assert.deepEqual(result.snapshot, snapshot());
  assert.deepEqual(result.stats.sourceAttempts,
    [{ source: 'backend-anon', status: 200 }]);
  assert.ok(calls.some(x => x[4] === 'Page.navigate'));
  for (const method of ['Network.enable', 'Debugger.enable',
    'Page.addScriptToEvaluateOnNewDocument', 'Debugger.setBreakpointByUrl']) {
    assert.ok(!calls.some(x => x[4] === method));
  }
  assert.ok(!calls.some(x => x.slice(0, 3).join(' ') === 'debug session events'));
});

test('page-context media acquisition maps renderer generated images to raw asset identity', async () => {
  const imageSnapshot = { conversation_id: 'conv-1', current_node: 'answer', mapping: {
    user1: { parent: null, message: { id: 'u1', author: { role: 'user' },
      content: { parts: ['prompt one'] }, weight: 1 } },
    toolImage1: { parent: 'user1', message: { id: 't1', author: { role: 'tool' },
      content: { content_type: 'multimodal_text', parts: [{
        content_type: 'image_asset_pointer',
        asset_pointer: 'sediment://file_image1?shared_conversation_id=share-1',
        size_bytes: 3, width: 1536, height: 1024
      }] }, weight: 0 } },
    user2: { parent: 'toolImage1', message: { id: 'u2', author: { role: 'user' },
      content: { parts: ['prompt two'] }, weight: 1 } },
    toolImage2: { parent: 'user2', message: { id: 't2', author: { role: 'tool' },
      content: { content_type: 'multimodal_text', parts: [{
        content_type: 'image_asset_pointer',
        asset_pointer: 'sediment://file_image2?shared_conversation_id=share-1',
        size_bytes: 4, width: 1536, height: 1024
      }] }, weight: 0 } },
    userUpload: { parent: 'toolImage2', message: {
      id:'upload', author:{role:'user'}, weight:1,
      content:{content_type:'multimodal_text',parts:[{
        content_type:'image_asset_pointer',
        asset_pointer:'sediment://file_upload?shared_conversation_id=share-1',
        size_bytes:5,width:1536,height:1024
      }]}
    } },
    answer: { parent: 'userUpload', message: { id: 'a', author: { role: 'assistant' },
      channel: 'final', recipient: 'all', content: { parts: ['done'] },
      metadata: { is_complete: true }, end_turn: true, weight: 1 } }
  } };
  let navigated = false;
  const expressions = [];
  const control = async (...args) => {
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session close') return { closed: true };
    if (cmd === 'debug session send' && args[4] === 'Page.navigate') {
      navigated = true; return { result: {} };
    }
    if (cmd === 'debug session send' && args[4] === 'Runtime.evaluate') {
      const params = JSON.parse(args[5]);
      expressions.push(params.expression);
      if (params.expression === "location.origin + '|' + document.readyState")
        return { result: { result: { value:
          navigated ? 'https://chatgpt.com|complete' : 'data:|complete' } } };
      if (params.expression.includes("return { candidates: urls.size")) {
        return { result: { result: { value: { candidates: 4, images: 3 } } } };
      }
      if (params.expression.includes("expectedSizes = new Set")) {
        assert.ok(params.expression.includes('3'));
        assert.ok(params.expression.includes('4'));
        assert.ok(params.expression.includes('new Set([3,4])'));
        assert.ok(!params.expression.includes('new Set([3,4,5])'));
        return { result: { result: { value: [
          { status: 200, byteLength: 3, mimeType: 'image/png', size_match: true,
            url_scheme: 'blob:', base64: Buffer.from('one').toString('base64'),
            evidence: [{ source: 'img', occurrence: 0, complete: false,
              natural_width: 0, natural_height: 0, generated_preview: false,
              button_aria_label: null }] },
          { status: 200, byteLength: 3, mimeType: 'image/png', size_match: true,
            url_scheme: 'blob:', base64: Buffer.from('one').toString('base64'),
            evidence: [{ source: 'download-link', occurrence: 0 }] },
          { status: 200, byteLength: 4, mimeType: 'image/png', size_match: true,
            url_scheme: 'https:', base64: Buffer.from('four').toString('base64'),
            evidence: [{ source: 'performance-img', occurrence: null }] },
          { status: 200, byteLength: 12, mimeType: 'image/png', size_match: false,
            url_scheme: 'https:', evidence: [{ source: 'img', occurrence: 2 }] }
        ] } } };
      }
      if (params.expression.includes('/files/download/'))
        throw new Error('backend-anon file endpoint must not be used when renderer assets match');
      if (params.expression.includes('backend-anon'))
        return { result: { result: { value: {
          attempts: [{ source: 'backend-anon', status: 200 }],
          snapshot: JSON.stringify(imageSnapshot)
        } } } };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/share-1', { seconds: 1 });
  assert.equal(result.assets.length, 3);
  assert.deepEqual(result.assets.map(x => x.file_id),
    ['file_image1', 'file_image2','file_upload']);
  assert.deepEqual(result.assets.map(x => x.downloaded_size_bytes),
    [3, 4, null]);
  assert.deepEqual(result.assets.map(x => x.attempts[0].source),
    ['renderer-generated-image', 'renderer-generated-image',
      'anonymous-share']);
  assert.equal(result.assets[2].attempts[0].disposition,
    'deferred-authenticated-user-upload');
  assert.equal(result.assets[2].base64, null);
  assert.deepEqual(result.assets.map(x => x.references[0].classification),
    ['zero_weight', 'zero_weight', 'visible_candidate']);
  assert.equal(result.assets[0].renderer_references.length, 2);
  assert.equal(result.assets[1].renderer_references.length, 1);
  assert.equal(result.stats.rendererImageCandidates, 4);
  assert.equal(result.stats.rendererImageResources, 2);
  assert.equal(result.stats.rendererImageOccurrences, 3);
  assert.deepEqual(result.stats.rendererImageFetch, {
    attempted: 4, fetched: 4, failed: 0,
    size_matched: 3, size_mismatched: 1
  });
  assert.ok(expressions.some(x => x.includes("expectedSizes = new Set")));
  assert.ok(expressions.some(x => x.includes("return { candidates: urls.size")));
  assert.ok(!expressions.some(x => x.includes('/api/auth/session')));
  assert.ok(!expressions.some(x => x.includes('Authorization')));
});


test('assistant sandbox files use observed file_from_message transport without persisting signed URL', async () => {
  const fileSnapshot = { conversation_id:'conv-files', current_node:'answer', mapping:{
    user:{parent:null,message:{id:'u',author:{role:'user'},
      content:{parts:['make a file']},weight:1}},
    answer:{parent:'user',message:{id:'a',author:{role:'assistant'},
      channel:'final',recipient:'all',weight:1,end_turn:true,
      metadata:{is_complete:true},
      content:{parts:['[report](sandbox:/mnt/data/report.md)']}}}
  }};
  let navigated=false;
  const expressions=[];
  const control=async (...args)=>{
    const cmd=args.slice(0,3).join(' ');
    if(cmd==='page new') return {id:'page-1'};
    if(cmd==='debug session open') return {session:'debug-1'};
    if(cmd==='debug session close') return {closed:true};
    if(cmd==='debug session send' && args[4]==='Page.navigate'){
      navigated=true; return {result:{}};
    }
    if(cmd==='debug session send' && args[4]==='Runtime.evaluate'){
      const params=JSON.parse(args[5]); expressions.push(params.expression);
      if(params.expression==="location.origin + '|' + document.readyState")
        return {result:{result:{value:navigated?'https://chatgpt.com|complete':'data:|complete'}}};
      if(params.expression.includes('file_from_message')){
        assert.ok(params.expression.includes('/mnt/data/report.md'));
        return {result:{result:{value:{
          attempts:[{source:'backend-anon-file-from-message',metadataStatus:200,binaryStatus:200}],
          base64:Buffer.from('# report\n').toString('base64'),
          byteLength:9,mimeType:'text/markdown',fileName:'report.md'
        }}}};
      }
      if(params.expression.includes("return { candidates: urls.size"))
        return {result:{result:{value:{candidates:0,images:0}}}};
      if(params.expression.includes("expectedSizes = new Set"))
        return {result:{result:{value:[]}}};
      if(params.expression.includes('backend-anon'))
        return {result:{result:{value:{
          attempts:[{source:'backend-anon',status:200}],
          snapshot:JSON.stringify(fileSnapshot)
        }}}};
      return {result:{result:{value:[]}}};
    }
    return {};
  };
  const result=await captureStructuredSnapshot(
    control,'https://chatgpt.com/share/share-files',{seconds:1});
  assert.equal(result.files.length,1);
  assert.equal(result.files[0].sandbox_uri,'sandbox:/mnt/data/report.md');
  assert.equal(result.files[0].message_id,'a');
  assert.equal(result.files[0].mime_type,'text/markdown');
  assert.equal(Buffer.from(result.files[0].base64,'base64').toString(),'# report\n');
  assert.equal(result.stats.fileAttempts.length,1);
  assert.ok(expressions.some(x=>x.includes('/file_from_message/')));
  assert.ok(!JSON.stringify(result.stats).includes('oaiusercontent'));
  assert.ok(!expressions.some(x=>x.includes('/api/auth/session')));
});

test('backend-api is represented as safe fallback evidence', async () => {
  const control = async (...args) => {
    const cmd = args.slice(0, 3).join(' ');
    if (cmd === 'page new') return { id: 'page-1' };
    if (cmd === 'debug session open') return { session: 'debug-1' };
    if (cmd === 'debug session close') return { closed: true };
    if (cmd === 'debug session send' && args[4] === 'Page.navigate')
      return { result: {} };
    if (cmd === 'debug session send' && args[4] === 'Runtime.evaluate') {
      const params = JSON.parse(args[5]);
      if (params.expression === "location.origin + '|' + document.readyState")
        return { result: { result: { value: 'https://chatgpt.com|complete' } } };
      if (params.expression.includes('backend-anon'))
        return { result: { result: { value: {
          attempts: [
            { source: 'backend-anon', status: 404 },
            { source: 'backend-api', status: 200 }
          ],
          snapshot: JSON.stringify(snapshot())
        } } } };
      return { result: { result: { value: [] } } };
    }
    return {};
  };
  const result = await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc', { seconds: 1 });
  assert.equal(result.method, 'page-fetch');
  assert.deepEqual(result.stats.sourceAttempts, [
    { source: 'backend-anon', status: 404 },
    { source: 'backend-api', status: 200 }
  ]);
});

test('privacy-safe diagnostics retain shape without values', () => {
  const stats = { jsonShapes: [] };
  recordJsonShape(JSON.stringify({ data: { messages: ['DO NOT PRINT'] }, secret: 'TOKEN' }), stats);
  assert.match(JSON.stringify(stats), /messages/);
  assert.doesNotMatch(JSON.stringify(stats), /DO NOT PRINT|TOKEN/);
});


test('anonymous generated-image DOM resolves stable file id and deduplicates three decorative img layers', async function(){
  const fileId='file_00000000f1c481f48001ad2fb1e682fb';
  const uuid='00000000-f1c4-81f4-8001-ad2fb1e682fb';
  const url='https://sdmntprnortheu.oaiusercontent.com/files/'+uuid+'/raw?se=short-lived&sig=private';
  const fake='https://sdmntprnortheu.oaiusercontent.com/files/00000000-0000-0000-0000-000000000001/raw?sig=unrelated';
  const html='<div data-image-gen-result><div id="image-real">'+
    Array.from({length:3},()=>'<img loading="lazy" width="1536" height="1024" src="'+url.replaceAll('&','&amp;')+'">').join('')+
    '</div></div><div data-image-gen-result><div id="image-unrelated"><img src="'+fake+'"></div></div>';
  const {document}=parseHTML(html);
  let scrollCount=0;
  let stationaryPolls=0;
  document.querySelector('#image-real').scrollIntoView=()=>{scrollCount++;};
  const imageIsLoaded=()=>scrollCount===1 && stationaryPolls>=3;
  for(const img of document.querySelectorAll('img')){
    const pending=img.closest('#image-real')!==null;
    Object.defineProperty(img,'complete',{get:()=>!pending||imageIsLoaded(),configurable:true});
    Object.defineProperty(img,'naturalWidth',{get:()=>pending&&!imageIsLoaded()?0:1536,configurable:true});
    Object.defineProperty(img,'naturalHeight',{get:()=>pending&&!imageIsLoaded()?0:1024,configurable:true});
  }
  const image=Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(12)
  ]);
  const snapshot={conversation_id:'test',current_node:'assistant',mapping:{
    user:{parent:null,message:{id:'u',author:{role:'user'},weight:1,
      content:{parts:['Create image']}}},
    generated:{parent:'user',message:{id:'t',author:{role:'tool'},weight:0,
      content:{content_type:'multimodal_text',parts:[{
        content_type:'image_asset_pointer',
        asset_pointer:'sediment://'+fileId+'?shared_conversation_id=share-test',
        size_bytes:image.length,width:1536,height:1024
      }]}}},
    assistant:{parent:'generated',message:{id:'a',author:{role:'assistant'},
      content:{parts:['Here is the image']},weight:1,end_turn:true}}
  }};
  const requests=[],expressions=[];
  const control=async(...args)=>{
    if(args[0]==='page'&&args[1]==='new')return{id:'page'};
    if(args[0]==='page'&&args[1]==='close')return{closed:true};
    if(args[0]==='debug'&&args[1]==='session'&&args[2]==='open')return{session:'session'};
    if(args[0]==='debug'&&args[1]==='session'&&args[2]==='close')return{closed:true};
    if(args[0]==='debug'&&args[1]==='session'&&args[2]==='send'){
      const method=args[4],params=JSON.parse(args[5]);
      if(method==='Page.navigate')return{result:{}};
      if(method!=='Runtime.evaluate')throw Error('unexpected CDP method');
      expressions.push(params.expression);
      if (params.expression === 'navigator.userAgent')
        return {result:{result:{value:'Mozilla/5.0 Chrome/152.0.7977.130 Safari/537.36'}}};
      if(params.expression==="location.origin + '|' + document.readyState")
        return{result:{result:{value:'https://chatgpt.com|complete'}}};
      if(params.expression.includes("return { candidates: urls.size"))
        return{result:{result:{value:{candidates:4,images:4}}}};
      if(params.expression.includes('function scan(index,shouldActivate)')){
        if(scrollCount===1 && params.expression.endsWith(',false)'))
          stationaryPolls++;
        const data=runInNewContext(params.expression,{
          document,location:{href:'https://chatgpt.com/share/share-test'},URL
        });
        return{result:{result:{value:data}}};
      }
      if(params.expression.includes('backend-anon'))
        return{result:{result:{value:{
          attempts:[{source:'backend-anon',status:200}],
          snapshot:JSON.stringify(snapshot)
        }}}};
      throw Error('unexpected evaluate expression');
    }
    throw Error('unexpected control operation');
  };
  const fetchImage=async (src,options)=>{
    requests.push(src);
    assert.equal(src,url);
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,undefined);
    return new Response(image,{status:200,headers:{
      'content-type':'image/png','content-length':String(image.length)
    }});
  };
  const result=await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/share-test',{seconds:3,fetchImage});
  assert.equal(requests.length,1,'three decorative layers cause one binary fetch');
  assert.equal(result.assets.length,1);
  assert.equal(result.assets[0].file_id,fileId);
  assert.deepEqual(Buffer.from(result.assets[0].base64,'base64'),image);
  assert.equal(result.assets[0].attempts[0].source,'anonymous-generated-image-img-src');
  assert.equal(result.assets[0].renderer_references[0].root_id,'image-real');
  assert.equal(result.assets[0].renderer_references[0].was_loaded,true);
  assert.equal(scrollCount,1,'one scroll, then leave the image stationary');
  assert.ok(stationaryPolls>=3,'lazy decoding needs consecutive stationary polls');
  assert.equal(result.stats.generatedImageDom.identified,1);
  assert.equal(result.stats.generatedImageDom.downloaded,1);
  assert.equal(result.stats.generatedImageDom.expected,1);
  assert.equal(result.stats.generatedImageDom.settled,true);
  assert.equal(result.stats.generatedImageDom.surfaces,2);
  assert.equal(result.stats.generatedImageDom.activated,1);
  assert.equal(result.stats.generatedImageDom.statuses[0].status,'loaded');
  assert.ok(result.stats.generatedImageDom.polls>=5);
  assert.ok(!expressions.some(x=>x.includes('/backend-anon/files/download/')));
  assert.ok(!JSON.stringify(result.stats).includes('sig='));
  assert.ok(!JSON.stringify(result.assets[0].renderer_references).includes('sig='));
});

test('waits for full document load before reading the share snapshot', async () => {
  let readyPolls=0;
  let shareRequested=false;
  const control=async(...args)=>{
    if(args[0]==='page' && args[1]==='new')return{id:'page'};
    if(args[0]==='page' && args[1]==='close')return{closed:true};
    if(args[0]==='debug' && args[1]==='session' && args[2]==='open')
      return{session:'session'};
    if(args[0]==='debug' && args[1]==='session' && args[2]==='close')
      return{closed:true};
    if(args[0]==='debug' && args[1]==='session' && args[2]==='send'){
      const method=args[4],params=JSON.parse(args[5]);
      if(method==='Page.navigate')return{result:{}};
      if(method!=='Runtime.evaluate')throw Error('unexpected method');
      if(params.expression==="location.origin + '|' + document.readyState"){
        readyPolls++;
        return{result:{result:{value:'https://chatgpt.com|'+
          (readyPolls<3?'interactive':'complete')}}};
      }
      if(params.expression.includes('/share/')){
        assert.ok(readyPolls>=3,'snapshot queried only after full load');
        shareRequested=true;
        return{result:{result:{value:{
          attempts:[{source:'backend-anon',status:200}],
          snapshot:JSON.stringify(snapshot())
        }}}};
      }
      return{result:{result:{value:[]}}};
    }
    throw Error('unexpected control call');
  };
  const result=await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/abc',{seconds:1});
  assert.equal(result.method,'page-fetch');
  assert.equal(readyPolls,3);
  assert.equal(shareRequested,true);
});

test('multiple lazy generated images load sequentially without viewport thrashing', async () => {
  const ids=[
    'file_11111111111111111111111111111111',
    'file_22222222222222222222222222222222'
  ];
  const urls=ids.map(fileId=>{
    const hex=fileId.slice(5);
    const uuid=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),
      hex.slice(16,20),hex.slice(20)].join('-');
    return 'https://sdmntprnortheu.oaiusercontent.com/files/'+uuid+
      '/raw?se=short-lived&sig=secret';
  });
  const html=ids.map((fileId,index)=>
    '<div data-image-gen-result><div id="image-'+index+
    '"><img width="1536" height="1024" src="'+
    urls[index].replaceAll('&','&amp;')+'"></div></div>').join('');
  const {document}=parseHTML(html);
  const scrolls=[],stationary=[0,0];
  let active=-1;
  for(let index=0;index<2;index++){
    const root=document.querySelector('#image-'+index);
    root.scrollIntoView=()=>{
      if(index===1) assert.ok(stationary[0]>=3,
        'second image must not be visited until first image finishes');
      scrolls.push(index);active=index;
    };
    const img=root.querySelector('img');
    const loaded=()=>stationary[index]>=3;
    Object.defineProperty(img,'complete',{get:loaded});
    Object.defineProperty(img,'naturalWidth',{get:()=>loaded()?1536:0});
    Object.defineProperty(img,'naturalHeight',{get:()=>loaded()?1024:0});
  }
  const image=Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(12)
  ]);
  const content=fileId=>({content_type:'multimodal_text',parts:[{
    content_type:'image_asset_pointer',
    asset_pointer:'sediment://'+fileId+'?shared_conversation_id=two',
    size_bytes:image.length,width:1536,height:1024
  }]});
  const snapshot={
    conversation_id:'two',current_node:'assistant',
    mapping:{
      user:{parent:null,message:{id:'user',author:{role:'user'},
        content:{parts:['Make two images']},weight:1}},
      tool1:{parent:'user',message:{id:'tool1',author:{role:'tool'},
        content:content(ids[0]),weight:0}},
      tool2:{parent:'tool1',message:{id:'tool2',author:{role:'tool'},
        content:content(ids[1]),weight:0}},
      assistant:{parent:'tool2',message:{id:'assistant',
        author:{role:'assistant'},content:{parts:['Two images']},
        weight:1,end_turn:true}}
    }
  };
  const control=async(...args)=>{
    if(args[0]==='page'&&args[1]==='new')return{id:'page'};
    if(args[0]==='page'&&args[1]==='close')return{closed:true};
    if(args[0]==='debug'&&args[1]==='session'&&args[2]==='open')
      return{session:'session'};
    if(args[0]==='debug'&&args[1]==='session'&&args[2]==='close')
      return{closed:true};
    if(args[0]!=='debug'||args[1]!=='session'||args[2]!=='send')
      throw Error('unexpected control operation');
    const method=args[4],params=JSON.parse(args[5]);
    if(method==='Page.navigate')return{result:{}};
    if(method!=='Runtime.evaluate')throw Error('unexpected CDP method');
    if(params.expression==='navigator.userAgent')
      return{result:{result:{value:'Mozilla/5.0 Chrome/152.0.7977.130 Safari/537.36'}}};
    if(params.expression==="location.origin + '|' + document.readyState")
      return{result:{result:{value:'https://chatgpt.com|complete'}}};
    if(params.expression.includes('function scan(index,shouldActivate)')){
      if(params.expression.endsWith(',false)')&&active>=0)
        stationary[active]++;
      return{result:{result:{value:runInNewContext(params.expression,{
        document,location:{href:'https://chatgpt.com/share/two'},URL
      })}}};
    }
    if(params.expression.includes('backend-anon'))
      return{result:{result:{value:{
        attempts:[{source:'backend-anon',status:200}],
        snapshot:JSON.stringify(snapshot)
      }}}};
    if(params.expression.includes('return { candidates: urls.size'))
      return{result:{result:{value:{candidates:2,images:2}}}};
    throw Error('unexpected image expression');
  };
  const requested=[];
  const fetchImage=async src=>{
    requested.push(src);
    return new Response(image,{status:200,headers:{
      'content-type':'image/png','content-length':String(image.length)
    }});
  };
  const result=await captureStructuredSnapshot(control,
    'https://chatgpt.com/share/two',{seconds:3,fetchImage});
  assert.deepEqual(scrolls,[0,1],'each surface should be activated only once');
  assert.ok(stationary.every(n=>n>=3));
  assert.equal(result.stats.generatedImageDom.expected,2);
  assert.equal(result.stats.generatedImageDom.identified,2);
  assert.equal(result.stats.generatedImageDom.downloaded,2);
  assert.equal(result.stats.generatedImageDom.activated,2);
  assert.deepEqual(result.stats.generatedImageDom.statuses.map(s=>s.status),
    ['loaded','loaded']);
  assert.deepEqual(requested,urls,'download paths retain identity despite identical byte sizes');
  assert.deepEqual(result.assets.map(asset=>asset.file_id),ids);
});


test('ChatGPT anonymous share normalizes only Electron product token before navigation', async () =>
{
  const electronAgent =
    'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36';
  const chromeAgent = electronAgent.replace(' Electron/44.7.0', '');

  for (const [agent, shouldNormalize] of
    [[electronAgent, true], [chromeAgent, false]])
  {
    const calls = [];
    const sequence = [];
    let navigated = false;
    const control = async (...args) =>
    {
      const command = args.slice(0, 3).join(' ');
      if (command === 'page new') return { id: 'page-1' };
      if (command === 'page navigate')
      {
        assert.equal(args[2], 'page-1');
        assert.match(args[3], /^data:text\/html;charset=utf-8,/);
        assert.match(decodeURIComponent(args[3]), /<!doctype html>/);
        sequence.push('document-ready');
        return { page: 'page-1', url: args[3] };
      }
      if (command === 'page close') return { closed: true };
      if (command === 'debug session open')
      {
        assert.deepEqual(sequence, ['document-ready']);
        sequence.push('attached');
        return { session: 'debug-1' };
      }
      if (command === 'debug session close') return { closed: true };

      if (command === 'debug session send')
      {
        const method = args[4];
        const params = JSON.parse(args[5]);
        calls.push({ method, params });
        if (method === 'Emulation.setUserAgentOverride')
        {
          assert.deepEqual(sequence, ['document-ready', 'attached']);
          sequence.push('override');
          return { result: {} };
        }
        if (method === 'Page.navigate')
        {
          const expected = shouldNormalize ?
            ['document-ready', 'attached', 'override'] :
            ['document-ready', 'attached'];
          assert.deepEqual(sequence, expected);
          sequence.push('share-navigation');
          navigated = true;
          return { result: {} };
        }
        if (method === 'Runtime.evaluate')
        {
          if (params.expression === 'navigator.userAgent')
            return { result: { result: { value: agent } } };
          if (params.expression === "location.origin + '|' + document.readyState")
            return { result: { result: { value:
              navigated ? 'https://chatgpt.com|complete' : 'data:|complete'
            } } };
          if (params.expression.includes('backend-anon'))
            return { result: { result: { value: {
              attempts: [{ source: 'backend-anon', status: 200 }],
              snapshot: JSON.stringify(snapshot())
            } } } };
          return { result: { result: { value: [] } } };
        }
        throw new Error('unexpected method: ' + method);
      }
      throw new Error('unexpected web-control call: ' + command);
    };

    const outcome = await captureStructuredSnapshot
    (
      control,
      'https://chatgpt.com/share/abc',
      { seconds: 1 }
    );
    assert.equal(outcome.method, 'page-fetch');
    assert.equal(sequence[0], 'document-ready');
    assert.equal(sequence[1], 'attached');
    assert.equal(sequence.at(-1), 'share-navigation');
    assert.equal(outcome.stats.electronUserAgentNormalized, shouldNormalize);
    const overrides = calls.filter(call => call.method === 'Emulation.setUserAgentOverride');
    assert.equal(overrides.length, shouldNormalize ? 1 : 0);
    if (shouldNormalize)
    {
      assert.deepEqual(overrides[0].params, { userAgent: chromeAgent });
      assert.ok
      (
        calls.findIndex(call => call.method === 'Emulation.setUserAgentOverride') <
        calls.findIndex(call => call.method === 'Page.navigate')
      );
    }
    assert.equal(calls.some(call => call.method === 'Network.enable'), false);
  }
});
