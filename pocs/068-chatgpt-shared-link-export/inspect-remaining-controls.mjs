'use strict';
// Focused and opt-in live observation of React-only singleton citations and
// standalone "Fonti" panels. All external requests are blocked before input.
// Raw destinations/panel DOM are private events and never printed by summary.
import fs from 'node:fs';
import path from 'node:path';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const expr=(fn,...args)=>
  '('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')';

export function browserSelectRemainingControl()
{
  const state=globalThis.__rumiaiRemaining || (
    globalThis.__rumiaiRemaining={seen:new Set(),target:null});
  const norm=value=>String(value||'').normalize('NFKC')
    .replace(/\s+/g,' ').trim().toLowerCase();
  const isBadge=el=>[...el.querySelectorAll('span')].some(span=>
    !span.children.length && /^\+\d+$/.test((span.textContent||'').trim()));
  const wrappers=[...document.querySelectorAll('[data-turn-id-container]')]
    .filter(node=>!node.parentElement?.closest('[data-turn-id-container]'));
  for(const turn of wrappers)
  {
    const marker=turn.querySelector('[data-testid^="conversation-turn-"]')||
      (turn.matches('[data-testid^="conversation-turn-"]')?turn:null);
    const match=/^conversation-turn-(\d+)$/.exec(
      marker?.getAttribute('data-testid')||'');
    if(!match)continue;
    const ordinal=Number(match[1]);
    const fonti=[...turn.querySelectorAll('button')].filter(button=>{
      const text=norm(button.textContent);
      const accessible=norm(button.getAttribute('aria-label'));
      return /^(fonti|sources)$/.test(text)||
        /^(fonti|sources)$/.test(accessible);
    });
    const owners=[...turn.querySelectorAll('[aria-haspopup]')].filter(node=>{
      if(node.closest('button')&&fonti.includes(node.closest('button')))
        return false;
      if(isBadge(node)||node.querySelector('[aria-haspopup]'))return false;
      if(!node.querySelector('img'))return false;
      const img=node.querySelector('img');
      return !img.closest('.poc068-source-links');
    });
    for(const [kind,items] of [['fonti',fonti],['singleton',owners]])
    for(let index=0;index<items.length;index++)
    {
      const key=ordinal+':'+kind+':'+index;
      if(state.seen.has(key))continue;
      const node=items[index];
      state.seen.add(key);
      state.target={node,ordinal,kind,index};
      return {selected:true,ordinal,kind,index,
        ariaControls:!!node.getAttribute('aria-controls'),
        tag:node.localName};
    }
  }
  state.target=null;
  return {selected:false};
}
export function browserPrepareRemainingControl(allowScroll=true)
{
  const state=globalThis.__rumiaiRemaining;
  const node=state?.target?.node;
  if(!node || !node.isConnected)return {status:'unmounted'};
  if(!state.hooks)
  {
    state.hooks={active:null};
    const https=value=>{
      if(typeof value!=='string'||value.length>4096)return null;
      try{
        const url=new URL(value,location.href);
        return url.protocol==='https:'&&!url.username&&!url.password?
          url.href:null;
      }catch{return null;}
    };
    window.open=function(url){
      const active=state.hooks.active;
      if(active){const target=https(url);if(target)active.opened.push(target);}
      return null;
    };
    if(globalThis.HTMLAnchorElement?.prototype)
      globalThis.HTMLAnchorElement.prototype.click=function(){
        const active=state.hooks.active;
        if(active){const target=https(this.href);if(target)active.anchors.push(target);}
      };
  }
  const rect=node.getBoundingClientRect();
  const x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2;
  if(!Number.isFinite(x)||!Number.isFinite(y)||
     rect.width<3||rect.height<3)return {status:'invalid-geometry'};
  if(x<0||y<0||x>=innerWidth||y>=innerHeight)
  {
    if(allowScroll&&typeof node.scrollIntoView==='function'){
      node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      return {status:'scroll-pending'};
    }
    return {status:'offscreen'};
  }
  const hit=document.elementFromPoint(x,y);
  if(!hit||(hit!==node&&!node.contains(hit)))
    return {status:'obscured'};
  const popupSelector='[role="dialog"],[role="menu"],[role="tooltip"],'+
    '[data-radix-popper-content-wrapper]';
  const visible=element=>{
    const box=element.getBoundingClientRect();
    const style=getComputedStyle(element);
    return box.width>0&&box.height>0&&style.display!=='none'&&
      style.visibility!=='hidden'&&style.opacity!=='0';
  };
  const before=[...document.querySelectorAll(popupSelector)]
    .filter(visible);
  const context=node.parentElement?.outerHTML||'';
  state.hooks.active={opened:[],anchors:[],before:new Set(before),
    controlHtml:node.outerHTML,
    contextHtml:context.length<=16384?context:null,
    contextTruncated:context.length>16384};
  return {status:'ready',x,y};
}
export function browserReadRemainingControl()
{
  const state=globalThis.__rumiaiRemaining;
  const selected=state?.target;
  const active=state?.hooks?.active;
  if(!selected||!active)return {active:false};
  state.hooks.active=null;
  const popupSelector='[role="dialog"],[role="menu"],[role="tooltip"],'+
    '[data-radix-popper-content-wrapper]';
  const visible=element=>{
    const box=element.getBoundingClientRect();
    const style=getComputedStyle(element);
    return box.width>0&&box.height>0&&style.display!=='none'&&
      style.visibility!=='hidden'&&style.opacity!=='0';
  };
  const open=[...document.querySelectorAll(popupSelector)]
    .filter(visible).filter(el=>!active.before.has(el));
  const outer=open.filter(el=>!open.some(other=>other!==el&&other.contains(el)));
  const controlledId=selected.node.getAttribute('aria-controls');
  const controlled=controlledId?document.getElementById(controlledId):null;
  const chosen=outer.length===1?outer[0]:
    controlled&&visible(controlled)?controlled:null;
  const html=chosen?.outerHTML||'';
  return {active:true,opened:active.opened,anchors:active.anchors,
    controlHtml:active.controlHtml,
    contextHtml:active.contextHtml,
    contextTruncated:active.contextTruncated,
    panelHtml:html.length<=131072?html:null,
    panelTruncated:html.length>131072,
    freshPopups:outer.length,
    panelButtons:chosen?.querySelectorAll('button').length||0,
    panelAnchors:chosen?.querySelectorAll('a[href]').length||0,
    expanded:selected.node.getAttribute('aria-expanded')==='true',
    panelObserved:!!chosen};
}
export async function probeRemainingControls(cdp,sid,record)
{
  if(!cdp.blockRequests)
  {
    cdp.blockRequests=true;
    cdp.blockedRequestEvents=[];
    try{
      await cdp.send('Fetch.enable',{
        patterns:[{urlPattern:'*',requestStage:'Request'}]},sid,7000);
    }catch{
      record({kind:'interaction.remaining-guard-unavailable'});
      return;
    }
  }
  for(let n=0;n<3;n++)
  {
    let selected;
    try{
      selected=(await cdp.send('Runtime.evaluate',{
        expression:expr(browserSelectRemainingControl),
        returnByValue:true},sid,7000)).result?.value;
    }catch{return;}
    if(!selected?.selected)return;
    let status='unavailable',result={};
    try{
      let preparation=(await cdp.send('Runtime.evaluate',{
        expression:expr(browserPrepareRemainingControl),
        returnByValue:true},sid,7000)).result?.value||{};
      if(preparation.status==='scroll-pending'){
        await pause(180);
        preparation=(await cdp.send('Runtime.evaluate',{
          expression:expr(browserPrepareRemainingControl,false),
          returnByValue:true},sid,7000)).result?.value||{};
      }
      status=preparation.status;
      if(status==='ready')
      {
        const {x,y}=preparation;
        await cdp.send('Input.dispatchMouseEvent',{
          type:'mouseMoved',x,y,button:'none',buttons:0},sid,6000);
        await cdp.send('Input.dispatchMouseEvent',{
          type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1},sid,6000);
        await cdp.send('Input.dispatchMouseEvent',{
          type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1},sid,6000);
        await pause(220);
        result=(await cdp.send('Runtime.evaluate',{
          expression:expr(browserReadRemainingControl),
          returnByValue:true},sid,7000)).result?.value||{};
        status=result.active?'dispatched':'readback-unavailable';
        // Close any popup before probing the next control. Guard stays active.
        await cdp.send('Input.dispatchKeyEvent',{
          type:'keyDown',key:'Escape',code:'Escape',
          windowsVirtualKeyCode:27},sid,4000);
        await cdp.send('Input.dispatchKeyEvent',{
          type:'keyUp',key:'Escape',code:'Escape',
          windowsVirtualKeyCode:27},sid,4000);
      }
    }catch{status='probe-failed';}
    record({kind:'interaction.remaining-control-intent',
      ordinal:selected.ordinal,controlKind:selected.kind,
      index:selected.index,controlTag:selected.tag,
      hasAriaControls:selected.ariaControls,status,...result});
  }
}
export function summarizeRemainingControls(directory)
{
  const rows=fs.readFileSync(path.join(path.resolve(directory),'events.jsonl'),
    'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const items=rows.filter(row=>row.kind==='interaction.remaining-control-intent');
  return {status:'private-safe-remaining-controls',
    guardFailures:rows.filter(row=>
      row.kind==='interaction.remaining-guard-unavailable').length,
    controls:items.map(x=>({
      ordinal:x.ordinal,kind:x.controlKind,index:x.index,
      status:x.status,opened:(x.opened||[]).length,
      anchorClicks:(x.anchors||[]).length,
      panelObserved:!!x.panelObserved,
      panelTruncated:!!x.panelTruncated,
      contextTruncated:!!x.contextTruncated,
      panelButtons:x.panelButtons||0,panelAnchors:x.panelAnchors||0,
      freshPopups:x.freshPopups||0,expanded:!!x.expanded
    })),
    limitations:[
      'Only direct intercepted window.open and programmatic anchor click intents are navigation evidence',
      'Panel markup is private; popup observation is not yet source-list ownership proof',
      'Network blocking and early popup dismissal can limit observed browser behavior',
      'No captured URL, text, original DOM or message identifiers appear in this report'
    ]};
}
if(process.argv[1]&&path.resolve(process.argv[1])===
   path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3){
    console.error('Usage: node inspect-remaining-controls.mjs <private-capture-dir>');
    process.exitCode=2;
  }else{
    try{
      console.log(JSON.stringify(summarizeRemainingControls(process.argv[2]),null,2));
    }catch{console.error('Cannot summarize private remaining controls');
      process.exitCode=1;}
  }
}
