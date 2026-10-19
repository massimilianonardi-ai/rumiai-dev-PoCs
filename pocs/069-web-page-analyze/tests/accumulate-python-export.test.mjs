import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import
{
  activeBranch, textualFragments, classifyMessage,
  exportSnapshot, exportDomObservation
} from '../python-export.mjs';

function snapshot()
{
  const message=(role,parts,extra={})=>
    ({author:{role},content:{content_type:'text',parts},...extra});
  return {
    title:'Test export',conversation_id:'abc',current_node:'c',
    mapping:{
      root:{parent:null,message:null},
      a:{parent:'root',message:message('user',['ciao 😀',{asset_pointer:'file-service://x'}],{id:'u'})},
      b:{parent:'a',message:message('tool',['internal'],{id:'t'})},
      c:{parent:'b',message:message('assistant',['risposta'],{id:'a',channel:'commentary'})},
      outside:{parent:null,message:message('assistant',['excluded'])}
    }
  };
}

test('Python parent chain excludes other branches and rejects cycles and missing parents',()=>
{
  const data=snapshot();
  assert.deepEqual(activeBranch(data).map(item=>item.id),['root','a','b','c']);
  data.mapping.root.parent='c';
  assert.throws(()=>activeBranch(data),/parent-cycle/);
  data.mapping.root.parent='missing';
  assert.throws(()=>activeBranch(data),/parent-missing/);
});

test('Python text fragments, non-text parts and internal classifications are preserved',()=>
{
  assert.deepEqual(textualFragments({parts:[null,'A','B',{x:1}]}),
    {text:'AB',nonText:[{part_index:0,part:null},{part_index:3,part:{x:1}}]});
  assert.equal(textualFragments({code:'hello'}).text,'hello');
  assert.equal(classifyMessage({author:{role:'tool'}}).included,false);
  assert.equal(classifyMessage({author:{role:'assistant'},channel:'analysis'}).included,false);
});

test('renderer snapshot port writes Python file layout, original objects and intact archive',async()=>
{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'poc069-snapshot-'));
  try
  {
    const raw=JSON.stringify(snapshot());
    const directory=path.join(parent,'export');
    const result=await exportSnapshot(raw,directory);
    assert.equal(result.visible_messages,2);
    const saved=gunzipSync(await fs.readFile(path.join(directory,'conversation.raw.json.gz')));
    assert.equal(saved.toString('utf8'),raw);
    const rows=(await fs.readFile(path.join(directory,'VISIBLE_MESSAGES.jsonl'),'utf8'))
      .trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row=>row.role),['user','assistant']);
    assert.equal(rows[0].message.content.parts[1].asset_pointer,'file-service://x');
    const audit=JSON.parse(await fs.readFile(path.join(directory,'AUDIT.json'),'utf8'));
    assert.equal(audit.conversation.active_branch_nodes,4);
    assert.equal(audit.conversation.nodes_outside_active_branch,1);
    assert.equal(audit.transcript.classification_counts.tool_traffic,1);
    assert.equal(audit.nodes[1].text_length,6);
    const nonText=JSON.parse(await fs.readFile(path.join(directory,'NON_TEXT_PARTS.json'),'utf8'));
    assert.equal(nonText[0].part.asset_pointer,'file-service://x');
    const zip=await fs.readFile(result.zip);
    assert.equal(zip.readUInt32LE(0),0x04034b50);
    assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
    assert.match(await fs.readFile(path.join(directory,'SHA256SUMS'),'utf8'),
      /conversation\.raw\.json \(uncompressed captured snapshot\)/);
    await assert.rejects(()=>exportSnapshot(raw,directory),/EEXIST/);
  }
  finally
  {
    await fs.rm(parent,{recursive:true,force:true});
  }
});

test('shared URL retains every observed turn and disclaims unavailable renderer snapshot',async()=>
{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'poc069-dom-'));
  try
  {
    const directory=path.join(parent,'export');
    await exportDomObservation
    ({
      url:'https://chatgpt.com/share/abc-123',
      continuity:{orderComponents:2,completeExportVerified:false},
      ordered:[
        {key:'id:a',role:'user',text:'Prompt',html:'<article>Prompt</article>'},
        {key:'id:b',role:'assistant',text:'Reply',html:'<article>Reply</article>'}
      ]
    },directory);
    const source=JSON.parse(gunzipSync(await fs.readFile(
      path.join(directory,'conversation.raw.json.gz'))).toString('utf8'));
    assert.equal(source.complete,false);
    assert.equal(source.mapping,undefined);
    assert.equal(source.current_node,undefined);
    assert.equal(source.observations.length,2);
    const audit=JSON.parse(await fs.readFile(path.join(directory,'AUDIT.json'),'utf8'));
    assert.equal(audit.source.complete_export_verified,false);
    assert.equal(audit.source.order_components,2);
    const rows=(await fs.readFile(path.join(directory,'VISIBLE_MESSAGES.jsonl'),'utf8'))
      .trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row=>row.role),['user','assistant']);
    assert.equal(rows[0].message.content.parts[1].html,'<article>Prompt</article>');
    assert.equal(rows[1].parent,null);
  }
  finally
  {
    await fs.rm(parent,{recursive:true,force:true});
  }
});
