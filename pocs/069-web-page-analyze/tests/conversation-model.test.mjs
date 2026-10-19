import test from 'node:test';
import assert from 'node:assert/strict';
import {activeBranch,userVisibleCandidate,resourceReferences,conversationModel}
  from '../conversation-model.mjs';
function snapshot(){
  return {conversation_id:'share-test',title:'Fixture',
    current_node:'a3',mapping:{
      root:{parent:null,message:null},
      a1:{parent:'root',message:{id:'m1',author:{role:'user'},
        content:{content_type:'multimodal_text',parts:[
          'Create plot',{content_type:'image_asset_pointer',
            asset_pointer:'file-service://f1',size:100}]}}},
      discarded:{parent:'a1',message:{id:'hidden-branch',
        author:{role:'assistant'},content:{parts:['wrong branch']}}},
      a2:{parent:'a1',message:{id:'m2',author:{role:'tool'},
        content:{parts:['search metadata']}}},
      a3:{parent:'a2',message:{id:'m3',author:{role:'assistant'},
        content:{content_type:'text',parts:['table:\n|A|B|\n|1|2|']},
        metadata:{attachments:[{id:'file-123',
          download_url:'https://cdn.example/a.png?token=secret'}]}}}
  }};
}
test('reconstructs active parent chain, not mounted DOM or discarded branches',()=>{
  const data=snapshot();
  const branch=activeBranch(data);
  assert.deepEqual(branch.map(x=>x.nodeId),['root','a1','a2','a3']);
  const model=conversationModel(data);
  assert.equal(model.activeBranchCount,4);
  assert.equal(model.mappingCount,5);
  assert.deepEqual(model.visible.map(x=>x.messageId),['m1','m3']);
  assert.equal(model.visible[0].nonTextCount,1);
  assert.equal(model.visible[0].message.content.parts[1].asset_pointer,'file-service://f1');
  assert.equal(model.resourceBytesCaptured,false);
  assert.equal(model.renderingVerified,false);
});
test('requires a real mapping/current_node source, detects cycles and broken links',()=>{
  assert.throws(()=>activeBranch({}),/mapping-or-current-node-missing/);
  const s=snapshot();
  s.mapping.a1.parent='a3';
  assert.throws(()=>activeBranch(s),/cycle/);
  s.mapping.a1.parent='unloaded';
  assert.throws(()=>activeBranch(s),/parent-chain-broken/);
});
test('preserves nontext references and Markdown image links in inventory',()=>{
  const refs=resourceReferences({content:{parts:[
    {asset_pointer:'file-service://x',type:'image'},
    'Image: ![diagram](https://example.test/a.png)'
  ]},metadata:{attachments:[{file_id:'f2'}]}});
  assert.ok(refs.references.some(x=>x.value==='file-service://x'));
  assert.ok(refs.references.some(x=>x.value==='f2'));
  assert.ok(refs.references.some(x=>x.kind==='markdown-image'));
  assert.equal(refs.truncated,false);
});
test('does not treat internal/tool nodes as user-visible',()=>{
  assert.equal(userVisibleCandidate({author:{role:'tool'},content:{}}).include,false);
  assert.equal(userVisibleCandidate({author:{role:'assistant'},channel:'analysis',
    content:{parts:['private']}}).include,false);
  assert.equal(userVisibleCandidate({author:{role:'assistant'},recipient:'browser',
    content:{parts:['tool']}}).include,false);
  assert.equal(userVisibleCandidate({author:{role:'assistant'},
    content:{parts:[{content_type:'image',asset_pointer:'f'}]}}).include,true);
});
test('all rich structures remain in untouched message objects',()=>{
  const s=snapshot();s.mapping.a3.message.content.html='<table><tr><td>1</td></tr></table>';
  s.mapping.a3.message.metadata.chart={series:[1,2,3]};
  const m=conversationModel(s);
  assert.equal(m.visible[1].message.content.html,
    '<table><tr><td>1</td></tr></table>');
  assert.deepEqual(m.visible[1].message.metadata.chart.series,[1,2,3]);
});
