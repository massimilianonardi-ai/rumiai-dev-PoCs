'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {auditSourceGroupIdentity,sourceGroupSignatures}
  from '../inspect-source-group-identity.mjs';

function fixture(callback)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-identity-'));
  try{
    const dirs=['one','two'].map(name=>{
      const dir=path.join(root,name);
      fs.mkdirSync(path.join(dir,'turns'),{recursive:true});
      return dir;
    });
    return callback(dirs);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
function writeCapture(dir,{change='',secondCount=2,messageId='assistant-msg'},
  includeAction=false)
{
  const html='<div data-turn-id-container="assistant-turn">'+
    '<div data-testid="conversation-turn-4" data-message-id="'+messageId+'">'+
    '<p>This is the first research result with useful prose about subject A '+
    'and its original online reference <span>+1</span> end.</p>'+
    '<p>This is the second independent experiment '+change+
    'concerning a distinct subject B with its source reference '+
    '<span>+'+(secondCount-1)+'</span> end.</p>'+
    '</div></div>';
  const bytes=Buffer.from(html);
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(dir,'turns',sha+'.html'),bytes);
  const events=[{kind:'turn.snapshot',sequence:1,turnId:'assistant-turn',
    messageIds:[messageId],sha256:sha,bytes:bytes.length,file:'turns/'+sha+'.html'},
    {kind:'interaction.source-hover',ordinal:4,index:0,expectedSources:2},
    {kind:'interaction.source-hover',ordinal:4,index:1,expectedSources:secondCount}];
  if(includeAction)
    events.push({kind:'interaction.trusted-source-card-intents',
      ordinal:4,groupIndex:0,expectedSources:2,
      attempts:[0,1].map(index=>({index,status:'dispatched',
        windowOpen:['https://private.example/'+index],anchorClick:[]}))});
  fs.writeFileSync(path.join(dir,'events.jsonl'),
    events.map(e=>JSON.stringify(e)).join('\n')+'\n');
  return html;
}
test('source pill DOM fingerprints remain stable across captures of the same text',()=>
 fixture(dirs=>{
   const html=writeCapture(dirs[0],{});
   writeCapture(dirs[1],{},true);
   assert.equal(sourceGroupSignatures(html).length,2);
   const result=auditSourceGroupIdentity(dirs);
   assert.equal(result.expectedGroups,2);
   assert.equal(result.stableGroups,2);
   assert.equal(result.completeUrlGroups,1);
   assert.equal(result.safeToRestore,false,'URL coverage remains mandatory');
   assert.ok(!JSON.stringify(result).includes('assistant-msg'));
   assert.ok(!JSON.stringify(result).includes('private.example'));
 })
);
test('changed source context or assistant identity fails the cross-capture identity check',()=>
 fixture(dirs=>{
   writeCapture(dirs[0],{});
   writeCapture(dirs[1],{change:'a newly altered paragraph '});
   const result=auditSourceGroupIdentity(dirs);
   assert.ok(result.stableGroups<2);
   assert.equal(result.groups[1].status,'context-mismatch');
   writeCapture(dirs[1],{messageId:'different-message'});
   const different=auditSourceGroupIdentity(dirs);
   assert.equal(different.stableGroups,0);
   assert.deepEqual(different.groups.map(g=>g.status),
     ['context-mismatch','context-mismatch']);
 })
);
test('changing source group counts is rejected before any restoration',()=>
 fixture(dirs=>{
   writeCapture(dirs[0],{});
   writeCapture(dirs[1],{secondCount:5});
   assert.throws(()=>auditSourceGroupIdentity(dirs),
     /Conflicting source group count/);
 })
);
