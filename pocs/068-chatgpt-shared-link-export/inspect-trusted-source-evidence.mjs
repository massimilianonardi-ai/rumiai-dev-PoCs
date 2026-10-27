'use strict';
// Strict, private-safe source-card target attribution across captures.
// Only per-card HTTPS window.open/anchorClick intent counts as destination;
// adjacent blocked requests and page-level anchors do not.
import fs from 'node:fs';
import path from 'node:path';

function events(directory)
{
  const filename=path.join(path.resolve(directory),'events.jsonl');
  return fs.readFileSync(filename,'utf8').split(/\r?\n/)
    .filter(Boolean).map((line,i)=>{
      try{return JSON.parse(line);}
      catch{throw Error('Invalid JSONL event at line '+(i+1));}
    });
}
function identity(ordinal,index)
{
  if(!Number.isSafeInteger(ordinal)||ordinal<0||
     !Number.isSafeInteger(index)||index<0)
    throw Error('Invalid source group ordinal or index');
  return ordinal+':'+index;
}
function verifiedHttps(value)
{
  if(typeof value!=='string'||value.length>4096)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password)return null;
    return url.href;
  }catch{return null;}
}
export function collectTrustedSourceEvidence(captures)
{
  if(!Array.isArray(captures)||!captures.length)
    throw Error('At least one private capture is required');
  const expected=new Map(), discovered=new Map(), rejected=new Map();
  let dispatched=0,ambiguousCards=0;
  for(const capture of captures)
  {
    for(const event of events(capture))
    {
      if(event.kind!=='interaction.source-hover' &&
         event.kind!=='interaction.trusted-source-card-intents')continue;
      const ordinal=Number(event.ordinal);
      const index=Number(event.kind==='interaction.source-hover'?
        event.index:event.groupIndex);
      const key=identity(ordinal,index);
      const count=Number(event.expectedSources);
      if(!Number.isSafeInteger(count)||count<1||count>40)
        throw Error('Invalid expected source count');
      const old=expected.get(key);
      if(old!==undefined && old!==count)
        throw Error('Conflicting source group count across captures');
      expected.set(key,count);
      if(event.kind!=='interaction.trusted-source-card-intents')continue;
      if(!Array.isArray(event.attempts))
        throw Error('Invalid source-card attempts');
      let cards=discovered.get(key);
      if(!cards){cards=new Map();discovered.set(key,cards);}
      const indices=new Set();
      for(const attempt of event.attempts)
      {
        const sourceIndex=Number(attempt.index);
        if(!Number.isSafeInteger(sourceIndex)||sourceIndex<0||
           sourceIndex>=count||indices.has(sourceIndex))
          throw Error('Invalid or duplicate card index in group observation');
        indices.add(sourceIndex);
        if(attempt.status!=='dispatched')continue;
        dispatched++;
        const intents=[...(attempt.windowOpen||[]),
          ...(attempt.anchorClick||[])];
        if(!intents.length)continue;
        const urls=new Set(intents.map(verifiedHttps));
        if(urls.has(null)||urls.size!==1){
          ambiguousCards++;
          if(!rejected.has(key))rejected.set(key,new Set());
          rejected.get(key).add(sourceIndex);
          continue;
        }
        const url=[...urls][0];
        if(cards.has(sourceIndex) && cards.get(sourceIndex)!==url)
          throw Error('Conflicting source destination across captures');
        cards.set(sourceIndex,url);
      }
    }
  }
  const groups=[...expected.entries()].map(([key,count])=>{
    const [ordinal,index]=key.split(':').map(Number);
    const cards=discovered.get(key)||new Map();
    const unsafe=rejected.get(key)||new Set();
    const verifiedCards=[...cards.keys()].filter(i=>!unsafe.has(i)).length;
    const complete=verifiedCards===count && Array.from({length:count},
      (_,i)=>cards.has(i) && !unsafe.has(i)).every(Boolean);
    return {ordinal,index,expectedSources:count,verifiedCards,
      complete,targets:complete?
        Array.from({length:count},(_,i)=>cards.get(i)):null};
  }).sort((a,b)=>a.ordinal-b.ordinal||a.index-b.index);
  return {groups,dispatched,ambiguousCards};
}
export function summarizeTrustedSourceEvidence(captures)
{
  const info=collectTrustedSourceEvidence(captures);
  return {status:'private-safe-source-link-evidence',
    expectedGroups:info.groups.length,
    verifiedGroups:info.groups.filter(x=>x.complete).length,
    verifiedCards:info.groups.reduce((n,x)=>n+x.verifiedCards,0),
    dispatched:info.dispatched,
    ambiguousCards:info.ambiguousCards,
    groups:info.groups.map(({ordinal,index,expectedSources,
      verifiedCards,complete})=>({
      ordinal,index,expectedSources,verifiedCards,complete
    })),
    limitations:[
      'Only unambiguous HTTPS destinations intercepted directly for a card are accepted',
      'Adjacent blocked requests and unspecific anchors are not attributed to source cards',
      'Ordinal and pill-index identity across captures must be independently validated',
      'No private URLs, message IDs or conversation text appear in this report'
    ]};
}
if(process.argv[1] && path.resolve(process.argv[1])===
   path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length<3){
    console.error('Usage: node inspect-trusted-source-evidence.mjs <private-capture-dir> [more-private-capture-dirs...]');
    process.exitCode=2;
  }else{
    try{
      console.log(JSON.stringify(summarizeTrustedSourceEvidence(
        process.argv.slice(2)),null,2));
    }catch{
      console.error('Unable to verify private source-link evidence');
      process.exitCode=1;
    }
  }
}
