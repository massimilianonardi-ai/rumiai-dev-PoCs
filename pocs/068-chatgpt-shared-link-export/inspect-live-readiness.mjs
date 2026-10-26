'use strict';
// Structural read-only observation of a live shared page.
// Return only predeclared booleans/counts. Never expose document text,
// URL, title, script content, selectors from the page, or message IDs.
const MAX_COUNT=1000000;
const safeCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_COUNT?n:null;
const states=new Set(['loading','interactive','complete']);

export const liveReadinessExpression = `(() => {
  const count=selector=>document.querySelectorAll(selector).length;
  const root=document.querySelector('[data-scroll-root]');
  const body=document.body;
  const navigation=performance.getEntriesByType('navigation')[0];
  let candidates=0,visited=0;
  for(const el of document.querySelectorAll('main, [role="main"], section, div')) {
    if(++visited>200)break;
    const style=getComputedStyle(el);
    if(el.scrollHeight>el.clientHeight+32 &&
       el.clientHeight>100 && /^(auto|scroll)$/.test(style.overflowY))
      candidates++;
  }
  return {
    readyState:document.readyState,
    hasScrollRoot:!!root,
    turnWrappers:count('[data-turn-id-container]'),
    conversationMarkers:count('[data-testid^="conversation-turn-"]'),
    messageMarkers:count('[data-message-id]'),
    mainElements:count('main'),
    roleMainElements:count('[role="main"]'),
    iframeElements:count('iframe'),
    bodyChildElements:body?.children.length??0,
    bodyTextCharacters:body?.innerText.length??0,
    alternateScrollCandidates:candidates,
    navigationResponseStatus:Number.isSafeInteger(navigation?.responseStatus)?
      navigation.responseStatus:null
  };
})()`;

export function normalizedLiveShape(raw)
{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  return {
    readyState:states.has(raw.readyState)?raw.readyState:null,
    hasScrollRoot:typeof raw.hasScrollRoot==='boolean'?raw.hasScrollRoot:null,
    turnWrappers:safeCount(raw.turnWrappers),
    conversationMarkers:safeCount(raw.conversationMarkers),
    messageMarkers:safeCount(raw.messageMarkers),
    mainElements:safeCount(raw.mainElements),
    roleMainElements:safeCount(raw.roleMainElements),
    iframeElements:safeCount(raw.iframeElements),
    bodyChildElements:safeCount(raw.bodyChildElements),
    bodyTextCharacters:safeCount(raw.bodyTextCharacters),
    alternateScrollCandidates:safeCount(raw.alternateScrollCandidates),
    navigationResponseStatus:Number.isInteger(raw.navigationResponseStatus)&&
      raw.navigationResponseStatus>=0&&raw.navigationResponseStatus<=599?
      raw.navigationResponseStatus:null
  };
}
export function summarizeLiveReadiness(samples,navigation)
{
  const accepted=samples.map(normalizedLiveShape).filter(Boolean);
  const last=accepted.at(-1)||null;
  const max=(key)=>accepted.length?Math.max(...accepted.map(s=>s[key]??0)):null;
  const observedBoth=accepted.some(s=>s.hasScrollRoot===true&&s.turnWrappers>0);
  const everScroll=accepted.some(s=>s.hasScrollRoot===true);
  const everTurns=accepted.some(s=>s.turnWrappers>0);
  let classification='no-dom-evaluation';
  if(observedBoth)classification='expected-hooks-observed';
  else if(everScroll&&everTurns)classification='expected-hooks-at-different-times';
  else if(everScroll)classification='expected-turn-wrappers-not-observed';
  else if(everTurns)classification='expected-scroll-root-not-observed';
  else if(last)classification='expected-hooks-never-observed';
  return {
    status:'private-safe-live-share-readiness',
    classification,
    navigationCommand:['no-error','error','failed','not-observed'].includes(navigation)?
      navigation:'not-observed',
    validSamples:accepted.length,
    observedBoth,
    maximumObserved:{turnWrappers:max('turnWrappers'),
      conversationMarkers:max('conversationMarkers'),
      messageMarkers:max('messageMarkers')},
    initialShape:accepted[0]||null,
    finalShape:last,
    limitations:[
      'DOM shapes and browser navigation command status do not prove share validity, authorization or RAW completeness',
      'Browser response status may be null or 0 and is not substituted with inferred HTTP status',
      'A missing target selector can mean delayed loading, alternate DOM layout or inaccessible page',
      'No conversation text, addresses, titles, identifiers or request URLs are returned'
    ]
  };
}
