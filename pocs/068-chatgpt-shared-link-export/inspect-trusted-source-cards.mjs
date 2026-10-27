'use strict';
// Opt-in trusted pointer events against source-card buttons; never used by the
// offline archive. Every request is blocked via Chrome DevTools Fetch.
import fs from 'node:fs';
import path from 'node:path';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const expression=(fn,...args)=>
  '('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')';

export function browserPrepareTrustedSourceCard(index,expected)
{
  const trigger=globalThis.__rumiaiSourceActive?.trigger;
  const id=trigger?.getAttribute?.('aria-controls');
  const root=id?document.getElementById(id):null;
  const cards=[...(root?.querySelectorAll('button')||[])].slice(0,20);
  if(!cards.length || cards.length!==expected)
    return {status:'card-count-mismatch',count:cards.length};
  if(!globalThis.__rumiaiTrustedSourceIntent)
  {
    const state={active:null};
    globalThis.__rumiaiTrustedSourceIntent=state;
    const https=value=>{
      if(typeof value!=='string' || value.length>4096)return null;
      try{
        const url=new URL(value,location.href);
        return url.protocol==='https:' && !url.username && !url.password?
          url.href:null;
      }catch{return null;}
    };
    window.open=function(url){
      if(state.active){
        const target=https(url);
        if(target)state.active.windowOpen.push(target);
      }
      return null;
    };
    if(globalThis.HTMLAnchorElement?.prototype)
      globalThis.HTMLAnchorElement.prototype.click=function(){
        if(state.active){
          const target=https(this.href);
          if(target)state.active.anchorClick.push(target);
        }
      };
  }
  const state=globalThis.__rumiaiTrustedSourceIntent;
  const card=cards[index];
  if(!card || card.isConnected===false)return {status:'card-unmounted'};
  const rect=card.getBoundingClientRect();
  const x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2;
  if(!Number.isFinite(x)||!Number.isFinite(y)||rect.width<3||rect.height<3 ||
     x<0||y<0||x>=innerWidth||y>=innerHeight)
    return {status:'card-not-visible'};
  const hit=document.elementFromPoint(x,y);
  if(!hit || (hit!==card && !card.contains(hit)))
    return {status:'card-obscured'};
  state.active={index,windowOpen:[],anchorClick:[]};
  return {status:'ready',x,y,count:cards.length};
}
export function browserReadTrustedSourceCard()
{
  const state=globalThis.__rumiaiTrustedSourceIntent;
  if(!state?.active)return {windowOpen:[],anchorClick:[],active:false};
  const active=state.active;
  state.active=null;
  return {windowOpen:active.windowOpen,anchorClick:active.anchorClick,active:true};
}
export async function probeTrustedSourceGroup(cdp,sid,record,row)
{
  let guardReady=false;
  try{
    if(!cdp.blockRequests){
      cdp.blockRequests=true;
      cdp.blockedRequestEvents=[];
      await cdp.send('Fetch.enable',{
        patterns:[{urlPattern:'*',requestStage:'Request'}]},sid,7000);
    }
    guardReady=true;
  }catch{
    record({kind:'interaction.trusted-source-guard-unavailable',
      ordinal:row.ordinal,index:row.index});
    return;
  }
  const attempts=[];
  const count=Math.min(Math.max(Number(row.expectedSources)||0,0),12);
  for(let index=0;index<count;index++)
  {
    let outcome={index,status:'unavailable',
      windowOpen:[],anchorClick:[],blockedRequests:[]};
    try{
      const setup=await cdp.send('Runtime.evaluate',{
        expression:expression(browserPrepareTrustedSourceCard,index,count),
        returnByValue:true},sid,6000);
      const candidate=setup.result?.value||{};
      outcome.status=candidate.status||'unavailable';
      if(outcome.status==='ready')
      {
        const {x,y}=candidate;
        if(!Number.isFinite(x)||!Number.isFinite(y))
          throw Error('Invalid coordinates');
        // CDP mouse input is issued in the page session, not a synthetic
        // DOM click. The Fetch guard was installed before these calls.
        const seen=cdp.blockedRequestEvents.length;
        await cdp.send('Input.dispatchMouseEvent',{
          type:'mouseMoved',x,y,button:'none',buttons:0},sid,6000);
        await cdp.send('Input.dispatchMouseEvent',{
          type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1},sid,6000);
        await cdp.send('Input.dispatchMouseEvent',{
          type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1},sid,6000);
        await pause(180);
        const after=await cdp.send('Runtime.evaluate',{
          expression:expression(browserReadTrustedSourceCard),
          returnByValue:true},sid,6000);
        const result=after.result?.value||{};
        outcome.status=result.active===true?'dispatched':'readback-unavailable';
        outcome.windowOpen=Array.isArray(result.windowOpen)?result.windowOpen:[];
        outcome.anchorClick=Array.isArray(result.anchorClick)?result.anchorClick:[];
        outcome.blockedRequests=cdp.blockedRequestEvents.slice(seen,seen+24);
      }
    }catch{
      outcome.status='input-failed';
    }
    attempts.push(outcome);
  }
  record({kind:'interaction.trusted-source-card-intents',
    ordinal:row.ordinal,groupIndex:row.index,
    expectedSources:row.expectedSources,
    guardReady,attempts});
  // Fetch guard and inert window.open remain active until browser shutdown.
}
export function summarizeTrustedSourceCards(directory)
{
  const rows=fs.readFileSync(path.join(directory,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const groups=[];
  for(const row of rows.filter(x=>x.kind==='interaction.trusted-source-card-intents'))
  {
    const attempts=row.attempts||[];
    groups.push({ordinal:row.ordinal,index:row.groupIndex,
      expectedSources:row.expectedSources,
      attempted:attempts.length,
      dispatched:attempts.filter(x=>x.status==='dispatched').length,
      obscured:attempts.filter(x=>x.status==='card-obscured').length,
      notVisible:attempts.filter(x=>x.status==='card-not-visible').length,
      unmounted:attempts.filter(x=>x.status==='card-unmounted').length,
      opened:attempts.reduce((n,x)=>n+(x.windowOpen||[]).length,0),
      anchorClicks:attempts.reduce((n,x)=>n+(x.anchorClick||[]).length,0),
      blockedRequests:attempts.reduce((n,x)=>n+(x.blockedRequests||[]).length,0)});
  }
  return {status:'private-safe-trusted-source-card-intents',
    guardedFailures:rows.filter(x=>x.kind==='interaction.trusted-source-guard-unavailable').length,
    groups,limits:[
      'Pointer dispatch does not guarantee navigation or capture delayed callbacks',
      'A network request close to a card click does not by itself prove its ownership',
      'All captured URLs remain private and are never included in this report']};
}
if(process.argv[1] && path.resolve(process.argv[1])===
    path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3){
    console.error('Usage: node inspect-trusted-source-cards.mjs <private-capture-dir>');
    process.exitCode=2;
  }else{
    try{
      console.log(JSON.stringify(summarizeTrustedSourceCards(
        path.resolve(process.argv[2])),null,2));
    }catch{
      console.error('Unable to summarize private trusted source-card evidence');
      process.exitCode=1;
    }
  }
}
