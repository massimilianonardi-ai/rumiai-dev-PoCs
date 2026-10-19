#!/usr/bin/env node
// Read-only, privacy-minimized diagnostics of an EXISTING PoC 069 run.
// Deliberately does not read images, DOM snapshots, HTML, MHTML or prompt text.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const sites=['amazon-wishlist','chatgpt-share'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);

export function classifyCheckpoint(capture,offline,sourceSelector) {
  if(!capture||!offline)return 'missing-diagnostics';
  if(offline.success===false)return 'reopen-failed';
  if(!offline.success)return 'missing-diagnostics';
  if(sourceSelector && offline.selector && offline.selector!==sourceSelector)
    return 'different-scroll-container';
  if(capture.screenshotStable===false || capture.stable===false)
    return 'source-not-stable';
  const shift=offline.finalContentShift;
  if(shift?.reason==='content-reflow')return 'content-reflow';
  if(offline.contentAligned===true && shift?.usable &&
     Math.abs(shift.shift)<=2)return 'content-aligned';
  if(shift?.usable && finite(shift.shift) && Math.abs(shift.shift)>2)
    return 'content-displaced';
  if(offline.scrollMapping?.clamped ||
     offline.positionAligned===false)return 'scroll-position-incomplete';
  return 'content-unverified';
}

export function summarizeEvidence(report,records) {
  const counts={};
  const flags=[];
  const signals={sourceUnstable:0,reflow:0,selectorFallback:0,
    textUnverified:0,contentDisplaced:0,positionUnreachable:0};
  const selector=report?.plan?.selector||null;
  const processed=records.map(record=>{
    const category=classifyCheckpoint(record.capture,record.offline,selector);
    counts[category]=(counts[category]||0)+1;
    const c=record.capture||{},o=record.offline||{};
    const shift=o.finalContentShift||{};
    if(c.stable===false||c.screenshotStable===false)signals.sourceUnstable++;
    if(shift.reason==='content-reflow')signals.reflow++;
    if(selector&&o.selector&&o.selector!==selector)signals.selectorFallback++;
    if(!shift.usable)signals.textUnverified++;
    if(shift.usable&&finite(shift.shift)&&Math.abs(shift.shift)>2)
      signals.contentDisplaced++;
    if(o.scrollMapping?.clamped||o.positionAligned===false)
      signals.positionUnreachable++;
    return {id:record.id,category,
      originalTop:finite(c.before?.top)?c.before.top:null,
      originalMax:finite(c.before?.max)?c.before.max:null,
      reopenedTop:finite(o.restoredGeometry?.top)?o.restoredGeometry.top:null,
      shift:finite(shift.shift)?Math.round(shift.shift):null,
      spread:finite(shift.spread)?Math.round(shift.spread):null,
      anchors:finite(shift.matches)?shift.matches:null,
      archiveMax:finite(o.restoredGeometry?.max)?o.restoredGeometry.max:null,
      sourceStable:c.stable===true&&c.screenshotStable===true,
      positionAligned:o.positionAligned===true,
      contentAligned:o.contentAligned===true,
      scrollContainerMatches:selector&&o.selector?selector===o.selector:null,
      reason:shift.reason||null};
  });
  const minTop=processed.map(x=>x.originalTop).filter(finite);
  const firstProblems=processed.filter(x=>x.category!=='content-aligned').slice(0,6);
  const replay=report?.replay||{};
  const top=report?.topCoverage||{};
  if(top.replayTopCaptured!==true)flags.push('replay-start-not-confirmed');
  if(report?.messageCoverage?.status==='missing-observed-messages')
    flags.push('manual-messages-absent-from-replay');
  if(replay.executionError)flags.push('replay-interrupted');
  if((replay.disturbances||[]).some(x=>x.recovered===false))
    flags.push('unrecovered-virtualized-scroll-jumps');
  if((replay.activityWaits||[]).some(x=>x.settled===false))
    flags.push('unsettled-capture');
  if(signals.reflow)flags.push('mhtml-content-reflow');
  if(signals.selectorFallback)flags.push('mhtml-selector-fallback');
  if(signals.sourceUnstable)flags.push('source-changes-during-capture');
  if(signals.textUnverified)flags.push('mhtml-text-not-verifiable');
  if(signals.contentDisplaced)flags.push('mhtml-text-offset-remains');
  if(signals.positionUnreachable)flags.push('mhtml-position-unreachable');
  return {site:report?.site||null,states:processed.length,
    counts,signals,flags,
    replayComplete:replay.complete===true,
    replayError:replay.executionError||null,
    minimumSourceScreenshotTop:minTop.length?Math.min(...minTop):null,
    topCoverage:{manualObserved:top.manualTopObserved===true,
      manualCaptured:top.manualTopCaptured===true,
      replayCaptured:top.replayTopCaptured===true},
    manualVsReplayMessages:{
      status:report?.messageCoverage?.status||'unavailable',
      missingUser:report?.messageCoverage?.missingCounts?.user??null,
      missingAssistant:report?.messageCoverage?.missingCounts?.assistant??null
    },
    firstProblems};
}
async function jsonIfPresent(base,filename) {
  try{
    const location=await fs.realpath(path.join(base,filename));
    if(!location.startsWith(base+path.sep))throw Error('diagnose.path-outside-run');
    return JSON.parse(await fs.readFile(location,'utf8'));
  }catch(e){
    if(e.code==='ENOENT')return null;
    throw e;
  }
}
export async function diagnoseRun(run) {
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(run))
    throw Error('diagnose.invalid-run-name');
  const evidence=path.join(root,'evidence');
  const actual=await fs.realpath(evidence);
  if(actual!==path.join(await fs.realpath(root),'evidence'))
    throw Error('diagnose.evidence-root-escaped');
  const directory=path.join(actual,run);
  if(await fs.realpath(directory)!==directory)
    throw Error('diagnose.run-symlink-not-allowed');
  const results=[];
  for(const site of sites) {
    const sub=path.join(directory,site);
    if(await fs.realpath(sub)!==sub)
      throw Error('diagnose.site-symlink-not-allowed');
    const report=await jsonIfPresent(sub,'report.json');
    const states=path.join(sub,'states');
    let names=[];
    try{
      if(await fs.realpath(states)!==states)
        throw Error('diagnose.states-symlink-not-allowed');
      names=(await fs.readdir(states,{withFileTypes:true}))
        .filter(x=>x.isDirectory()&&/^[0-9]{4,6}$/.test(x.name))
        .map(x=>x.name).sort();
    }catch(e){if(e.code!=='ENOENT')throw e;}
    const records=[];
    for(const id of names) {
      const state=path.join(states,id);
      if(await fs.realpath(state)!==state)
        throw Error('diagnose.state-symlink-not-allowed');
      const [capture,offline]=await Promise.all([
        jsonIfPresent(state,'capture.json'),
        jsonIfPresent(state,'offline.json')]);
      records.push({id,capture,offline});
    }
    results.push(summarizeEvidence(report||{site},records));
  }
  return results;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  diagnoseRun(process.argv[2]).then(items=>{
    for(const item of items)
      process.stdout.write('[DIAGNOSE] '+JSON.stringify(item)+'\n');
  }).catch(e=>{process.stderr.write('[ERRORE] '+e.message+'\n');
    process.exitCode=1;});
}
