#!/usr/bin/env node
// Live two-site browser experiment. Native MHTML, no HTML/CSS rewriting.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline/promises';

const root=path.dirname(fileURLToPath(import.meta.url));
const sites=[
  {name:'amazon-wishlist',url:'https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?ref_=list_d_wl_lfu_nav_3'},
  {name:'chatgpt-share',url:'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835'}
];
const exec=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const errorText=e=>String(e?.message||e).replace(/(?:https?:\/\/|file:\/\/)\S+/g,'[url]').slice(0,400);
const write=(name,data)=>fs.writeFile(name,data,{flag:'wx',mode:0o600});
const save=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');

export class Browser {
  constructor(command=process.env.WEB_CONTROL_CMD){
    if(!command||!path.isAbsolute(command))throw Error('browser.executable-not-absolute');
    this.command=command;
  }
  async cmd(...args){
    const response=await exec(this.command,args,{
      timeout:180000,maxBuffer:128*1024*1024,
      env:{...process.env,WEB_CONTROL_CONNECT_TIMEOUT_MS:'3000'}
    });
    return JSON.parse(response.stdout);
  }
  async cdp(page,method,params={}){
    return this.cmd('debug','cdp',page,method,JSON.stringify(params));
  }
  async evaluate(page,expression){
    const response=await this.cdp(page,'Runtime.evaluate',
      {expression,returnByValue:true});
    if(response.exceptionDetails)throw Error('browser.cdp-evaluation-failed');
    return response.result?.value;
  }
}

export function interpret(entries){
  // The real wheel input, rather than inferred scan direction, is primary.
  const wheel=entries.filter(e=>e.kind==='wheel');
  const source=wheel.length?wheel:entries.filter(e=>e.kind==='scroll');
  const counts=new Map();
  for(const e of source)counts.set(e.selector,(counts.get(e.selector)||0)+1);
  const selector=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(!selector)throw Error('observation.no-scroll-input');
  const selected=entries.filter(e=>
    e.kind==='disclosure'||(e.selector===selector&&
      (e.kind==='wheel'||e.kind==='scroll')));
  const initial=selected.find(e=>e.selector===selector);
  const actions=[];
  let phase=null,prev=null,lastTop=initial.top,lastMax=initial.max;
  for(const entry of selected){
    if(entry.kind==='disclosure'){
      phase=null;
      actions.push({kind:'disclosure',selector:entry.selector,
        element:entry.element,expandable:entry.expandable});
      continue;
    }
    let direction=null;
    if(entry.kind==='wheel')direction=entry.direction;
    if(!wheel.length&&entry.kind==='scroll'&&prev!==null){
      const d=entry.top-prev;
      if(Math.abs(d)>2)direction=d>0?'down':'up';
    }
    if(direction&&(!phase||phase.direction!==direction)){
      phase={kind:'scroll',direction,selector,from:lastTop,to:lastTop,
        max:lastMax,viewport:initial.viewport,samples:0};
      actions.push(phase);
    }
    if(phase){
      if(direction)phase.samples++;
      if(entry.kind==='scroll'){phase.to=entry.top;phase.max=entry.max;}
    }
    prev=entry.top;
    lastTop=entry.top;
    lastMax=entry.max;
  }
  for(const a of actions){
    if(a.kind!=='scroll')continue;
    const tolerance=Math.max(15,Math.round(initial.viewport*.05));
    a.target=a.to<=tolerance?'top':
      a.max-a.to<=tolerance?'bottom':'position';
  }
  return {selector,start:{top:initial.top,max:initial.max,
      viewport:initial.viewport},actions,
    otherContainers:[...counts.keys()].filter(x=>x!==selector),
    inference:wheel.length?'wheel-direction':'scroll-deltas'};
}

const selectorExpression=selector=>selector==='html'
  ? 'document.scrollingElement'
  : 'document.querySelector('+JSON.stringify(selector)+')';

async function geometry(browser,page,selector){
  const expression='(() => {const el='+selectorExpression(selector)+
    ';return el?{top:Math.round(el.scrollTop),max:Math.round(Math.max(0,el.scrollHeight-el.clientHeight)),'+
    'viewport:el.clientHeight}:null;})()';
  return browser.evaluate(page,expression);
}
async function scrollViewport(browser,page,selector){
  // Record the actual visible scroll container rectangle in CSS pixels so a
  // later screenshot collage can crop only content, not fixed page chrome.
  // Native MHTML and HTML are left completely untouched.
  const expression='(() => {const el='+selectorExpression(selector)+
    ';if(!el)return null;const root=el===document.scrollingElement;'+
    'const r=root?{left:0,top:0,width:innerWidth,height:innerHeight}:'+
    'el.getBoundingClientRect();'+
    'const left=root?0:r.left+el.clientLeft;'+
    'const top=root?0:r.top+el.clientTop;'+
    'const right=root?innerWidth:left+el.clientWidth;'+
    'const bottom=root?innerHeight:top+el.clientHeight;'+
    'const x=Math.max(0,left),y=Math.max(0,top);'+
    'const width=Math.max(0,Math.min(innerWidth,right)-x);'+
    'const height=Math.max(0,Math.min(innerHeight,bottom)-y);'+
    'return {x:Math.round(x),y:Math.round(y),'+
    'width:Math.round(width),height:Math.round(height),'+
    'viewportWidth:innerWidth,viewportHeight:innerHeight,'+
    'devicePixelRatio:devicePixelRatio};})()';
  return browser.evaluate(page,expression);
}
async function move(browser,page,selector,top){
  return browser.evaluate(page,'(() => {const el='+selectorExpression(selector)+
    ';if(!el)return false;el.scrollTop='+Math.round(top)+';return true;})()');
}
export async function stabilizePosition(browser,page,selector,target,{
  attempts=8,delayMs=350,tolerance=12
}={}){
  const observations=[];
  for(let attempt=1;attempt<=attempts;attempt++){
    const before=await geometry(browser,page,selector);
    if(!before)return {ok:false,reason:'container-missing',observations};
    const desired=Math.max(0,Math.min(before.max,Math.round(target)));
    // Re-apply the demonstrated starting position after application-specific
    // late auto-scroll, rather than aborting the entire capture immediately.
    if(Math.abs(before.top-desired)>tolerance){
      if(!await move(browser,page,selector,desired))
        return {ok:false,reason:'scroll-operation-failed',observations};
    }
    await sleep(delayMs);
    const after=await geometry(browser,page,selector);
    observations.push({attempt,desired,before,after});
    if(!after)return {ok:false,reason:'container-disappeared',observations};
    if(target<=before.max+tolerance &&
       Math.abs(after.top-desired)<=tolerance &&
       Math.abs(after.max-before.max)<=Math.max(30,before.viewport*.1)){
      // A second stable observation distinguishes a late SPA restoration
      // from a successfully applied, fleeting position.
      await sleep(delayMs);
      const confirmed=await geometry(browser,page,selector);
      observations.push({attempt,confirmed});
      if(confirmed&&Math.abs(confirmed.top-desired)<=tolerance)
        return {ok:true,position:confirmed,observations};
    }
  }
  return {ok:false,reason:'position-restored-or-drifted',
    position:await geometry(browser,page,selector),observations};
}
async function focus(browser,page){
  await browser.cdp(page,'Page.bringToFront');
}
const styleSummaryExpression = `(() => {
  const body=document.body||document.documentElement;
  const css=body?getComputedStyle(body):null;
  return {scheme:location.protocol, styles:document.styleSheets.length,
    stylesheetLinks:document.querySelectorAll('link[rel~="stylesheet"]').length,
    bodyFont:css?.fontFamily||null,
    bodyColor:css?.color||null,
    bodyBackground:css?.backgroundColor||null,
    imagesLoaded:[...document.images].filter(image=>
      image.complete&&image.naturalWidth>0).length,
    imageCount:document.images.length,
    textLength:body?.innerText?.length||0};
})()`;
async function screenshot(browser,page,filename){
  const r=await browser.cdp(page,'Page.captureScreenshot',
    {format:'png',fromSurface:true,captureBeyondViewport:false});
  if(!r.data)throw Error('capture.no-viewport-image');
  await write(filename,Buffer.from(r.data,'base64'));
}
async function capture(browser,page,state,selector,expectedTop){
  await fs.mkdir(state,{mode:0o700});
  // Capture the intended position before focus can trigger a SPA reaction.
  const positionBeforeFocus=await geometry(browser,page,selector);
  await focus(browser,page);
  const alignment=await stabilizePosition(browser,page,selector,expectedTop,{
    attempts:5,delayMs:220,tolerance:12
  });
  const before=await geometry(browser,page,selector);
  const cropViewport=await scrollViewport(browser,page,selector);
  const liveStyles=await browser.evaluate(page,styleSummaryExpression);
  // The reference is the visible page BEFORE archiving or changing tabs.
  await screenshot(browser,page,path.join(state,'original.png'));
  const afterScreenshot=await geometry(browser,page,selector);
  const native=await browser.cmd('page','capture',page,state,'mhtml','html');
  for(const [format,name] of [['mhtml','page.mhtml'],['html','page.html']]){
    if(path.resolve(native.files?.[format]||'')!==path.join(state,name))
      throw Error('capture.provider-path-escaped');
  }
  const snap=await browser.cdp(page,'DOMSnapshot.captureSnapshot',{
    computedStyles:['display','visibility','color','background-color',
      'font-family','font-size'],includeDOMRects:true
  });
  await save(path.join(state,'dom-snapshot.json'),snap);
  const after=await geometry(browser,page,selector);
  const original=await fs.readFile(path.join(state,'page.mhtml'),'utf8');
  const result={positionBeforeFocus,expectedTop,focusAlignment:alignment,
    liveStyles,scrollViewport:cropViewport,before,afterScreenshot,after,
    screenshotStable:!!before&&!!afterScreenshot&&
      before.top===afterScreenshot.top,
    nativeCaptureScrollDrift:!!before&&!!after&&after.top!==before.top,
    stable:!!before&&!!after&&
      before.top===after.top&&before.max===after.max,
    bytes:Buffer.byteLength(original),
    archivedCssParts:(original.match(/content-type:\s*text\/css/gi)||[]).length,
    archivedSvgParts:(original.match(/content-type:\s*image\/svg\+xml/gi)||[]).length,
    unexpectedLocalReferences:/content-location:\s*file:/i.test(original)};
  await save(path.join(state,'capture.json'),result);
  return result;
}
async function reopen(browser,state,selector,originalGeometry){
  const page=(await browser.cmd('page','new')).id;
  try{
    await browser.cmd('page','navigate',page,
      pathToFileURL(path.join(state,'page.mhtml')).href);
    await sleep(600);
    await focus(browser,page);
    // Chromium's MHTML serializes DOM/resources, NOT the live scroll offset.
    // Align the reopened viewport to the original snapshot's position before
    // comparing the images, and report selectors missing from the archive.
    let targetSelector=selector;
    let restored=await geometry(browser,page,targetSelector);
    if(!restored){
      targetSelector='html';
      restored=await geometry(browser,page,targetSelector);
    }
    if(!restored)throw Error('offline.scroll-container-not-found');
    const target=originalGeometry?.max
      ? Math.round(originalGeometry.top/originalGeometry.max*restored.max)
      : (originalGeometry?.top??0);
    const alignment=await stabilizePosition(browser,page,targetSelector,target,{
      attempts:4,delayMs:220,tolerance:12
    });
    await screenshot(browser,page,path.join(state,'reopened.png'));
    const inspected=await browser.evaluate(page,styleSummaryExpression);
    return {success:true,positionAligned:alignment.ok,
      networkIsolationVerified:false,
      originalGeometry,restoredGeometry:alignment.position||restored,
      selector:targetSelector,alignment,...inspected};
  }catch(e){return {success:false,error:errorText(e)};}
  finally{
    await browser.cmd('page','close',page).catch(()=>{});
  }
}
async function inspectState(browser,page,folder,selector,label,states){
  const index=String(states.length).padStart(4,'0');
  const state=path.join(folder,index);
  const intended=await geometry(browser,page,selector);
  if(!intended)throw Error('capture.source-container-unavailable');
  const captureResult=await capture(browser,page,state,selector,intended.top);
  const offline=await reopen(browser,state,selector,captureResult.before);
  await save(path.join(state,'offline.json'),offline);
  await focus(browser,page);
  const restored=await stabilizePosition(browser,page,selector,
    captureResult.before.top,{attempts:5,delayMs:280,tolerance:12});
  states.push({index,label,stable:captureResult.stable,
    beforeFocus:intended.top,focusPositionAligned:captureResult.focusAlignment.ok,
    screenshotStable:captureResult.screenshotStable,
    captureScrollDrift:captureResult.nativeCaptureScrollDrift,
    sourceScrollRestored:restored.ok,
    screenshotAt:captureResult.before,
    sourceAfterArchive:captureResult.after,
    cssParts:captureResult.archivedCssParts,
    unexpectedLocalReferences:captureResult.unexpectedLocalReferences,
    offline:offline.success,offlinePositionAligned:offline.positionAligned});
  process.stdout.write('  [STATO] '+index+
    ' intended='+intended.top+
    ' beforeFocus='+captureResult.positionBeforeFocus?.top+
    ' screenshotTop='+captureResult.before?.top+
    ' afterScreenshot='+captureResult.afterScreenshot?.top+
    ' afterArchive='+captureResult.after?.top+
    ' sourceRestored='+restored.ok+
    ' mhtmlAligned='+offline.positionAligned+'\n');
  if(!restored.ok)
    process.stderr.write('  [GAP] Posizione originale non ripristinata: '+index+'\n');
}
async function replay(browser,page,plan,folder){
  await fs.mkdir(folder,{mode:0o700});
  // A newly navigated ChatGPT document may mount its scrollable content
  // progressively. Compute the starting fraction only after the first
  // stable geometry window; a valid selector alone is not readiness.
  let current,lastMax=null,stableExtent=0;
  for(let i=0;i<24;i++){
    current=await geometry(browser,page,plan.selector);
    if(current){
      stableExtent=current.max===lastMax?stableExtent+1:0;
      lastMax=current.max;
      if(stableExtent>=3&&current.max>0)break;
    }
    await sleep(350);
  }
  if(!current)throw Error('replay.container-not-found');
  const atBottom=plan.start.max>0&&plan.start.max-plan.start.top<=
    Math.max(15,plan.start.viewport*.05);
  const start=atBottom?current.max:
    plan.start.max?plan.start.top/plan.start.max*current.max:plan.start.top;
  // ChatGPT restores the scroll position asynchronously after navigation.
  // Retry measured alignment instead of closing the live experiment on the
  // first deferred SPA scroll. If still unstable, continue producing labelled
  // partial evidence and never declare replay coverage complete.
  const alignment=await stabilizePosition(browser,page,plan.selector,start,{
    attempts:12,delayMs:500,tolerance:Math.max(12,Math.round(current.viewport*.04))
  });
  process.stdout.write('[ALLINEAMENTO] start='+Math.round(start)+
    ' reached='+alignment.position?.top+' stable='+alignment.ok+'\n');
  const states=[],outcomes=[],disturbances=[];
  let executionError=null;
  try {
  await inspectState(browser,page,folder,plan.selector,'observed-start',states);
  for(let i=0;i<plan.actions.length;i++){
    const action=plan.actions[i];
    if(action.kind==='disclosure'){
      let status='skipped-not-safe';
      if(action.element==='summary'||
         (action.element==='button'&&action.expandable)){
        const visible=await browser.evaluate(page,'(() => {const e=document.querySelector('+
          JSON.stringify(action.selector)+');if(!e)return false;const r=e.getBoundingClientRect();'+
          'return r.top>=0&&r.bottom<=innerHeight&&r.width>0&&r.height>0;})()');
        if(visible){
          try{
            await browser.cmd('page','click',page,action.selector);
            await sleep(500);
            await inspectState(browser,page,folder,plan.selector,
              'disclosure-'+i,states);
            status='executed';
          }catch(e){status='failed:'+errorText(e);}
        }else status='skipped-not-visible';
      }
      outcomes.push({kind:'disclosure',status});continue;
    }
    let steps=0,stable=0,complete=false,phaseError=null;
    const sign=action.direction==='down'?1:-1;
    while(steps<100){
      const before=await geometry(browser,page,plan.selector);
      if(!before)throw Error('replay.container-disappeared');
      const destination=action.target==='top'?0:
        action.target==='bottom'?before.max:
        action.max?Math.round(action.to/action.max*before.max):action.to;
      const reached=sign>0?before.top>=destination-3:
        before.top<=destination+3;
      if(reached){
        if(++stable>=3){complete=true;break;}
        await sleep(400);continue;
      }
      stable=0;
      const delta=Math.max(160,Math.floor(before.viewport*.8));
      const top=sign>0?Math.min(destination,before.top+delta):
        Math.max(destination,before.top-delta);
      await move(browser,page,plan.selector,top);
      await sleep(650);
      let after=await geometry(browser,page,plan.selector);
      if(!after)throw Error('replay.geometry-lost');
      // On dynamic pages, newly mounted/unmounted content can move
      // scrollTop *against* our requested direction. Keep the demonstrated
      // direction, measure the disturbance, and retry a bounded number of
      // directional steps. Do not count an uncorrected shift as coverage.
      let recovery=0;
      const progressed=position=>sign>0
        ? position.top>before.top+3 : position.top<before.top-3;
      if(!progressed(after)){
        const unexpected=after.top;
        while(!progressed(after)&&recovery<4){
          recovery++;
          const now=await geometry(browser,page,plan.selector);
          if(!now)throw Error('replay.container-lost-during-drift-recovery');
          const updatedEnd=action.target==='top'?0:
            action.target==='bottom'?now.max:
            action.max?Math.round(action.to/action.max*now.max):action.to;
          const retryTarget=sign>0
            ? Math.min(updatedEnd,now.top+delta)
            : Math.max(updatedEnd,now.top-delta);
          await move(browser,page,plan.selector,retryTarget);
          await sleep(650);
          after=await geometry(browser,page,plan.selector);
          if(!after)throw Error('replay.geometry-lost-during-drift-recovery');
        }
        const recovered=progressed(after);
        disturbances.push({phase:i,direction:action.direction,
          from:before.top,requested:top,unexpected,retries:recovery,
          result:after.top,recovered});
        process.stdout.write('  [DRIFT] '+action.direction+
          ' from='+before.top+' unexpected='+unexpected+
          ' recovered='+recovered+' result='+after.top+'\n');
        if(!recovered){
          phaseError='replay.directional-progress-not-restored';
          break;
        }
      }
      steps++;
      await inspectState(browser,page,folder,plan.selector,
        'phase-'+i+'-'+action.direction+'-'+steps,states);
      process.stdout.write('  '+action.direction+' '+before.top+' → '+after.top+'\n');
    }
    outcomes.push({kind:'scroll',direction:action.direction,
      target:action.target,steps,complete,error:phaseError});
    if(phaseError) break; // A failed directional phase invalidates subsequent intents.
  }
  } catch(e) {
    executionError=errorText(e);
    process.stderr.write('[GAP] Replay interrotto, checkpoint parziali conservati: '+
      executionError+'\n');
  }
  return {states,outcomes,disturbances,alignment,executionError,
    sourceExtent:plan.start.max,replayInitialExtent:current.max,
    extentSettled:stableExtent>=3,
    complete:!executionError&&alignment.ok&&outcomes.every(x=>
      x.kind==='scroll'?x.complete:x.status==='executed')};
}

async function captureOverall(browser,page,folder,states){
  // This is one native MHTML of the final, already explored live DOM.
  // It may not include earlier virtualized/discarded nodes; no merge is
  // attempted and no false claim of whole-session completeness is made.
  const overall=path.join(folder,'overall');
  await fs.mkdir(overall,{mode:0o700});
  await focus(browser,page);
  const observed=await browser.evaluate(page,
    '({title:document.title,textLength:document.body?.innerText?.length||0,'+
    'elementCount:document.querySelectorAll("*").length,'+
    'stylesheetCount:document.styleSheets.length,'+
    'imageCount:document.images.length})');
  const native=await browser.cmd('page','capture',page,overall,'mhtml');
  if(path.resolve(native.files?.mhtml||'')!==path.join(overall,'page.mhtml'))
    throw Error('overall.native-mhtml-path-escaped');
  const data=await fs.readFile(path.join(overall,'page.mhtml'),'utf8');
  const metadata={
    kind:'native-final-dom-mhtml',
    file:'overall/page.mhtml',
    sourceState:'live replay after final observed action',
    capturedCheckpoints:states.length,
    virtualizedContentMayBeAbsent:true,
    completeAcrossAllObservedStates:false,
    observed,bytes:Buffer.byteLength(data),
    cssParts:(data.match(/content-type:\s*text\/css/gi)||[]).length,
    unexpectedLocalReferences:/content-location:\s*file:/i.test(data)
  };
  await save(path.join(overall,'manifest.json'),metadata);
  return metadata;
}
async function showOverall(browser,folder,ask){
  const filename=path.join(folder,'overall','page.mhtml');
  let opened=null;
  try{
    opened=(await browser.cmd('page','new')).id;
    await browser.cmd('page','navigate',opened,pathToFileURL(filename).href);
    await focus(browser,opened);
    process.stdout.write('[MHTML] Archivio nativo dello stato finale riaperto in Chromium (rete non isolata)\n');
    await ask('Esamina l’MHTML complessivo candidato, poi premi INVIO: ');
    return {opened:true,file:'overall/page.mhtml'};
  }catch(e){
    return {opened:false,error:errorText(e),file:'overall/page.mhtml'};
  }finally{
    if(opened)await browser.cmd('page','close',opened).catch(()=>{});
  }
}
function comparison(site,states){
  const sections=states.map(x=>'<section><h2>'+x.index+' — '+x.label+
    '</h2><p>Chromium online a sinistra; MHTML originale riaperto in Chromium a destra (autosufficienza offline non verificata).</p>'+
    '<div class="pair"><img src="states/'+x.index+'/original.png">'+
    (x.offline?'<img src="states/'+x.index+'/reopened.png">':
      '<p>Riapertura non riuscita: vedi offline.json</p>')+
    '</div><p>CSS inclusi: '+x.cssParts+' — <a href="states/'+x.index+
    '/capture.json">diagnostica</a></p></section>').join('\n');
  return '<!doctype html><html lang="it"><meta charset="utf-8">'+
    '<title>'+site+' - confronti</title><style>body{font:15px system-ui;'+
    'padding:1rem;max-width:1440px;margin:auto}.pair{display:grid;'+
    'grid-template-columns:1fr 1fr;gap:12px}.pair img{width:100%;'+
    'border:1px solid #888}section{border:1px solid #aaa;'+
    'padding:1rem;margin:1rem 0}</style><h1>'+site+
    '</h1><p>Questo documento confronta screenshot, NON ricostruisce il sito.</p>'+
    sections+'</html>';
}
async function siteRun(browser,site,output,ask,observer){
  const folder=path.join(output,site.name);
  await fs.mkdir(folder,{mode:0o700});
  let page=null,replayPage=null;
  const report={site:site.name,complete:false};
  try{
    page=(await browser.cmd('page','new')).id;
    await browser.cmd('page','navigate',page,site.url);
    await sleep(1800);
    await browser.evaluate(page,observer);
    process.stdout.write('\n[OSSERVA] '+site.name+
      ': interagisci nel browser, anche dal fondo verso l’inizio.\n');
    await ask('Premi INVIO nel terminale quando hai finito: ');
    const raw=await browser.evaluate(page,
      'JSON.stringify(window.__rumiaiLiveObservation?.dump() || null)');
    const observed=JSON.parse(raw||'null');
    if(!observed)throw Error('observation.missing');
    await save(path.join(folder,'events.json'),observed);
    if(observed.overflow)throw Error('observation.overflow');
    const plan=interpret(observed.entries);
    report.plan=plan;
    await save(path.join(folder,'plan.json'),plan);
    process.stdout.write('[PIANO] '+plan.actions.map(a=>
      a.kind==='scroll'?a.direction+'→'+a.target:'disclosure').join(', ')+'\n');
    await browser.cmd('page','close',page);page=null;
    replayPage=(await browser.cmd('page','new')).id;
    await browser.cmd('page','navigate',replayPage,site.url);
    await sleep(1800);
    report.replay=await replay(browser,replayPage,plan,path.join(folder,'states'));
    // Preserve a separate native final-page archive in addition to the
    // individual chronological viewport checkpoints.
    try {
      report.overall=await captureOverall(browser,replayPage,folder,
        report.replay.states);
    }catch(e){
      report.overallError=errorText(e);
      process.stderr.write('[GAP] MHTML finale non acquisito: '+
        report.overallError+'\n');
    }
    await write(path.join(folder,'comparison.html'),
      comparison(site.name,report.replay.states));
    report.complete=report.replay.complete&&report.replay.states.every(x=>
      x.offline&&x.offlinePositionAligned&&x.sourceScrollRestored&&
      x.focusPositionAligned&&x.screenshotStable&&x.stable&&
      !x.unexpectedLocalReferences);
    // Open the comparison through Chromium itself, navigating directly to
    // the PoC-owned file URL. Do not launch a desktop file opener/portal.
    let reviewPage=null;
    try{
      reviewPage=(await browser.cmd('page','new')).id;
      await browser.cmd('page','navigate',reviewPage,
        pathToFileURL(path.join(folder,'comparison.html')).href);
      process.stdout.write('[CONFRONTO] Aperto in Chromium: '+site.name+'\n');
      await ask('Esamina gli screenshot, poi premi INVIO per continuare: ');
    }catch(e){
      report.comparisonOpenError=errorText(e);
      process.stderr.write('[CONFRONTO] Apertura locale non riuscita: '+
        report.comparisonOpenError+'\n');
    }finally{
      if(reviewPage)await browser.cmd('page','close',reviewPage).catch(()=>{});
    }
    if(report.overall)
      report.overallReview=await showOverall(browser,folder,ask);
  }catch(e){report.error=errorText(e);}
  finally{
    if(page)await browser.cmd('page','close',page).catch(()=>{});
    if(replayPage)await browser.cmd('page','close',replayPage).catch(()=>{});
    await save(path.join(folder,'report.json'),report);
  }
  process.stdout.write('[ESITO] '+site.name+' '+(report.error||
    (report.complete?'captured':'incomplete'))+'\n');
  return {site:site.name,complete:report.complete,error:report.error||null,
    actions:report.plan?.actions?.map(a=>a.direction||a.kind)||[],
    states:report.replay?.states?.length||0};
}
export async function main(args=process.argv.slice(2),browser=new Browser()){
  if(args.length!==1||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(args[0]))
    throw Error('poc.provide-one-new-run-name');
  const evidence=path.join(root,'evidence');
  await fs.mkdir(evidence,{recursive:true,mode:0o700});
  if(await fs.realpath(evidence)!==path.join(await fs.realpath(root),'evidence'))
    throw Error('poc.output-root-must-be-inside-poc');
  const output=path.join(evidence,args[0]);
  await fs.mkdir(output,{mode:0o700});
  const status=await browser.cmd('status');
  if(status.headless)throw Error('poc.visible-browser-required');
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  const results=[];
  try{
    const observer=await fs.readFile(path.join(root,'observe.js'),'utf8');
    for(const site of sites)results.push(await siteRun(browser,site,output,
      text=>terminal.question(text),observer));
  }finally{terminal.close();}
  await save(path.join(output,'summary.json'),{
    results,complete:results.every(x=>x.complete),
    visualFidelityHumanAccepted:false});
  process.stdout.write('\n[OUTPUT] '+output+'\n');
  return results.every(x=>x.complete)?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=await main().catch(e=>{
    process.stderr.write('[ERRORE] '+errorText(e)+'\n');return 1;
  });
