#!/usr/bin/env node
// AI-facing bounded technical index from the LOCAL research evidence.
// It reports observations and hypotheses; it never guesses unseen JS code.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {investigationPaths} from './investigate.mjs';

const digest=x=>createHash('sha256').update(String(x)).digest('hex').slice(0,16);
const numbers=x=>typeof x==='number'&&Number.isFinite(x);
async function lines(filename,callback){
  const reader=createInterface({input:createReadStream(filename,{encoding:'utf8'}),
    crlfDelay:Infinity});
  for await(const line of reader){if(line.trim())await callback(JSON.parse(line));}
}
export function analyzeTrace(snapshots,mutations,checkpoints){
  const added=new Map(),removed=new Map(),remounted=new Set(),keys=new Set();
  let highRoot=0,actualNested=0,maxVisible=0,rootScrollObserved=false;
  const uniqueSnapshots=[],phaseSummary=[];
  let previous=null;
  for(const sample of snapshots){
    const items=sample.messages||[];
    const current=new Set(items.map(x=>x.key).filter(Boolean));
    maxVisible=Math.max(maxVisible,items.filter(x=>x.visible).length);
    highRoot=Math.max(highRoot,sample.scroll?.scrollHeight||0);
    actualNested=Math.max(actualNested,
      (sample.boxes||[]).filter(x=>x.actualScroller).length);
    if(numbers(sample.scroll?.windowY)&&sample.scroll.windowY>20)
      rootScrollObserved=true;
    for(const k of current)keys.add(k);
    if(!previous||current.size!==previous.size||
       [...current].some(x=>!previous.has(x))){
      uniqueSnapshots.push({at:sample.at,
        windowY:sample.scroll?.windowY??null,
        rootY:sample.scroll?.rootY??null,
        mounted:current.size,
        entering:previous?[...current].filter(x=>!previous.has(x)).length:0,
        leaving:previous?[...previous].filter(x=>!current.has(x)).length:0});
    }
    previous=current;
  }
  for(const m of mutations){
    if(!m.key)continue;
    if(m.op==='added'){
      added.set(m.key,(added.get(m.key)||0)+1);
      if(removed.has(m.key))remounted.add(m.key);
    }
    if(m.op==='removed')removed.set(m.key,(removed.get(m.key)||0)+1);
  }
  const keysByCheckpoint=checkpoints.map(c=>new Set(
    c.snapshot?.messages?.map(x=>x.key).filter(Boolean)||[]));
  for(let i=0;i<checkpoints.length;i++){
    const c=checkpoints[i],cur=keysByCheckpoint[i];
    phaseSummary.push({phase:c.label,mounted:cur.size,
      rootY:c.snapshot?.scroll?.rootY??null,
      windowY:c.snapshot?.scroll?.windowY??null,
      nestedScrollers:(c.snapshot?.boxes||[])
        .filter(x=>x.actualScroller).length,
      firstIds:[...cur].slice(0,4).map(digest)});
  }
  const first=keysByCheckpoint[0]||new Set();
  const last=keysByCheckpoint.at(-1)||new Set();
  const overlap=[...first].filter(x=>last.has(x)).length;
  const candidateVirtualization=(
    removed.size>0&&added.size>0&&
    (remounted.size>0||uniqueSnapshots.some(x=>x.entering&&x.leaving)));
  return {
    distinctMountedIdentities:keys.size,
    distinctAddedIdentities:added.size,
    distinctRemovedIdentities:removed.size,
    remountedAfterRemoval:remounted.size,
    totalMountEvents:[...added.values()].reduce((a,b)=>a+b,0),
    totalUnmountEvents:[...removed.values()].reduce((a,b)=>a+b,0),
    candidateVirtualization,
    maxVisible,maxRootScrollHeight:highRoot,
    maxNestedActualScrollers:actualNested,rootScrollObserved,
    phaseSummary,checkpointStartEndOverlap:overlap,
    changes:uniqueSnapshots.slice(0,60),
    truncatedChanges:Math.max(0,uniqueSnapshots.length-60),
    // A runtime trace can support virtualization evidence, not its
    // full internal implementation or a guaranteed export algorithm.
    exactImplementationVerified:false
  };
}
export function analyzeCoverage(coverageByPhase,metadata){
  const byId=new Map(metadata.map(x=>[x.scriptId,x]));
  return Object.fromEntries(Object.entries(coverageByPhase).map(([phase,items])=>{
    if(!Array.isArray(items))return [phase,{error:'coverage-unavailable'}];
    const ranked=items.map(item=>{
      const functions=(item.functions||[]).filter(fn=>
        (fn.ranges||[]).some(r=>r.count>0)).length;
      const meta=byId.get(item.scriptId);
      return {url:meta?.url||'[missing-script-metadata]',
        sourceFile:meta?.sourceFile||null,
        sourceSha256:meta?.sha256||null,
        executedFunctionRanges: functions};
    }).sort((a,b)=>b.executedFunctionRanges-a.executedFunctionRanges);
    return [phase,{reportedScripts:items.length,
      executing:ranked.filter(x=>x.executedFunctionRanges>0).length,
      mostActiveScripts:ranked.slice(0,35)}];
  }));
}
export async function analyzeRun(run){
  const dir=investigationPaths(run);
  const location=await fs.realpath(dir);
  if(location!==dir)throw Error('investigation.report-symlink-not-allowed');
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
  const scripts=JSON.parse(await fs.readFile(path.join(dir,'scripts.json'),'utf8'));
  const snapshots=[],mutations=[],checkpoints=[];
  for(const [file,items] of [
    ['dom-samples.jsonl',snapshots],
    ['dom-mutations.jsonl',mutations],
    ['checkpoints.jsonl',checkpoints]
  ])await lines(path.join(dir,file),obj=>items.push(obj));
  const coverage={};
  for(const c of manifest.checkpoints||[]){
    const name=c.label;
    if(!/^[A-Za-z0-9_-]+$/.test(name))continue;
    try{
      coverage[name]=JSON.parse(await fs.readFile(
        path.join(dir,'coverage-'+name+'.json'),'utf8'));
    }catch(e){coverage[name]={error:e.code||e.message};}
  }
  return {run,
    status:manifest.status,
    incomplete:manifest.incomplete,
    warnings:manifest.warnings,
    code:{...manifest.scripts,
      workerCount:manifest.workerUrls?.length||0,
      mainFrameOnly:true,
      coverageCannotProveAllDynamicCode:true},
    network:{...manifest.responses,rawPayloadsRemainPrivate:true},
    observation:analyzeTrace(snapshots,mutations,checkpoints),
    executedCode:analyzeCoverage(coverage,scripts),
    researchNext:'Inspect active saved JS functions, message ID transitions, '+
      'network payload shapes and DOM ownership before specifying export algorithm.',
    exportAlgorithmVerified:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  analyzeRun(process.argv[2]).then(r=>{
    process.stdout.write(JSON.stringify(r,null,2)+'\n');
  }).catch(e=>{process.stderr.write('[ERRORE] '+e.message+'\n');
    process.exitCode=1;});
}
