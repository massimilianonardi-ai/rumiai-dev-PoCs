'use strict';
import fs from 'node:fs';
import path from 'node:path';
// Opt-in live observation of React-only controls in the same private CDP session.
// URLs in interaction events are private evidence, never CLI output.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function liveExpandMessages()
{
  let clicked=0;
  for (const button of document.querySelectorAll(
    'button[data-conversation-preview-interactive][aria-expanded="false"]'))
  {
    if (clicked>=8) break;
    const label=(button.textContent||'').normalize('NFKC').trim().toLowerCase();
    if (!/^(mostra di più|mostra di piu|show more)$/.test(label)) continue;
    if (!button.closest('[data-can-expand]')) continue;
    button.click();
    clicked++;
  }
  return {clicked};
}
function liveHoverSource()
{
  const seen=globalThis.__rumiaiSourceHovered ||
    (globalThis.__rumiaiSourceHovered=new Set());
  for (const wrapper of document.querySelectorAll('[data-turn-id-container]'))
  {
    const marker=wrapper.querySelector('[data-testid^="conversation-turn-"]') ||
      (wrapper.matches('[data-testid^="conversation-turn-"]')?wrapper:null);
    const match=/^conversation-turn-(\d+)$/.exec(
      marker?.getAttribute('data-testid')||'');
    if (!match) continue;
    let index=0;
    for (const span of wrapper.querySelectorAll('span'))
    {
      if (span.children.length || !/^\+\d+$/.test((span.textContent||'').trim()))
        continue;
      const key=match[1]+':'+index++;
      if (seen.has(key)) continue;
      seen.add(key);
      const trigger=span.closest('[data-d-hoverable], [role="button"],button,a') ||
        span.parentElement?.parentElement || span.parentElement;
      if (!trigger) continue;
      const anchors=[...document.querySelectorAll('a[href]')]
        .map(a=>a.href).filter(x=>x.startsWith('https://'));
      globalThis.__rumiaiSourceHoverBefore=new Set(anchors);
      try
      {
        trigger.dispatchEvent(new PointerEvent('pointerover',
          {bubbles:true,pointerType:'mouse'}));
        trigger.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        trigger.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
      }
      catch {trigger.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));}
      return {attempted:1,ordinal:Number(match[1]),index:index-1};
    }
  }
  return {attempted:0};
}
function liveReadHoverLinks()
{
  const before=globalThis.__rumiaiSourceHoverBefore||new Set();
  const hrefs=[...document.querySelectorAll('a[href]')]
    .map(a=>a.href).filter(x=>x.startsWith('https://')&&!before.has(x));
  return {links:[...new Set(hrefs)].slice(0,20)};
}
const expr=fn=>'('+fn.toString()+')()';
export async function sampleLiveShareInteractions(cdp,sid,record)
{
  try
  {
    const response=await cdp.send('Runtime.evaluate',
      {expression:expr(liveExpandMessages),returnByValue:true},sid,7000);
    const clicked=Number(response.result?.value?.clicked||0);
    if (clicked)
    {
      record({kind:'interaction.show-more-clicked',count:clicked});
      // The existing page observer captures DOM after React commits.
      await pause(160);
    }
  }
  catch {record({kind:'interaction.show-more-unavailable'});}
  try
  {
    const response=await cdp.send('Runtime.evaluate',
      {expression:expr(liveHoverSource),returnByValue:true},sid,7000);
    const row=response.result?.value;
    if(row?.attempted===1)
    {
      await pause(300);
      const after=await cdp.send('Runtime.evaluate',
        {expression:expr(liveReadHoverLinks),returnByValue:true},sid,7000);
      const links=after.result?.value?.links||[];
      record({kind:'interaction.source-hover',ordinal:row.ordinal,
        index:row.index,observedNewAnchors:links.length,links});
    }
  }
  catch {record({kind:'interaction.source-hover-unavailable'});}
}


export function summarizeLiveShareInteractions(captureDir)
{
  const data=fs.readFileSync(path.join(captureDir,'events.jsonl'),'utf8');
  const totals={expandedClickAttempts:0,sourceHoverAttempts:0,
    sourceHoversWithNewAnchors:0,distinctCapturedTargetUrls:0,
    userExpansionErrors:0,sourceHoverErrors:0};
  const urls=new Set(), byOrdinal=new Map();
  for(const line of data.split(/\r?\n/).filter(Boolean))
  {
    const e=JSON.parse(line);
    if(e.kind==='interaction.show-more-clicked')
      totals.expandedClickAttempts+=e.count||0;
    else if(e.kind==='interaction.show-more-unavailable')
      totals.userExpansionErrors++;
    else if(e.kind==='interaction.source-hover-unavailable')
      totals.sourceHoverErrors++;
    else if(e.kind==='interaction.source-hover')
    {
      totals.sourceHoverAttempts++;
      if(e.observedNewAnchors>0)totals.sourceHoversWithNewAnchors++;
      const ordinal=Number(e.ordinal);
      if(Number.isSafeInteger(ordinal) && ordinal>=0)
      {
        const item=byOrdinal.get(ordinal)||{ordinal,hoverAttempts:0,withLinks:0};
        item.hoverAttempts++;
        if(e.observedNewAnchors>0)item.withLinks++;
        byOrdinal.set(ordinal,item);
      }
      for(const url of e.links||[])
        if(typeof url==='string' && url.startsWith('https://'))urls.add(url);
    }
  }
  totals.distinctCapturedTargetUrls=urls.size;
  return {status:'private-safe-live-interactions',...totals,
    sourceOrdinals:[...byOrdinal.values()].sort((a,b)=>a.ordinal-b.ordinal),
    limitations:['A synthetic hover may not open every source group',
      'Captured links may include unrelated DOM portals; group identity is not proven',
      'Expanded clicks are attempts; snapshot completeness must be verified separately',
      'Source URLs, conversation text, profile data and message IDs are not printed']};
}
if(process.argv[1] && path.resolve(process.argv[1])===
    path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3)
  {
    console.error('Usage: node inspect-live-share-interactions.mjs <private-capture-dir>');
    process.exitCode=2;
  }
  else
  {
    try
    {
      console.log(JSON.stringify(summarizeLiveShareInteractions(
        path.resolve(process.argv[2])),null,2));
    }
    catch {console.error('Unable to inspect private interaction capture');process.exitCode=1;}
  }
}
