// Passive human-phase evidence. No focus changes, scroll assignments, or MHTML
// reconstruction. Raw screenshots stay inside gitignored PoC evidence.
import fs from 'node:fs/promises';
import path from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class NetworkActivity {
  constructor(){
    this.pending=new Map();
    this.started=0;
    this.finished=0;
    this.failed=0;
    this.sequence=0;
    this.overflow=false;
    this.lastChange=0;
  }
  consume(events,now){
    for(const event of events){
      if(!Number.isInteger(event.sequence)||event.sequence<=this.sequence)
        throw Error('manual.network-events-not-monotonic');
      this.sequence=event.sequence;
      const id=event.params?.requestId;
      const type=event.method;
      if(type==='Network.requestWillBeSent'&&id){
        this.started++;
        if(event.params?.type!=='EventSource' &&
           event.params?.type!=='WebSocket')
          this.pending.set(id,event.params?.type||'unknown');
        this.lastChange=now;
      }else if(type==='Network.loadingFinished'&&id){
        this.finished++;
        this.pending.delete(id);
        this.lastChange=now;
      }else if(type==='Network.loadingFailed'&&id){
        this.failed++;
        this.pending.delete(id);
        this.lastChange=now;
      }
    }
  }
  summary(){
    return {pending:this.pending.size,started:this.started,
      finished:this.finished,failed:this.failed,
      sequence:this.sequence,overflow:this.overflow};
  }
}
// Presence is measured only in actually sampled manual/replay DOM states.
// An undetected site-specific role selector is unknown, not proof of absence.
export function compareMessageCoverage(manual,replayStates){
  const observed=manual?.messageSignatures;
  const fromManual={
    user:new Set(observed?.user||[]),
    assistant:new Set(observed?.assistant||[])
  };
  const fromReplay={user:new Set(),assistant:new Set()};
  for(const state of replayStates||[]){
    for(const item of state.messageInventory||[]){
      if((item.role==='user'||item.role==='assistant')&&
         typeof item.signature==='string')
        fromReplay[item.role].add(item.signature);
    }
  }
  const missing={
    user:[...fromManual.user].filter(x=>!fromReplay.user.has(x)),
    assistant:[...fromManual.assistant].filter(x=>!fromReplay.assistant.has(x))
  };
  const roleFound=fromManual.user.size+fromManual.assistant.size;
  const status=roleFound===0?'manual-role-unverified':
    missing.user.length||missing.assistant.length?'missing-observed-messages':
    'matching-observed-samples';
  return {status,manualCounts:{user:fromManual.user.size,
      assistant:fromManual.assistant.size},
    replayCounts:{user:fromReplay.user.size,
      assistant:fromReplay.assistant.size},
    missingCounts:{user:missing.user.length,assistant:missing.assistant.length},
    missingSignatures:missing,
    // A match only covers sampled items and cannot certify an entire chat.
    entireConversationVerified:false};
}
export function shouldSampleCapture({initial=false,changed=false,
  quietFor=0,sinceCapture=0,networkPending=0,final=false}){
  if(initial||final)return {capture:true,settled:false,reason:
    initial?'initial':'final'};
  if(!changed||sinceCapture<600)return {capture:false};
  if(quietFor>=600&&networkPending===0)
    return {capture:true,settled:true,reason:'observed-quiescence'};
  if(sinceCapture>=1800)
    return {capture:true,settled:false,reason:'active-progress'};
  return {capture:false};
}
// Replay readiness is bounded and evidence-based: a stable DOM/layout window,
// not the unsupported claim that a SPA can never start loading again.
export async function waitForObservedStability(browser,page,
  {quietMs=650,timeoutMs=5000,pollMs=250}={}){
  const start=Date.now();
  let changesAt=start,lastKey=null,observations=0,last=null;
  while(Date.now()-start<timeoutMs){
    const sample=await browser.evaluate(page,
      'window.__rumiaiLiveObservation.sample()');
    if(!sample)return {settled:false,reason:'observer-unavailable',
      observations};
    observations++;
    last=sample;
    const key=stateKey(sample);
    if(key!==lastKey){lastKey=key;changesAt=Date.now();}
    if(observations>=2&&Date.now()-changesAt>=quietMs&&
       sample.incompleteImages===0&&sample.fontStatus!=='loading'){
      return {settled:true,reason:'dom-and-resources-quiet',
        observations,elapsedMs:Date.now()-start,
        networkQuiescenceVerified:false,
        scroll:sample.scroll};
    }
    await sleep(pollMs);
  }
  return {settled:false,reason:'dom-stability-timeout',
    observations,elapsedMs:Date.now()-start,
    networkQuiescenceVerified:false,
    scroll:last?.scroll||null};
}
function stateKey(sample){
  const geometry=sample.scroll||{};
  const identities=(sample.messages||[]).map(m=>
    m.role+':'+m.signature+':'+m.visible).join('|');
  return [geometry.selector,geometry.top,geometry.max,
    sample.mutationRevision,sample.eventCount,sample.resourceCount,
    sample.incompleteImages,sample.fontStatus,identities].join(':');
}
async function pollNetwork(browser,session,network,now){
  if(!session)return;
  // The provider buffer is bounded. Never silently ignore a dropped event.
  const packet=await browser.cmd('debug','session','events',session,
    String(network.sequence),'128','0');
  network.consume(packet.events||[],now);
}
async function record(browser,page,folder,index,sample,network,reason,settled){
  const id=String(index).padStart(4,'0');
  const image=await browser.cdp(page,'Page.captureScreenshot',
    {format:'png',fromSurface:true,captureBeyondViewport:false});
  if(!image.data)throw Error('manual.screenshot-missing');
  await fs.writeFile(path.join(folder,id+'.png'),
    Buffer.from(image.data,'base64'),{flag:'wx',mode:0o600});
  const after=await browser.evaluate(page,
    'window.__rumiaiLiveObservation.sample()');
  const result={id,reason,settled,
    capturedAt:new Date().toISOString(),
    scrollBefore:sample.scroll,scrollAfter:after.scroll,
    roleDetection:sample.roleDetection,
    roles:sample.roles,messages:sample.messages,
    network:network.summary(),
    screenshotStable:sample.scroll?.top===after.scroll?.top&&
      sample.mutationRevision===after.mutationRevision};
  await fs.writeFile(path.join(folder,id+'.json'),
    JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}
export async function observeManual(browser,page,folder,ask,
  {pollMs=350,maxFrames=240}={}){
  await fs.mkdir(folder,{mode:0o700});
  const network=new NetworkActivity();
  const items=[],warnings=[];
  const observedSignatures={user:new Set(),assistant:new Set()};
  let minimumObservedTop=null;
  let session=null,terminalDone=false,terminalError=null;
  let lastCaptureAt=0,lastStateKey=null,lastChange=Date.now();
  let lastRecordedKey=null;
  try{
    try{
      const opened=await browser.cmd('debug','session','open',page);
      session=opened.session;
      if(!session)throw Error('manual.debug-session-id-missing');
      browser.registerDebugSession?.(page,session);
      await browser.cdp(page,'Network.enable',{});
    }catch(error){
      warnings.push('network-observation-unavailable');
      if(session){
        browser.unregisterDebugSession?.(page);
        await browser.cmd('debug','session','close',session).catch(()=>{});
      }
      session=null;
    }
    // Preserve the initial visible page before asking the user to scroll.
    const baseline=await browser.evaluate(page,
      'window.__rumiaiLiveObservation.sample()');
    if(!baseline)throw Error('manual.initial-sample-missing');
    for(const item of baseline.messages||[]){
      if((item.role==='user'||item.role==='assistant')&&
         typeof item.signature==='string')
        observedSignatures[item.role].add(item.signature);
    }
    if(baseline.scroll?.max>0&&Number.isFinite(baseline.scroll.top))
      minimumObservedTop=baseline.scroll.top;
    const first=await record(browser,page,folder,0,
      baseline,network,'initial',false);
    items.push(first);
    lastCaptureAt=Date.now();
    lastRecordedKey=stateKey(baseline);
    lastStateKey=lastRecordedKey;
    lastChange=Date.now();
    process.stdout.write('[MANUALE] 0000 scroll='+
      String(baseline.scroll?.top??'?')+' initial\n');
    const askTask=Promise.resolve().then(()=>ask(
      'Scorri normalmente, poi premi INVIO nel terminale quando hai finito: '
    )).then(()=>{terminalDone=true;},e=>{
      terminalError=e;terminalDone=true;
    });
    let lastSample=null,exited=false;
    for(let polls=0;polls<36000;polls++){
      const now=Date.now();
      if(session){
        try{await pollNetwork(browser,session,network,now);}
        catch(e){
          network.overflow=true;
          warnings.push('network-events-lost-or-session-error');
          browser.unregisterDebugSession?.(page);
          await browser.cmd('debug','session','close',session).catch(()=>{});
          session=null;
        }
      }
      const sample=await browser.evaluate(page,
        'window.__rumiaiLiveObservation.sample()');
      if(!sample)throw Error('manual.observer-sample-missing');
      lastSample=sample;
      if(sample.scroll?.max>0&&Number.isFinite(sample.scroll.top))
        minimumObservedTop=minimumObservedTop===null
          ?sample.scroll.top:Math.min(minimumObservedTop,sample.scroll.top);
      for(const item of sample.messages||[]){
        if((item.role==='user'||item.role==='assistant')&&
           typeof item.signature==='string')
          observedSignatures[item.role].add(item.signature);
      }
      const key=stateKey(sample);
      if(lastStateKey!==key||network.lastChange===now)
        lastChange=now;
      lastStateKey=key;
      const decision=shouldSampleCapture({
        initial:items.length===0,
        changed:key!==lastRecordedKey,
        quietFor:now-lastChange,
        sinceCapture:now-lastCaptureAt,
        networkPending:network.pending.size,
        final:terminalDone&&key!==lastRecordedKey
      });
      if(decision.capture&&items.length<maxFrames){
        const recordAt=Date.now();
        const evidence=await record(browser,page,folder,items.length,
          sample,network,decision.reason,decision.settled);
        items.push(evidence);
        lastCaptureAt=recordAt;
        lastRecordedKey=key;
        process.stdout.write('[MANUALE] '+evidence.id+
          ' scroll='+String(sample.scroll?.top??'?')+
          ' user='+sample.roles?.user+
          ' assistant='+sample.roles?.assistant+
          ' '+decision.reason+'\n');
      }else if(items.length===maxFrames&&!warnings.includes('frame-limit')){
        warnings.push('frame-limit');
      }
      if(terminalDone){
        if(!exited){
          // Give pending DOM mutations/network activity a bounded final check.
          exited=true;
          if(Date.now()-lastChange<650){await sleep(650);continue;}
        }
        break;
      }
      await sleep(pollMs);
    }
    await askTask;
    if(terminalError)throw terminalError;
    const messageSignatures={user:new Set(),assistant:new Set()};
    for(const frame of items){
      for(const entry of frame.messages||[]){
        if((entry.role==='user'||entry.role==='assistant')&&
           typeof entry.signature==='string')
          messageSignatures[entry.role].add(entry.signature);
      }
    }
    const capturedTops=items.map(x=>x.scrollBefore)
      .filter(x=>x?.max>0&&Number.isFinite(x.top));
    const minimumCapturedTop=capturedTops.length
      ?Math.min(...capturedTops.map(x=>x.top)):null;
    const manifest={kind:'passive-human-observation',frames:items.length,
      minimumObservedTop,minimumCapturedTop,
      topObserved:minimumObservedTop!==null&&minimumObservedTop<=3,
      topCaptured:minimumCapturedTop!==null&&minimumCapturedTop<=3,
      messageSignatures:{
        user:[...observedSignatures.user],
        assistant:[...observedSignatures.assistant]
      },
      screenshotSignatures:{
        user:[...messageSignatures.user],
        assistant:[...messageSignatures.assistant]
      },
      roleDetection:'data-message-author-role',
      frameIds:items.map(x=>x.id),warnings,
      network:network.summary(),
      incompleteByDesign:network.overflow||warnings.length>0,
      independentFromReplay:true};
    await fs.writeFile(path.join(folder,'manifest.json'),
      JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    const html='<!doctype html><html lang="it"><meta charset="utf-8">'+
      '<title>Osservazione manuale</title><style>body{font:15px system-ui;'+
      'max-width:1150px;margin:1.5rem auto;padding:0 1rem}img{max-width:100%;'+
      'border:1px solid #999}section{padding:1rem 0;border-top:1px solid #aaa}'+
      '</style><h1>Screenshot originali della navigazione manuale</h1>'+
      '<p>Immagini catturate prima del replay. I campioni non garantiscono '+
      'la copertura di ogni singolo frame o messaggio.</p>'+
      items.map(item=>'<section><h2>Checkpoint '+item.id+'</h2>'+
        '<p>Scroll '+String(item.scrollBefore?.top??'?')+
        ' · user '+String(item.roles?.user??'?')+
        ' · assistant '+String(item.roles?.assistant??'?')+
        ' · '+item.reason+(item.settled?' (stabile)':' (provvisorio)')+
        '</p><img loading="lazy" alt="Screenshot manuale '+item.id+'" '+
        'src="./'+item.id+'.png"><p><a href="./'+item.id+
        '.json">Diagnostica</a></p></section>').join('')+'</html>';
    await fs.writeFile(path.join(folder,'manual.html'),html,
      {flag:'wx',mode:0o600});
    return manifest;
  }finally{
    if(session){
      browser.unregisterDebugSession?.(page);
      await browser.cmd('debug','session','close',session).catch(()=>{});
    }
  }
}
