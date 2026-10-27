'use strict';
import fs from 'node:fs';
import path from 'node:path';
// Opt-in live observation of React-only controls in the same private CDP session.
// URLs in interaction events are private evidence, never CLI output.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function liveExpandMessages()
{
  let clicked=0, candidates=0, labelMatches=0;
  const normalize = text => (text||'').normalize('NFKC')
    .replace(/\s+/g,' ').trim().toLowerCase();
  const isLabel = text => /^(mostra di più|mostra di piu|show more)$/.test(normalize(text));
  for (const button of document.querySelectorAll(
    'button[data-conversation-preview-interactive][aria-expanded="false"]'))
  {
    candidates++;
    // The button can also contain hidden labels and icons; checking its
    // aggregated textContent for exact equality misses the visible label.
    const leaves=[...button.querySelectorAll('span')]
      .filter(node=>node.children.length===0);
    if (!isLabel(button.textContent) && !leaves.some(node=>isLabel(node.textContent)))
      continue;
    labelMatches++;
    if (!button.closest('[data-can-expand]') || clicked>=8) continue;
    button.click();
    clicked++;
  }
  return {candidates,labelMatches,clicked};
}
export function liveHoverSource()
{
  const seen=globalThis.__rumiaiSourceHovered ||
    (globalThis.__rumiaiSourceHovered=new Set());
  for(const wrapper of document.querySelectorAll('[data-turn-id-container]'))
  {
    const marker=wrapper.querySelector('[data-testid^="conversation-turn-"]') ||
      (wrapper.matches('[data-testid^="conversation-turn-"]')?wrapper:null);
    const match=/^conversation-turn-(\d+)$/.exec(
      marker?.getAttribute('data-testid')||'');
    if(!match)continue;
    let index=0;
    for(const span of wrapper.querySelectorAll('span'))
    {
      const label=(span.textContent||'').trim();
      if(span.children.length || !/^\+\d+$/.test(label))continue;
      const key=match[1]+':'+index++;
      if(seen.has(key))continue;
      seen.add(key);
      // React popover behavior is owned by the accessible trigger, which
      // may be several ancestors above the +N label, not by the badge div.
      const trigger=span.closest('[aria-haspopup]');
      if(!trigger || trigger.localName==='a' || trigger.closest?.('a[href]'))continue;
      const popupSelector='[role="dialog"],[role="tooltip"],[role="menu"],' +
        '[data-radix-popper-content-wrapper]';
      const visible=node=>{
        if(node.getAttribute?.('data-state')==='closed')return false;
        const rect=node.getBoundingClientRect?.();
        if(rect && (rect.width<=0 || rect.height<=0))return false;
        const style=typeof getComputedStyle==='function'?getComputedStyle(node):null;
        return !style || (style.display!=='none' && style.visibility!=='hidden'
          && style.opacity!=='0');
      };
      globalThis.__rumiaiSourceActive={
        trigger, beforePopups:new Set([...document.querySelectorAll(popupSelector)]
          .filter(visible)),
        beforeAnchors:new Set([...document.querySelectorAll('a[href]')]
          .map(a=>a.href).filter(href=>href.startsWith('https://')))
      };
      try
      {
        trigger.dispatchEvent(new PointerEvent('pointerover',
          {bubbles:true,pointerType:'mouse'}));
        trigger.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        trigger.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
      }
      catch {trigger.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));}
      // Only activate an explicit popup trigger; never click arbitrary links.
      if(trigger.getAttribute('aria-expanded')!=='true')trigger.click();
      return {attempted:1,ordinal:Number(match[1]),
        index:index-1,expectedSources:Number(label.slice(1))+1};
    }
  }
  return {attempted:0};
}
export function liveReadHoverLinks()
{
  const active=globalThis.__rumiaiSourceActive;
  if(!active)return {links:[],scopeType:'none',observedNewAnchors:0};
  const valid=(node)=>{
    if(!node || typeof node.querySelectorAll!=='function' ||
       node.getAttribute?.('data-state')==='closed')return false;
    const rect=node.getBoundingClientRect?.();
    if(rect && (rect.width<=0 || rect.height<=0))return false;
    const style=typeof getComputedStyle==='function'?getComputedStyle(node):null;
    return !style || (style.display!=='none' && style.visibility!=='hidden'
      && style.opacity!=='0');
  };
  const hrefs=root=>[...root.querySelectorAll('a[href]')]
    .map(a=>a.href).filter(href=>href.startsWith('https://'));
  const newAnchors=[...new Set(hrefs(document).filter(
    href=>!active.beforeAnchors.has(href)))];
  const controls=active.trigger.getAttribute('aria-controls');
  const controlled=controls?document.getElementById(controls):null;
  // A valid but empty controlled element is not enough: the actual source
  // links may reside in a separate newly visible portal.
  const controlledLinkCount=controlled && valid(controlled)?
    [...new Set(hrefs(controlled))].length:0;
  let scope=controlledLinkCount>0?controlled:null;
  let scopeType=scope?'aria-controls':'none';
  const expanded=active.trigger.getAttribute('aria-expanded')==='true' ||
    active.trigger.getAttribute('data-state')==='open';
  let newVisiblePopupCandidates=0;
  if(scopeType==='none')
  {
    const selector='[role="dialog"],[role="tooltip"],[role="menu"],' +
      '[data-radix-popper-content-wrapper]';
    const fresh=[...document.querySelectorAll(selector)]
      .filter(node=>!active.beforePopups.has(node) && valid(node) &&
        hrefs(node).length>0);
    // Nested Radix wrappers may represent the same popup; retain only roots.
    const outer=fresh.filter(node=>!fresh.some(other=>
      other!==node && other.contains(node)));
    newVisiblePopupCandidates=outer.length;
    if(outer.length===1){scope=outer[0];scopeType='single-new-popup';}
  }
  const links=scopeType==='none'?[]:[...new Set(hrefs(scope))].slice(0,40);
  const contentRoot=scope||controlled;
  // Counts only: a React source panel may present clickable cards rather
  // than <a href> nodes; the archive must not invent destinations.
  const contentStructure=contentRoot && typeof contentRoot.querySelectorAll==='function'?
    {buttons:contentRoot.querySelectorAll('button').length,
      linkRoles:contentRoot.querySelectorAll('[role="link"]').length,
      anchorElements:contentRoot.querySelectorAll('a').length}:null;
  return {links,scopeType,triggerExpanded:expanded,
    controlledLinkCount,newVisiblePopupCandidates,contentStructure,
    observedNewAnchors:newAnchors.length};
}
const expr=fn=>'('+fn.toString()+')()';
export async function sampleLiveShareInteractions(cdp,sid,record)
{
  try
  {
    const response=await cdp.send('Runtime.evaluate',
      {expression:expr(liveExpandMessages),returnByValue:true},sid,7000);
    const sample=response.result?.value||{};
    const clicked=Number(sample.clicked||0);
    if (Number(sample.candidates||0)>0)
      record({kind:'interaction.show-more-candidates',
        count:Number(sample.candidates),labelMatches:Number(sample.labelMatches||0)});
    if (clicked)
    {
      record({kind:'interaction.show-more-clicked',count:clicked});
      // Allow the original React component to commit its expanded DOM.
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
      const result=after.result?.value||{};
      const links=Array.isArray(result.links)?result.links:[];
      record({kind:'interaction.source-hover',ordinal:row.ordinal,
        index:row.index,expectedSources:row.expectedSources,
        scopeType:result.scopeType||'none',
        triggerExpanded:result.triggerExpanded===true,
        controlledLinkCount:Number(result.controlledLinkCount||0),
        newVisiblePopupCandidates:Number(result.newVisiblePopupCandidates||0),
        contentStructure:result.contentStructure||null,
        observedNewAnchors:Number(result.observedNewAnchors??links.length),
        scopedAnchorCount:links.length,links});
    }
  }
  catch {record({kind:'interaction.source-hover-unavailable'});}
}


export function summarizeLiveShareInteractions(captureDir)
{
  const data=fs.readFileSync(path.join(captureDir,'events.jsonl'),'utf8');
  const totals={expandCandidates:0,expandLabelsMatched:0,expandedClickAttempts:0,sourceHoverAttempts:0,
    sourceHoversWithNewAnchors:0,scopedSourcePopovers:0,
    scopedCountMatches:0,scopedWithLinks:0,
    controlledPopupWithLinks:0,
    emptyControlledPanels:0,linkLikeWithoutHref:0,
    distinctCapturedTargetUrls:0,
    userExpansionErrors:0,sourceHoverErrors:0};
  const urls=new Set(), byOrdinal=new Map(), sourceGroups=[];
  for(const line of data.split(/\r?\n/).filter(Boolean))
  {
    const e=JSON.parse(line);
    if(e.kind==='interaction.show-more-candidates') {
      totals.expandCandidates+=e.count||0;
      totals.expandLabelsMatched+=e.labelMatches||0;
    }
    else if(e.kind==='interaction.show-more-clicked')
      totals.expandedClickAttempts+=e.count||0;
    else if(e.kind==='interaction.show-more-unavailable')
      totals.userExpansionErrors++;
    else if(e.kind==='interaction.source-hover-unavailable')
      totals.sourceHoverErrors++;
    else if(e.kind==='interaction.source-hover')
    {
      totals.sourceHoverAttempts++;
      if(e.observedNewAnchors>0)totals.sourceHoversWithNewAnchors++;
      if(['aria-controls','single-new-popup'].includes(e.scopeType)) {
        totals.scopedSourcePopovers++;
        if((e.links||[]).length>0)totals.scopedWithLinks++;
      }
      if(e.scopeType==='aria-controls' && (e.links||[]).length>0)
        totals.controlledPopupWithLinks++;
      if(e.controlledLinkCount===0 && e.contentStructure)
        totals.emptyControlledPanels++;
      if((e.links||[]).length===0 && e.contentStructure &&
          (e.contentStructure.buttons>0 || e.contentStructure.linkRoles>0))
        totals.linkLikeWithoutHref++;
      if(Number.isSafeInteger(e.expectedSources) &&
          e.expectedSources===(e.links||[]).length && e.links.length>0 &&
          ['aria-controls','single-new-popup'].includes(e.scopeType))
        totals.scopedCountMatches++;
      const ordinal=Number(e.ordinal);
      if(Number.isSafeInteger(ordinal) && ordinal>=0)
      {
        sourceGroups.push({
          ordinal,index:Number.isSafeInteger(e.index)?e.index:null,
          expectedSources:Number.isSafeInteger(e.expectedSources)?e.expectedSources:null,
          scopeType:e.scopeType||'none',
          triggerExpanded:e.triggerExpanded===true,
          scopedAnchorCount:Number(e.scopedAnchorCount??(e.links||[]).length),
          pageAnchorChanges:Number(e.observedNewAnchors||0),
          newVisiblePopupCandidates:Number(e.newVisiblePopupCandidates||0),
          buttons:Number(e.contentStructure?.buttons||0),
          linkRoles:Number(e.contentStructure?.linkRoles||0),
          anchorElements:Number(e.contentStructure?.anchorElements||0)
        });
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
    sourceGroups:sourceGroups.sort((a,b)=>a.ordinal-b.ordinal||a.index-b.index),
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
