'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {exportOfflineShare,validatedShareUrl} from '../export-offline.mjs';

const share='https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259';

function sandbox(work)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-export-test-'));
  return Promise.resolve().then(()=>work(root)).finally(()=>
    fs.rmSync(root,{recursive:true,force:true}));
}

function fixtureOps(calls,{remoteImage=false,brokenImageOnce=false}={})
{
  let localizationCalls=0;
  return {
    capture:async(_url,dir,flags)=>{
      calls.push(['capture',path.basename(dir),flags]);
      fs.mkdirSync(dir,{recursive:true});
      return {counts:{'sweep.finished':1},uniqueTurnSnapshots:1};
    },
    metadata:()=>({title:'m context',date:'2026-10-26',
      createdAt:'2026-10-26T12:00:00.000Z'}),
    render:(_base,output)=>{
      calls.push(['render']);
      fs.mkdirSync(output,{recursive:true});
      fs.writeFileSync(path.join(output,'index.html'),
        '<html><head><meta content="script-src \u0027none\u0027"></head>'+
        '<body>Original source +4 without guaranteed destinations</body></html>');
      return {capturedTurnCount:3,restoredSources:0,sourceLinks:0};
    },
    localize:(_styled,final,captures)=>{
      calls.push(['localize',captures.length]);
      localizationCalls++;
      if(brokenImageOnce&&localizationCalls===1)
        throw Error('Unmatched remote image reference in archive');
      fs.mkdirSync(final,{recursive:true});
      fs.writeFileSync(path.join(final,'index.html'),
        '<html><meta content="script-src \u0027none\u0027"><body>offline</body></html>');
    },
    inspect:directory=>{
      calls.push(['inspect',path.basename(directory)]);
      const staged=path.basename(directory)==='styled';
      return {hasScriptBlocking:true,imageReferences:{
        remote:remoteImage&&staged?1:0,local:0}};
    }
  };
}

test('URL validation and CLI input remain bounded',async()=>{
  for(const url of ['http://chatgpt.com/share/fake',
    'https://evil.example/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259',
    share+'?token=private','https://chatgpt.com/','not a URL'])
    assert.throws(()=>validatedShareUrl(url));
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

test('archives original citation controls without source-click evidence',()=>
 sandbox(async root=>{
   const calls=[],ops=fixtureOps(calls);
   const output=path.join(root,'archive');
   const report=await exportOfflineShare(share,output,{operations:ops});
   assert.equal(report.status,'private-offline-export-created');
   assert.equal(report.restoredGroups,0);
   assert.equal(report.groupLinks,0);
   assert.equal(report.singletonLinks,0);
   assert.equal(report.originalScriptsDisabled,true);
   assert.match(fs.readFileSync(path.join(output,'index.html'),'utf8'),
     /Original source \+4/);
   assert.deepEqual(calls.filter(call=>call[0]==='capture')
     .map(call=>call[1]),['original']);
   assert.equal(calls.filter(call=>call[0]==='localize').length,0);
   assert.equal(fs.readdirSync(root).length,1,
     'successful run discards private browser evidence');
 })
);

test('metadata is returned on request without requiring citation targets',()=>
 sandbox(async root=>{
   const report=await exportOfflineShare(share,path.join(root,'archive'),{
     withMetadata:true,operations:fixtureOps([])});
   assert.equal(report.metadata.title,'m context');
   assert.equal(report.metadata.date,'2026-10-26');
 })
);

test('localizes image bodies and retries missing images without source probes',()=>
 sandbox(async root=>{
   const calls=[],ops=fixtureOps(calls,{
     remoteImage:true,brokenImageOnce:true});
   const report=await exportOfflineShare(share,path.join(root,'archive'),{
     operations:ops});
   assert.equal(report.remoteImages,0);
   assert.deepEqual(calls.filter(call=>call[0]==='capture')
     .map(call=>call[1]),['original','more-images']);
   assert.deepEqual(calls.filter(call=>call[0]==='localize')
     .map(call=>call[1]),[1,2]);
 })
);

test('failed rendering never publishes a partial archive',()=>
 sandbox(async root=>{
   const calls=[],ops=fixtureOps(calls);
   ops.render=()=>{throw Error('Missing original CSS');};
   const output=path.join(root,'archive');
   let error;
   try{await exportOfflineShare(share,output,{operations:ops});}
   catch(e){error=e;}
   assert.match(error?.message||'',/Missing original CSS/);
   assert.equal(fs.existsSync(output),false);
   assert.ok(fs.existsSync(error.privateEvidenceDirectory));
 })
);

test('captured conversation must contain turns',()=>
 sandbox(async root=>{
   const ops=fixtureOps([]);
   ops.render=()=>({capturedTurnCount:0});
   await assert.rejects(exportOfflineShare(share,path.join(root,'out'),{
     operations:ops}),/no captured turns/);
 })
);

test('only readiness exit 3 causes an isolated retry',()=>
 sandbox(async root=>{
   const calls=[],ops=fixtureOps(calls);
   const normal=ops.capture;
   let first=true;
   ops.capture=async(url,dir,flags)=>{
     if(first){
       first=false;
       const error=Error('sweep-not-ready');
       error.captureExitCode=3;
       throw error;
     }
     return normal(url,dir,flags);
   };
   const report=await exportOfflineShare(share,path.join(root,'archive'),{
     operations:ops});
   assert.equal(report.status,'private-offline-export-created');
   assert.ok(calls.some(c=>c[1]==='original-readiness-retry'));
 })
);

test('other capture failures do not retry or publish',()=>
 sandbox(async root=>{
   const ops=fixtureOps([]),output=path.join(root,'archive');
   let attempts=0;
   ops.capture=async()=>{attempts++;throw Error('browser failed');};
   await assert.rejects(exportOfflineShare(share,output,{operations:ops}),
     /browser failed/);
   assert.equal(attempts,1);
   assert.equal(fs.existsSync(output),false);
 })
);

test('keep-evidence preserves captures without depending on citation verification',()=>
 sandbox(async root=>{
   const report=await exportOfflineShare(share,path.join(root,'archive'),{
     keepEvidence:true,operations:fixtureOps([])});
   assert.ok(report.evidenceDirectory);
   assert.ok(fs.existsSync(report.evidenceDirectory));
 })
);
