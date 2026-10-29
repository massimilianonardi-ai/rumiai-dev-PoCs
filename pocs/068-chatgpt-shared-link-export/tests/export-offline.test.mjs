'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {exportOfflineShare,validatedShareUrl,remainingSourceGroups}
  from '../export-offline.mjs';

const share='https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259';
function sandbox(work)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-one-command-'));
  return Promise.resolve().then(()=>work(root)).finally(()=>
    fs.rmSync(root,{recursive:true,force:true}));
}
const ref=(ordinal,index,expectedSources,complete=true)=>({
  ordinal,index,expectedSources,complete});
const group1=ref(2,0,2),group2=ref(4,0,2);
function fixtureOps(calls,{failSource=false,failSingleton=false,
  missingImageOnce=false}={})
{
  let imageAttempt=0;
  return {
    capture:async(_url,dir,flags)=>{
      calls.push(['capture',path.basename(dir),flags]);
      fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,'events.jsonl'),'');
      return {counts:{'sweep.finished':1},uniqueTurnSnapshots:1};
    },
    sourceGroups:()=>[group1,group2],
    sourceEvidence:dirs=>{
      if(failSource)return {groups:[group1,ref(4,0,2,false)]};
      return {groups:dirs.length===1?
        [group1,ref(4,0,2,false)]:[group1,group2]};
    },
    identity:()=>({safeToRestore:true,stableGroups:2}),
    render:(_base,output,evidence)=>{
      calls.push(['render',evidence.length]);
      fs.mkdirSync(output);
      fs.writeFileSync(path.join(output,'index.html'),'offline');
      return {restoredSources:2,sourceLinks:4};
    },
    localize:(_source,output,captures)=>{
      calls.push(['localize',captures.length]);
      imageAttempt++;
      if(missingImageOnce && imageAttempt===1)
        throw Error('Unmatched remote image reference in archive');
      fs.mkdirSync(output);
      fs.writeFileSync(path.join(output,'index.html'),'localized');
    },
    verifySingletons:()=>{
      calls.push(['verify-singletons']);
      return failSingleton?new Set(['2:0']):new Set([
        '2:0','4:0','4:1','6:0','6:1','6:2','8:0','8:1']);
    },
    restore:(_images,output)=>{
      calls.push(['restore']);
      fs.mkdirSync(output);
      fs.writeFileSync(path.join(output,'index.html'),'accepted');
      return {restoredSingletons:8,existingMultiSourceDetails:2};
    },
    inspect:()=>({sourceDetails:2,sourceLinks:4,
      imageReferences:{remote:0},hasScriptBlocking:true})
  };
}
test('rejects bad URLs, unrelated services and nonempty output',async()=>
{
  for(const url of ['http://chatgpt.com/share/fake',
    'https://evil.example/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259',
    'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259?token=private',
    'https://chatgpt.com/','not a URL']){
    assert.throws(()=>validatedShareUrl(url));
  }
  assert.equal(validatedShareUrl(share),share);
  await sandbox(async root=>{
    const already=path.join(root,'existing');
    fs.mkdirSync(already);
    await assert.rejects(exportOfflineShare(share,already),/already exists/);
    const script=new URL('../export-offline.mjs',import.meta.url).pathname;
    const result=spawnSync(process.execPath,[script,'invalid'],
      {encoding:'utf8',timeout:4000});
    assert.equal(result.status,2);
    assert.match(result.stderr,/Usage: node export-offline.mjs/);
  });
});
test('missing source group evidence is detected without guessing',()=>
{
  assert.deepEqual(remainingSourceGroups([group1,group2],
    {groups:[group1,ref(4,0,2,false)]}),[group2]);
  assert.throws(()=>remainingSourceGroups([group1],
    {groups:[ref(2,0,3)]}),/Conflicting/);
  assert.throws(()=>remainingSourceGroups([group1],
    {groups:[ref(2,0,2),ref(6,0,2)]}),/unrelated/);
});
test('one command does complete bounded capture, retry and publishes only final archive',()=>
 sandbox(async root=>{
   const output=path.join(root,'archive');
   const calls=[],ops=fixtureOps(calls,{missingImageOnce:true});
   const report=await exportOfflineShare(share,output,{operations:ops});
   assert.equal(report.status,'private-offline-export-created');
   assert.equal(report.restoredGroups,2);
   assert.equal(report.groupLinks,4);
   assert.equal(report.singletonLinks,8);
   assert.equal(report.originalScriptsDisabled,true);
   assert.equal(fs.readFileSync(path.join(output,'index.html'),'utf8'),'accepted');
   assert.equal(calls.filter(x=>x[0]==='capture').length,6);
   assert.ok(calls.some(x=>x[1]==='source-4-0'));
   assert.ok(calls.some(x=>x[1]==='more-images'));
   assert.deepEqual(calls.filter(x=>x[0]==='render').map(x=>x[1]),[2]);
   assert.deepEqual(calls.filter(x=>x[0]==='localize').map(x=>x[1]),[3,4]);
   assert.equal(fs.readdirSync(root).length,1,
     'successful run removes transient private captures');
 })
);
test('failed provenance leaves no published output and retains private logs',()=>
 sandbox(async root=>{
   const output=path.join(root,'archive');
   const calls=[],ops=fixtureOps(calls,{failSource:true});
   let failure;
   try{await exportOfflineShare(share,output,{operations:ops});}
   catch(error){failure=error;}
   assert.ok(failure);
   assert.match(failure.message,/lack verified HTTPS targets/);
   assert.equal(fs.existsSync(output),false);
   assert.ok(fs.existsSync(failure.privateEvidenceDirectory));
   assert.equal(calls.filter(x=>x[0]==='restore').length,0);
 })
);
test('the final directory is not published after a singleton mismatch',()=>
 sandbox(async root=>{
   const output=path.join(root,'archive');
   const calls=[],ops=fixtureOps(calls,{failSingleton:true});
   await assert.rejects(exportOfflineShare(share,output,{operations:ops}),
     /Singleton identities changed/);
   assert.equal(fs.existsSync(output),false);
 })
);
test('keep-evidence option retains private capture directory on success',()=>
 sandbox(async root=>{
   const output=path.join(root,'archive');
   const calls=[],ops=fixtureOps(calls);
   const report=await exportOfflineShare(share,output,{
     operations:ops,keepEvidence:true});
   assert.equal(report.status,'private-offline-export-created');
   assert.ok(report.evidenceDirectory);
   assert.ok(fs.existsSync(report.evidenceDirectory));
   assert.equal(fs.readFileSync(path.join(output,'index.html'),'utf8'),'accepted');
 })
);
