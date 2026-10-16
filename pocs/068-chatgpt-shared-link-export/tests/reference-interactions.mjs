import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureReferenceInteractions } from '../reference-interactions.mjs';

test('artifact interaction probe records post-click network evidence and response body', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'reference-interactions-'));
  const calls = [];
  let pageCounter = 0;
  let sessionCounter = 0;
  let clicked = false;
  const bodyBytes = Buffer.from('# exported markdown\n');

  const control = async (...args) => {
    calls.push(args);
    if (args[0] === 'page' && args[1] === 'new')
      return { id:'page-' + (++pageCounter) };
    if (args[0] === 'page' && args[1] === 'navigate')
      return { page:args[2],url:args[3],title:'Fixture',status:200 };
    if (args[0] === 'page' && args[1] === 'close')
      return { page:args[2],closed:true };
    if (args[0] === 'page' && args[1] === 'click') {
      assert.match(args[3],/data-rumiai-reference-target/);
      clicked = true;
      return { page:args[2],target:args[3] };
    }
    if (args[0] === 'debug' && args[1] === 'session' && args[2] === 'open')
      return { session:'debug-' + (++sessionCounter),page:args[3] };
    if (args[0] === 'debug' && args[1] === 'session' && args[2] === 'close')
      return { session:args[3],closed:true };
    if (args[0] === 'debug' && args[1] === 'session' && args[2] === 'events') {
      const after = Number(args[4]);
      if (!clicked || after >= 3)
        return {session:args[3],after,lastSequence:after,events:[]};
      return {session:args[3],after,lastSequence:3,events:[
        {sequence:1,method:'Network.requestWillBeSent',params:{
          requestId:'req-1',type:'Fetch',request:{
            url:'https://files.example/download/file.md',method:'GET',
            headers:{Authorization:'must-not-be-persisted'}
          },initiator:{type:'script'}
        }},
        {sequence:2,method:'Network.responseReceived',params:{
          requestId:'req-1',type:'Fetch',response:{
            url:'https://files.example/download/file.md',
            status:200,mimeType:'text/markdown',
            headers:{
              'content-length':String(bodyBytes.length),
              'content-disposition':'attachment; filename="file.md"',
              'set-cookie':'must-not-be-persisted'
            }
          }
        }},
        {sequence:3,method:'Network.loadingFinished',params:{
          requestId:'req-1',encodedDataLength:bodyBytes.length
        }}
      ]};
    }
    if (!(args[0] === 'debug' && args[1] === 'session' && args[2] === 'send'))
      throw new Error('unexpected command ' + args.join(' '));

    const method = args[4];
    const params = JSON.parse(args[5]);
    if (method === 'Network.enable' || method === 'Network.disable' ||
        method === 'Page.enable' || method === 'Page.disable')
      return {result:{}};
    if (method === 'Network.getResponseBody')
      return {result:{body:bodyBytes.toString('base64'),base64Encoded:true}};
    if (method === 'Page.captureScreenshot')
      return {result:{data:Buffer.from('shot').toString('base64')}};
    if (method !== 'Runtime.evaluate')
      throw new Error('unexpected CDP method ' + method);

    if (params.expression.includes('reference-interaction-settle'))
      return {result:{result:{value:{
        marker:'reference-interaction-settle',
        href:'https://chatgpt.com/share/abc',readyState:'complete',
        htmlLength:100,resourceCount:1
      }}}};
    if (params.expression.includes('reference-interaction-inventory'))
      return {result:{result:{value:{
        marker:'reference-interaction-inventory',
        results:[{
          kind:'sandbox-file',index:0,label:'Markdown 0008',
          icon_key:'text',turn_id:'turn-1',message_id:'message-1'
        }]
      }}}};
    if (params.expression.includes('reference-interaction-target'))
      return {result:{result:{value:{
        marker:'reference-interaction-target',found:true,tag:'button',
        aria_label:'Markdown 0008',text:'Markdown 0008',href:null
      }}}};
    if (params.expression.includes('reference-interaction-state'))
      return {result:{result:{value:{
        marker:'reference-interaction-state',
        href:'https://chatgpt.com/share/abc',title:'Fixture',
        images:[],resources:[],dialogs:[]
      }}}};
    throw new Error('unknown Runtime.evaluate expression');
  };

  try {
    const result = await captureReferenceInteractions(
      control,'https://chatgpt.com/share/abc',root,{seconds:1}
    );
    assert.equal(result.inventory.length,1);
    assert.equal(result.selected.length,1);
    assert.equal(result.interactions.length,1);
    const interaction = result.interactions[0];
    assert.equal(interaction.status,'complete');
    assert.equal(interaction.target.kind,'sandbox-file');
    assert.equal(interaction.bodies.length,1);
    assert.equal(interaction.bodies[0].byte_length,bodyBytes.length);
    assert.ok(interaction.bodies[0].local_path.endsWith('.md'));

    const saved = await fs.readFile(
      path.join(root,interaction.bodies[0].local_path)
    );
    assert.deepEqual(saved,bodyBytes);

    const manifest = await fs.readFile(path.join(root,'INTERACTIONS.json'),'utf8');
    assert.ok(!manifest.includes('Authorization'));
    assert.ok(!manifest.includes('set-cookie'));
    assert.ok(!manifest.includes('must-not-be-persisted'));
    assert.ok(manifest.includes('https://files.example/download/file.md'));
    assert.ok(calls.some(args =>
      args[0] === 'page' && args[1] === 'click'
    ));
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});
