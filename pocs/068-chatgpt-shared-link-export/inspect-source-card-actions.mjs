'use strict';
import fs from 'node:fs';
import path from 'node:path';
// Separate opt-in probe for source-card navigation intent in a disposable
// Chromium page. CDP Fetch interception is mandatory before any card click.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function browserSourceCardIntent()
{
  const active=globalThis.__rumiaiSourceActive;
  const trigger=active?.trigger;
  const container=trigger?.getAttribute?.('aria-controls')?
    document.getElementById(trigger.getAttribute('aria-controls')):null;
  const buttons=[...(container?.querySelectorAll('button')||[])].slice(0,12);
  if(!buttons.length)return {status:'no-card-buttons',cards:[]};
  const seen=globalThis.__rumiaiSourceActionSeen||
    (globalThis.__rumiaiSourceActionSeen=new Set());
  const key=String(trigger.getAttribute('aria-controls')||'')+
    ':'+String(buttons.length);
  if(seen.has(key))return {status:'already-probed',cards:[]};
  seen.add(key);
  const cards=[];
  const anchorPrototype=globalThis.HTMLAnchorElement?.prototype;
  const valid=value=>{
    if(typeof value!=='string' || value.length>4096)return null;
    try{
      const url=new URL(value,location.href);
      return url.protocol==='https:' && !url.username && !url.password?url.href:null;
    }catch{return null;}
  };
  let cardIndex=-1;
  // Return null to prevent a popup target from being created; CDP Fetch
  // independently blocks network requests from alternate navigation APIs.
  // Installed for the life of this disposable source-intent capture.
  // Delayed handlers must never regain the original popup opener.
  window.open=function(value){
    if(cardIndex>=0){
      const url=valid(value);
      if(url)cards[cardIndex].attemptedOpen.push(url);
    }
    return null;
  };
  if(anchorPrototype){
    anchorPrototype.click=function(){
      if(cardIndex>=0){
        const url=valid(this.href);
        if(url)cards[cardIndex].anchorClick.push(url);
      }
    };
  }
  try{
    for(let i=0;i<buttons.length;i++){
      cardIndex=i;
      const item={index:i,attemptedOpen:[],anchorClick:[],clicked:false,
        handlerError:false,connected:buttons[i].isConnected!==false};
      cards.push(item);
      if(!item.connected)continue;
      try{buttons[i].click();item.clicked=true;}
      catch{item.handlerError=true;}
      await new Promise(resolve=>setTimeout(resolve,70));
    }
  }finally{
    cardIndex=-1;
  }
  return {status:'probed',cards};
}
export async function probeSourceCardIntent(cdp,sid,record,row)
{
  // A non-optional, fail-closed network guard: never click when Fetch.enable
  // fails. Intercept all outbound requests while executing the source action.
  let guarded=false;
  try{
    if(!cdp.blockRequests){
      // Enable only after the normal page has loaded its original assets.
      cdp.blockRequests=true;
      cdp.blockedRequestEvents=[];
      await cdp.send('Fetch.enable',{
        patterns:[{urlPattern:'*',requestStage:'Request'}]},sid,7000);
    }
    guarded=true;
    cdp.blockedRequestEvents=[];
    const expression='('+browserSourceCardIntent.toString()+')()';
    const answer=await cdp.send('Runtime.evaluate',{
      expression,awaitPromise:true,returnByValue:true},sid,12000);
    await pause(150);
    const result=answer.result?.value||{status:'unavailable',cards:[]};
    record({kind:'interaction.source-card-intents',
      ordinal:row.ordinal,groupIndex:row.index,
      status:result.status||'unavailable',
      cards:Array.isArray(result.cards)?result.cards:[],
      blockedRequests:cdp.blockedRequestEvents.slice(0,80)});
  }catch{
    record({kind:'interaction.source-card-intents-unavailable',
      ordinal:row.ordinal,groupIndex:row.index,
      guarded});
  }finally{
    // Deliberately preserve Fetch interception for the rest of this disposable
    // capture: delayed handlers must not regain external networking.
    if(!guarded)
      record({kind:'interaction.navigation-guard-unavailable'});
  }
}
export function summarizeSourceCardIntents(capture)
{
  // Privacy-preserving metadata only; no URLs or conversation text.
  const entries=fs.readFileSync(path.join(capture,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  const groups=[];
  for(const event of entries.filter(e=>e.kind==='interaction.source-card-intents')){
    const cards=event.cards||[];
    groups.push({ordinal:event.ordinal,index:event.groupIndex,
      status:event.status,cards:cards.length,
      clickAttempts:cards.filter(c=>c.clicked).length,
      windowOpenTargets:cards.reduce((n,c)=>n+(c.attemptedOpen||[]).length,0),
      anchorClickTargets:cards.reduce((n,c)=>n+(c.anchorClick||[]).length,0),
      blockedRequests:(event.blockedRequests||[]).length});
  }
  return {status:'private-safe-source-card-intents',groups,
    limitations:['Click attempts do not prove the source URL without attributed intent',
      'No actual remote navigation is permitted while guard is active',
      'The browser may stop rendering a mounted group after a card action',
      'No link values or conversation contents are printed']};
}

if(process.argv[1] && path.resolve(process.argv[1])===
  path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3)
  {
    console.error('Usage: node inspect-source-card-actions.mjs <private-capture-dir>');
    process.exitCode=2;
  }
  else
  {
    try{
      console.log(JSON.stringify(summarizeSourceCardIntents(
        path.resolve(process.argv[2])),null,2));
    }catch{
      console.error('Unable to summarize private source-card evidence');
      process.exitCode=1;
    }
  }
}
