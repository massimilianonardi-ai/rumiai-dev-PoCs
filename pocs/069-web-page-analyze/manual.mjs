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
    const manifest={kind:'passive-human-observation',frames:items.length,
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
    return manifest;
  }finally{
    if(session){
      browser.unregisterDebugSession?.(page);
      await browser.cmd('debug','session','close',session).catch(()=>{});
    }
  }
}
