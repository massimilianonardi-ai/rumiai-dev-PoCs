#!/usr/bin/env node
'use strict';
// Single-command orchestration of the existing PoC 068 evidence pipeline.
// This is a strict site-specific adapter, not a general ChatGPT account export.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {captureSignatures,auditSourceGroupIdentity}
  from './inspect-source-group-identity.mjs';
import {collectTrustedSourceEvidence}
  from './inspect-trusted-source-evidence.mjs';
import {renderSameSessionStyled}
  from './render-same-session-styled.mjs';
import {localizeExactCapturedImages}
  from './localize-exact-captured-images.mjs';
import {materializeSingletonCitations}
  from './restore-singleton-citations.mjs';
import {inspectOfflineLinkControls}
  from './inspect-offline-link-controls.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const MAX_GROUPS=24;
const MAX_SINGLETONS=8;

export function validatedShareUrl(input)
{
  if(typeof input!=='string'||input.length>2048)
    throw Error('A public ChatGPT shared URL is required');
  let parsed;
  try{parsed=new URL(input);}catch{throw Error('Invalid shared URL');}
  if(parsed.protocol!=='https:'||parsed.hostname!=='chatgpt.com'||
     parsed.port||parsed.username||parsed.password||parsed.search||
     parsed.hash||!/^\/share\/[a-z0-9-]{16,128}$/i.test(parsed.pathname))
    throw Error('Expected https://chatgpt.com/share/<share-id> without query or fragment');
  return parsed.href;
}
function privateOutputPath(outputName)
{
  if(typeof outputName!=='string'||!outputName.trim())
    throw Error('A new output directory is required');
  const output=path.resolve(outputName);
  if(fs.existsSync(output))throw Error('Output already exists; never overwrite an archive');
  const parent=path.dirname(output);
  if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())
    throw Error('Output parent directory must exist');
  return output;
}
function expectedSourceGroups(capture)
{
  const found=captureSignatures(capture);
  const groups=[];
  for(const [ordinal,entry] of found)
    for(const pill of entry.pills)
      groups.push({ordinal,index:pill.index,expectedSources:pill.count});
  groups.sort((a,b)=>a.ordinal-b.ordinal||a.index-b.index);
  const seen=new Set();
  for(const group of groups)
  {
    const key=group.ordinal+':'+group.index;
    if(seen.has(key)||group.expectedSources<2||group.expectedSources>12)
      throw Error('Unusable source-group identity in original capture');
    seen.add(key);
  }
  if(!groups.length||groups.length>MAX_GROUPS)
    throw Error('Current share has no supported verified +N groups');
  return groups;
}
export function remainingSourceGroups(expected,observed)
{
  const actual=new Map(observed.groups.map(group=>[
    group.ordinal+':'+group.index,group]));
  const keys=new Set(expected.map(group=>group.ordinal+':'+group.index));
  if(observed.groups.some(group=>!keys.has(group.ordinal+':'+group.index)))
    throw Error('Source evidence unexpectedly includes unrelated groups');
  return expected.filter(group=>{
    const row=actual.get(group.ordinal+':'+group.index);
    if(row&&row.expectedSources!==group.expectedSources)
      throw Error('Conflicting +N source count across captures');
    return !row?.complete;
  });
}
async function runCapture(url,directory,flags)
{
  const logDir=path.dirname(directory);
  const label=path.basename(directory);
  const stdout=fs.openSync(path.join(logDir,label+'.stdout.log'),'wx',0o600);
  const stderr=fs.openSync(path.join(logDir,label+'.stderr.log'),'wx',0o600);
  try
  {
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,
        [path.join(root,'render-probe.mjs'),url,directory,'--headless',
          '--sweep',...flags],
        {cwd:root,stdio:['ignore',stdout,stderr]});
      child.once('error',reject);
      child.once('exit',(exitCode,signal)=>{
        if(signal)reject(Error('Capture interrupted by signal'));
        else resolve(exitCode);
      });
    });
    if(code!==0){
      const error=Error('Chromium capture '+label+' failed with exit '+code+
        '; private diagnostic log retained');
      error.captureExitCode=code;
      throw error;
    }
    const audit=JSON.parse(fs.readFileSync(
      path.join(directory,'summary.json'),'utf8'));
    if(!audit.counts || audit.counts['sweep.finished']!==1 ||
       !Number.isSafeInteger(audit.uniqueTurnSnapshots) ||
       audit.uniqueTurnSnapshots<=0)
      throw Error('Incomplete sweep for '+label);
    return audit;
  }finally{fs.closeSync(stdout);fs.closeSync(stderr);}
}
function verifySingletonCapture(directory)
{
  const events=fs.readFileSync(path.join(directory,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const rows=events.filter(row=>
    row.kind==='interaction.remaining-control-intent' &&
    row.controlKind==='singleton' && row.status==='dispatched');
  if(rows.length!==MAX_SINGLETONS)
    throw Error('Unsupported singleton count: expected eight verified controls');
  const uniq=new Set();
  for(const row of rows)
  {
    const key=row.ordinal+':'+row.index;
    if(uniq.has(key)||!row.panelObserved||
       row.panelButtons!==1||row.panelAnchors!==0||
       row.popupCardStatus!=='dispatched'||
       (row.popupCardOpened||[]).length+
         (row.popupCardAnchors||[]).length!==1)
      throw Error('Incomplete or ambiguous singleton popup navigation');
    uniq.add(key);
  }
  return uniq;
}
const realOperations={
  capture:runCapture,
  sourceGroups:expectedSourceGroups,
  sourceEvidence:collectTrustedSourceEvidence,
  identity:auditSourceGroupIdentity,
  render:renderSameSessionStyled,
  localize:localizeExactCapturedImages,
  restore:materializeSingletonCitations,
  inspect:inspectOfflineLinkControls,
  verifySingletons:verifySingletonCapture
};
export async function exportOfflineShare(urlInput,outputName,options={})
{
  const url=validatedShareUrl(urlInput);
  const output=privateOutputPath(outputName);
  const keepEvidence=options.keepEvidence===true;
  const ops={...realOperations,...(options.operations||{})};
  const progress=typeof options.progress==='function'?options.progress:()=>{};
  const stage=fs.mkdtempSync(path.join(path.dirname(output),'.poc068-export-'));
  fs.chmodSync(stage,0o700);
  let published=false;
  try
  {
    const capture=async(name,flags)=>{
      for(let attempt=0;attempt<2;attempt++){
        const label=attempt?name+'-readiness-retry':name;
        const dir=path.join(stage,label);
        progress('Capturing '+label);
        try{
          await ops.capture(url,dir,flags);
          return dir;
        }catch(error){
          // The observed share occasionally exposes main but not its
          // conversation hooks in one entire browser session. Retry once,
          // in an isolated new profile, only for the documented exit 3.
          if(attempt===0&&error.captureExitCode===3){
            progress('Expected conversation DOM not ready; retrying once');
            continue;
          }
          throw error;
        }
      }
      throw Error('Capture readiness could not be recovered');
    };
    const base=await capture('original',[
      '--observe-interactions','--capture-static-bodies',
      '--capture-image-bodies']);
    const expected=ops.sourceGroups(base);
    const evidence=[];
    evidence.push(await capture('sources',[
      '--observe-interactions','--probe-trusted-source-card-actions',
      '--capture-image-bodies']));
    let observed=ops.sourceEvidence(evidence);
    let missing=remainingSourceGroups(expected,observed);
    if(missing.length>8)
      throw Error('Too many incomplete +N groups for bounded trusted retries');
    // Each additional run is targeted, bounded and evidence-backed.
    for(const group of missing)
    {
      const id=group.ordinal+':'+group.index;
      evidence.push(await capture('source-'+group.ordinal+'-'+group.index,[
        '--observe-interactions','--probe-trusted-source-card-actions',
        '--capture-image-bodies','--source-group',id]));
      observed=ops.sourceEvidence(evidence);
    }
    missing=remainingSourceGroups(expected,observed);
    if(missing.length)
      throw Error('One or more +N source groups lack verified HTTPS targets');
    const identity=ops.identity([base,...evidence],evidence);
    if(!identity.safeToRestore||identity.stableGroups!==expected.length)
      throw Error('Original source-card identity is not stable across captures');
    const styled=path.join(stage,'styled');
    progress('Rebuilding original CSS and verified +N links');
    const rendering=ops.render(base,styled,evidence);
    if(rendering.restoredSources!==expected.length ||
       rendering.sourceLinks!==expected.reduce((n,x)=>n+x.expectedSources,0))
      throw Error('Offline source groups were not restored completely');
    const images=path.join(stage,'images-local');
    let imagesDone=false;
    let imageCaptures=[base,...evidence];
    // A capture can miss some lazy-loaded favicons. Retry acquisition once
    // without changing link identity; never silently fetch remote assets.
    for(let attempt=0;attempt<2 && !imagesDone;attempt++)
    {
      try{
        progress('Localizing SHA-verified image bodies');
        ops.localize(styled,images,imageCaptures);
        imagesDone=true;
      }catch(error){
        if(attempt!==0 ||
           !/Unmatched remote image reference/.test(String(error.message)))
          throw error;
        imageCaptures=[...imageCaptures,await capture('more-images',[
          '--capture-image-bodies'])];
      }
    }
    if(!imagesDone)throw Error('Original image bytes are incomplete');
    const originalRemaining=await capture('singletons-reference',[
      '--observe-interactions','--probe-remaining-controls']);
    const verifiedRemaining=await capture('singletons-verified',[
      '--observe-interactions','--probe-remaining-controls']);
    const referenceKeys=ops.verifySingletons(originalRemaining);
    const targetKeys=ops.verifySingletons(verifiedRemaining);
    if(referenceKeys.size!==MAX_SINGLETONS ||
       targetKeys.size!==MAX_SINGLETONS ||
       [...referenceKeys].some(key=>!targetKeys.has(key)))
      throw Error('Singleton identities changed across captures');
    const final=path.join(stage,'archive');
    progress('Restoring singleton links');
    const restored=ops.restore(images,final,originalRemaining,verifiedRemaining);
    if(restored.restoredSingletons!==MAX_SINGLETONS ||
       restored.existingMultiSourceDetails!==expected.length)
      throw Error('Private singleton restoration incomplete');
    const checked=ops.inspect(final);
    const expectedLinks=expected.reduce((n,group)=>n+group.expectedSources,0);
    if(checked.sourceDetails!==expected.length||
       checked.sourceLinks!==expectedLinks||
       checked.hasScriptBlocking!==true||
       (checked.imageReferences?.remote||0)>0)
      throw Error('Final offline structural audit failed');
    fs.renameSync(final,output);
    published=true;
    return {status:'private-offline-export-created',output,
      restoredGroups:checked.sourceDetails,
      groupLinks:checked.sourceLinks,
      singletonLinks:restored.restoredSingletons,
      remoteImages:checked.imageReferences?.remote||0,
      originalScriptsDisabled:checked.hasScriptBlocking,
      evidenceDirectory:keepEvidence?stage:null,
      limitations:[
        'Current site-specific capture layout requires exactly eight singleton links',
        'Fonti buttons are intentionally inert; singleton labels may wrap below icons',
        'Visible HTML capture does not certify completeness of the RAW conversation',
        'Fresh end-to-end Chromium acceptance is required before production claims'
      ]};
  }
  catch(error){
    // Leave evidence private to diagnose failures; never publish the output.
    error.privateEvidenceDirectory=stage;
    throw error;
  }
  finally{
    if(published && !keepEvidence)
      fs.rmSync(stage,{recursive:true,force:true});
  }
}
function usage()
{
  console.error('Usage: node export-offline.mjs <https://chatgpt.com/share/ID> <new-private-output-dir> [--keep-evidence]');
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))
{
  const args=process.argv.slice(2);
  if((args.length!==2&&args.length!==3)||
     (args.length===3&&args[2]!=='--keep-evidence')){
    usage();
    process.exitCode=2;
  }else{
    exportOfflineShare(args[0],args[1],{
      keepEvidence:args.includes('--keep-evidence'),
      progress:message=>console.error('[offline-export] '+message)
    }).then(result=>console.log(JSON.stringify(result,null,2)),
      error=>{
        console.error('[offline-export] '+error.message);
        if(error.privateEvidenceDirectory)
          console.error('[offline-export] Private diagnostics: '+
            error.privateEvidenceDirectory);
        process.exitCode=1;
      });
  }
}
