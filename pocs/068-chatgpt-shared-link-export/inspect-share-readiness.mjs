'use strict';
// Read-only, privacy-safe readiness audit for an existing native-CDP capture.
// Never output page text, HTML, arbitrary event data, URLs, IDs or credentials.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const wantedKinds=[
  'probe.installed','navigation.result','navigation.command-failed',
  'session.ready','session.error','sweep.started','sweep.finished',
  'sweep.not-ready','sweep.timeout','sweep.command-failed',
  'turn.initial','turn.snapshot','turn.unidentified-snapshot',
  'scroll.actual','network.image-response','network.image-body'
];
const safeCount=value=>Number.isSafeInteger(value) && value>=0 &&
  value<=1000000?value:null;
function shapeOf(raw)
{
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return null;
  return {
    readyState:['loading','interactive','complete'].includes(raw.readyState)?
      raw.readyState:null,
    hasScrollRoot:typeof raw.hasScrollRoot==='boolean'?
      raw.hasScrollRoot:null,
    turnWrappers:safeCount(raw.turnWrappers),
    conversationMarkers:safeCount(raw.conversationMarkers),
    mainElements:safeCount(raw.mainElements)
  };
}
function observedState(notReady,shape)
{
  if(!notReady)return 'no-readiness-failure-recorded';
  if(!shape)return 'readiness-failure-without-page-shape';
  if(shape.hasScrollRoot===false && shape.turnWrappers===0)
    return 'scroll-root-and-turn-containers-not-observed';
  if(shape.hasScrollRoot===false && shape.turnWrappers>0)
    return 'expected-scroll-root-not-observed';
  if(shape.hasScrollRoot===true && shape.turnWrappers===0)
    return 'expected-turn-containers-not-observed';
  if(shape.hasScrollRoot===true && shape.turnWrappers>0)
    return 'both-dom-hooks-present-in-final-observation';
  return 'readiness-failure-with-incomplete-page-shape';
}
export function inspectShareReadiness(captureDir)
{
  const file=path.join(path.resolve(captureDir),'events.jsonl');
  const stat=fs.statSync(file);
  if(!stat.isFile() || stat.size<=0 || stat.size>64*1024*1024)
    throw Error('Invalid private capture event file');
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean);
  if(lines.length>100000)throw Error('Private capture event limit exceeded');
  const counts=Object.fromEntries(wantedKinds.map(k=>[k,0]));
  let lastShape=null,notReady=false,lastNavigation=null;
  for(const line of lines)
  {
    const e=JSON.parse(line);
    if(!e || typeof e!=='object')throw Error('Invalid capture event');
    if(Object.hasOwn(counts,e.kind))counts[e.kind]++;
    if(e.kind==='sweep.not-ready')
    {
      notReady=true;
      const shape=shapeOf(e.pageShape);
      if(shape)lastShape=shape;
    }
    if(e.kind==='navigation.result')
      lastNavigation=e.error===null?'navigation-command-reported-no-error':
        'navigation-command-reported-error';
    if(e.kind==='navigation.command-failed')
      lastNavigation='navigation-command-failed';
  }
  const known={};
  for(const [key,n] of Object.entries(counts))
    if(n>0)known[key]=n;
  return {
    status:'private-safe-existing-share-readiness',
    examinedEvents:lines.length,
    eventCounts:known,
    lastNavigationObservation:lastNavigation || 'not-recorded',
    finalNotReadyPageShape:lastShape,
    observedReadiness:observedState(notReady,lastShape),
    evidenceLimitations:[
      'Only previously recorded events are inspected; no browser navigation or file modifications',
      'A missing expected DOM hook does not prove a share is inaccessible, expired or invalid',
      'The original private capture may predate pageShape instrumentation',
      'No conversation text, URL, ID, signed token or raw HTML is included'
    ]
  };
}
if(process.argv[1] && path.resolve(process.argv[1])===
    fileURLToPath(import.meta.url))
{
  if(process.argv.length!==3)
  {
    console.error('Usage: node inspect-share-readiness.mjs <existing-private-capture-dir>');
    process.exitCode=2;
  }
  else
  {
    try {console.log(JSON.stringify(inspectShareReadiness(process.argv[2]),null,2));}
    catch {console.error('Unable to inspect private capture events');process.exitCode=1;}
  }
}
