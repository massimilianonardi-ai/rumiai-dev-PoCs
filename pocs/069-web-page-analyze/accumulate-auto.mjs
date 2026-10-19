// Navigate the already-open shared page without resetting its start position.
// The existing pre-navigation observer owns turn retention.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function observableAdvance(before,after)
{
  const a=before?.probe||{},b=after?.probe||{};
  const changed=key=>Number.isFinite(a[key])&&Number.isFinite(b[key])&&
    a[key]!==b[key];
  const prior=a.pointer?.chain||[],current=b.pointer?.chain||[];
  const scrollMovement=prior.some((item,index)=>
    current[index]&&item.tag===current[index].tag&&item.top!==current[index].top);
  const observation=
  {
    newIdentities:Number(b.distinct||0)>Number(a.distinct||0),
    viewportMoved:before?.visual!==after?.visual||
      before?.geometry!==after?.geometry||
      changed('windowY')||changed('rootY')||scrollMovement,
    endVerified:false
  };
  return observation;
}

async function advance(source,mode,probe)
{
  if(mode==='keyboard')
  {
    await source.keyboard.press('PageDown');
  }
  else if(mode==='wheel')
  {
    const x=probe.pointer?.x??Math.floor(1440*.55);
    const y=probe.pointer?.y??Math.floor(1000*.5);
    await source.mouse.move(x,y);
    await source.mouse.wheel(0,480);
  }
  else
  {
    // Resolve the actual scrolling ancestor through Chromium rather than
    // assuming that the document root owns this virtualized list.
    await source.evaluate
    (
      ()=>
      {
        const turns=[...document.querySelectorAll(
          '[data-testid^="conversation-turn"],[data-message-id]')];
        const last=turns.at(-1);
        if(last)last.scrollIntoView({block:'end',inline:'nearest',behavior:'instant'});
      }
    );
  }
}

export async function traverseAutomatically
(
  {source,sample,flush,onStep,maxSteps=650,idleLimit=5,pauseMs=350}
)
{
  const modes=['keyboard','wheel','last-turn'];
  let modeIndex=0,idle=0,steps=0,newIdentitySteps=0,moveSteps=0;
  await source.bringToFront();
  await source.evaluate(()=>document.activeElement?.blur());
  let previous=await sample();
  for(let step=0;step<maxSteps;step++)
  {
    const mode=modes[modeIndex];
    await advance(source,mode,previous.probe);
    await pause(pauseMs);
    await flush();
    const current=await sample();
    const movement=observableAdvance(previous,current);
    if(movement.newIdentities)newIdentitySteps++;
    if(movement.viewportMoved)moveSteps++;
    idle=movement.newIdentities||movement.viewportMoved?0:idle+1;
    steps=step+1;
    const evidence=
    {
      step:steps,mode,progress:movement,
      retained:current.probe.distinct,
      idle,probe:current.probe
    };
    await onStep(evidence);
    previous=current;
    if(idle>=idleLimit)
    {
      modeIndex++;
      idle=0;
      if(modeIndex===modes.length)break;
    }
  }
  const report=
  {
    steps,newIdentitySteps,moveSteps,
    stopReason:modeIndex===modes.length?
      'automatic-navigation-stalled':'automatic-step-budget',
    endVerified:false,
    finalProbe:previous.probe
  };
  return report;
}
