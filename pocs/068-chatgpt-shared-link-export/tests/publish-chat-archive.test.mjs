import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {safeTopic,chatDirectoryName,publishChatArchive}
  from '../publish-chat-archive.mjs';

const url='https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259';
const metadata={title:'Integrare Chat e Work',date:'2026-10-08'};
function fixture()
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-publish-test-'));
  const repo=path.join(root,'repo');
  fs.mkdirSync(path.join(repo,'.git'),{recursive:true});
  const exporter=async(_url,output)=>{
    fs.mkdirSync(output);
    fs.mkdirSync(path.join(output,'assets'));
    fs.writeFileSync(path.join(output,'assets','icon.png'),'image');
    fs.writeFileSync(path.join(output,'index.html'),
      "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'\">"+
      '<img src="./assets/icon.png">');
    return {status:'private-offline-export-created',
      originalScriptsDisabled:true,remoteImages:0,metadata};
  };
  return {root,repo,exporter,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('safe topics remain single segments and safe normalized archive names',()=>{
  assert.equal(safeTopic('Research & AI'),'Research & AI');
  for(const topic of ['../bad','..','.hidden',' bad','bad\\test','a/b',''])
    assert.throws(()=>safeTopic(topic),/Topic/);
  assert.equal(chatDirectoryName({date:'2026-10-08',title:'AI: Chaos/Research'}),
    '2026-10-08 AI- Chaos-Research');
});
test('publishes the complete unmodified HTML and assets',async()=>{
  const f=fixture();
  try
  {
    const result=await publishChatArchive({url,topic:'Research'},f.repo,
      {exporter:f.exporter});
    assert.equal(result.archivePath,
      'chats/Research/2026-10-08 Integrare Chat e Work');
    const base=path.join(f.repo,result.archivePath);
    assert.match(fs.readFileSync(path.join(base,'index.html'),'utf8'),
      /assets\/icon.png/);
    assert.equal(fs.readFileSync(path.join(base,'assets','icon.png'),'utf8'),'image');
    await assert.rejects(()=>publishChatArchive({url,topic:'Research'},f.repo,
      {exporter:f.exporter}),/already exists/);
  }
  finally{f.close();}
});
test('rejects unsafe request shapes without starting browser export',async()=>{
  const f=fixture();
  try
  {
    await assert.rejects(()=>publishChatArchive({url,topic:'Research',
      title:'Injected'},f.repo,{exporter:f.exporter}),
    /Expected only/);
  }
  finally{f.close();}
});
test('fails closed if final archive references a missing local image',async()=>{
  const f=fixture();
  const bad=async(_url,output)=>{
    const report=await f.exporter(_url,output);
    fs.writeFileSync(path.join(output,'index.html'),
      "<meta content=\"script-src 'none'\"><img src=\"assets/absent.png\">");
    return report;
  };
  try
  {
    await assert.rejects(()=>publishChatArchive({url,topic:'Research'},f.repo,
      {exporter:bad}),/missing\/outside/);
    assert.equal(fs.existsSync(path.join(f.repo,'chats','Research',
      '2026-10-08 Integrare Chat e Work')),false);
  }
  finally{f.close();}
});

test('reports the exact CSS resource and refuses to publish',async()=>{
  const f=fixture();
  const bad=async(_url,output)=>{
    const report=await f.exporter(_url,output);
    fs.writeFileSync(path.join(output,'assets','original.css'),
      'body { background: url("./missing-font.woff2"); }');
    fs.appendFileSync(path.join(output,'index.html'),
      '<link rel="stylesheet" href="./assets/original.css">');
    return report;
  };
  try
  {
    await assert.rejects(
      ()=>publishChatArchive({url,topic:'Research'},f.repo,{exporter:bad}),
      /missing\/outside local resource \(CSS assets\/original.css\): "\.\/missing-font.woff2"/);
    assert.equal(fs.existsSync(path.join(f.repo,'chats','Research')),false);
  }
  finally{f.close();}
});
