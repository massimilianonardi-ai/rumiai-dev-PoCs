#!/usr/bin/env node
// Applies the user-supplied Python algorithm's verified active-branch model
// to a real JSON response captured in the isolated investigation. Never
// fabricates mapping data from scroll snapshots. All full content stays local.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {investigationPaths} from './investigate.mjs';
import {conversationModel} from './conversation-model.mjs';
import {auditRenderingEvidence} from './render-audit.mjs';

export function snapshotCandidates(value,maxDepth=6,maxItems=3000){
  const results=[],seen=new WeakSet();
  function visit(v,p,depth){
    if(depth>maxDepth||results.length>=maxItems||!v||typeof v!=='object'||seen.has(v))return;
    seen.add(v);
    if(!Array.isArray(v)&&
       v.mapping&&typeof v.mapping==='object'&&!Array.isArray(v.mapping)&&
       typeof v.current_node==='string')
      results.push({path:p,snapshot:v});
    if(Array.isArray(v)){
      v.slice(0,70).forEach((item,i)=>visit(item,p+'/'+i,depth+1));
    }else{
      for(const [key,sub] of Object.entries(v).slice(0,70))
        if(key!=='mapping')visit(sub,p+'/'+key,depth+1);
    }
  }
  visit(value,'',0);
  return results;
}
export async function extractRun(run){
  const dir=investigationPaths(run);
  if(await fs.realpath(dir)!==dir)throw Error('extract.run-symlink');
  const responses=path.join(dir,'responses');
  if(await fs.realpath(responses)!==responses)throw Error('extract.responses-symlink');
  const names=(await fs.readdir(responses))
    .filter(x=>/^[0-9]{5}\.body$/.test(x)).sort();
  let valid=0,invalid=0;
  const summaries=[];
  let assets=[];
  try{
    const raw=await fs.readFile(path.join(dir,'render-assets.jsonl'),'utf8');
    assets=raw.split('\n').filter(Boolean).map(x=>JSON.parse(x));
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const richStates=[];
  for(const label of ['initial','top','bottom','top-again']){
    try{
      const raw=await fs.readFile(path.join(dir,'render-'+label+'.json'),'utf8');
      richStates.push(JSON.parse(raw));
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  for(const name of names){
    const filename=path.join(responses,name);
    if(await fs.realpath(filename)!==filename)
      throw Error('extract.response-symlink');
    let data;
    try{data=JSON.parse(await fs.readFile(filename,'utf8'));}
    catch{continue;}
    for(const candidate of snapshotCandidates(data)){
      try{
        const model=conversationModel(candidate.snapshot);
        const id=String(valid++).padStart(4,'0');
        const output=path.join(dir,'candidate-model-'+id+'.json');
        // Forensic evidence: retain original message objects, not merely
        // a flattened Markdown conversion or ad-hoc HTML approximation.
        await fs.writeFile(output,JSON.stringify(model,null,2)+'\n',
          {flag:'wx',mode:0o600});
        const audit=auditRenderingEvidence(model,assets,richStates);
        const auditFile='candidate-render-audit-'+id+'.json';
        await fs.writeFile(path.join(dir,auditFile),
          JSON.stringify(audit,null,2)+'\n',{flag:'wx',mode:0o600});
        summaries.push({file:name,path:candidate.path,renderAudit:auditFile,
          unresolvedReferences:audit.unresolvedReferences,
          output:path.basename(output),
          mappingCount:model.mappingCount,
          activeBranchCount:model.activeBranchCount,
          visibleCount:model.visibleCount,
          resourceReferences:model.visible.reduce((n,x)=>
            n+x.resources.references.length,0),
          correctness:'candidate-schema-only; compare against actual shared page'});
      }catch{invalid++;}
    }
  }
  const report={responsesChecked:names.length,validCandidates:valid,
    invalidCandidates:invalid,summaries,
    // The shared-link page might not use this exact macOS app structure.
    completeExportVerified:false};
  await fs.writeFile(path.join(dir,'snapshot-candidates.json'),
    JSON.stringify(report,null,2)+'\n',{mode:0o600});
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  extractRun(process.argv[2]).then(result=>{
    process.stdout.write('[SNAPSHOT] '+JSON.stringify(result)+'\n');
  }).catch(e=>{process.stderr.write('[ERRORE] '+e.message+'\n');
    process.exitCode=1;});
}
