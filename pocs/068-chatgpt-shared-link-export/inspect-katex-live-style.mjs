'use strict';
// One controlled CDP session samples computed math CSS on the live shared
// page and later on an already-produced local offline page. No mathematical
// text, markup, URLs or message identifiers are returned to the operator.
const names=['fontSize','fontFamily','fontWeight','lineHeight','verticalAlign',
  'position','display','top','bottom','transform','borderTopWidth',
  'borderBottomWidth','borderLeftWidth','borderRightWidth'];
function takeFormula(root)
{
  const origin=root.getBoundingClientRect();
  const round=x=>Math.round(x*100)/100;
  return [root,...root.querySelectorAll('*')].map(el=>{
    const style=getComputedStyle(el);
    const rect=el.getBoundingClientRect();
    return {tag:el.localName,
      s:names.map(name=>style[name]||''),
      g:[round(rect.x-origin.x),round(rect.y-origin.y),
        round(rect.width),round(rect.height)]};
  });
}
export function browserKatexMetrics()
{
  const source=[...document.querySelectorAll('[data-testid^="conversation-turn-"]')]
    .filter(node=>/^conversation-turn-\d+$/.test(node.getAttribute('data-testid')||''))
    .map(node=>({node,ordinal:Number(node.getAttribute('data-testid').slice(18))}));
  const offline=[...document.querySelectorAll('article.turn')]
    .map(node=>({node,ordinal:Number(node.querySelector('h2')?.textContent?.match(/\d+/)?.[0])}));
  const turns=offline.length?offline:source;
  // Native CDP probes may revisit the same mounted turn dozens of times.
  // Measuring thousands of descendants' computed CSS on every scroll step
  // can stall Chromium for minutes. Each document has its own cache; repeat
  // only if more formulas mount or a previously loading font settles.
  const previous=globalThis.__rumiaiMathObserved || new Map();
  globalThis.__rumiaiMathObserved=previous;
  const observed=[];
  let loaded=0,loading=0,faceCount=0;
  if(document.fonts)
    for(const face of document.fonts)
    {
      if(!face.family?.includes('KaTeX'))continue;
      faceCount++;
      if(face.status==='loaded')loaded++;
      if(face.status==='loading')loading++;
    }
  const fontsReady=document.fonts?.status==='loaded' && loading===0;
  for (const {node,ordinal} of turns)
  {
    if(!Number.isSafeInteger(ordinal)||ordinal<1||ordinal>10000)continue;
    const roots=[...node.querySelectorAll('.katex')]
      .filter(el=>el.classList.contains('katex') && !el.parentElement?.closest('.katex'));
    if(!roots.length)continue;
    const old=previous.get(ordinal);
    if(old && old.formulas>=roots.length &&
        old.loaded>=loaded && old.fontsReady && fontsReady)continue;
    observed.push({ordinal,math:roots.map(takeFormula)});
    previous.set(ordinal,{formulas:roots.length,loaded,fontsReady});
  }
  return {turns:observed,fontFaces:{known:faceCount,loaded,loading}};
}
export function browserKatexExpression()
{
  return '(() => {const names='+JSON.stringify(names)+';'+
    takeFormula.toString()+'; return ('+browserKatexMetrics.toString()+')();})()';
}
function aggregateMap(into,key)
{
  into[key]=(into[key]||0)+1;
}
export function compareLiveAndOfflineMath(source,offline)
{
  const live=new Map(source.turns.map(t=>[t.ordinal,t]));
  const exported=new Map(offline.turns.map(t=>[t.ordinal,t]));
  const properties={};
  const perTurn=[],seen=new Set();
  let compared=0,comparedNodes=0,geometryChanged=0,maxPixelDelta=0,
    rootCountMismatches=0,tagMismatches=0;
  for(const [ordinal,off] of exported)
  {
    const real=live.get(ordinal);
    if(!real){perTurn.push({ordinal,sourceObserved:false,offlineRoots:off.math.length});continue;}
    seen.add(ordinal);
    const row={ordinal,sourceObserved:true,liveRoots:real.math.length,
      offlineRoots:off.math.length,comparedRoots:0,nodeGeometryChanges:0,
      computedStyleChanges:{},maximumPixelDelta:0};
    if(real.math.length!==off.math.length)rootCountMismatches++;
    for(let i=0;i<Math.min(real.math.length,off.math.length);i++)
    {
      row.comparedRoots++;compared++;
      const x=real.math[i],y=off.math[i];
      for(let j=0;j<Math.min(x.length,y.length);j++)
      {
        comparedNodes++;
        if(x[j].tag!==y[j].tag){tagMismatches++;continue;}
        for(let k=0;k<names.length;k++)
          if(x[j].s[k]!==y[j].s[k])
          {aggregateMap(properties,names[k]);aggregateMap(row.computedStyleChanges,names[k]);}
        let changed=false;
        for(let k=0;k<4;k++)
        {
          const delta=Math.abs(x[j].g[k]-y[j].g[k]);
          if(delta>0.75)changed=true;
          maxPixelDelta=Math.max(maxPixelDelta,delta);
          row.maximumPixelDelta=Math.max(row.maximumPixelDelta,delta);
        }
        if(changed){geometryChanged++;row.nodeGeometryChanges++;}
      }
    }
    perTurn.push(row);
  }
  const sourceOnly=[...live.keys()].filter(id=>!seen.has(id));
  return {status:'real-live-vs-offline-katex-computed-css',
    source:{mathBearingTurns:live.size,
      formulaRoots:[...live.values()].reduce((n,t)=>n+t.math.length,0),
      ...source.fontFaces},
    offline:{mathBearingTurns:exported.size,
      formulaRoots:[...exported.values()].reduce((n,t)=>n+t.math.length,0),
      ...offline.fontFaces},
    comparison:{pairedRoots:compared,comparedNodes,rootCountMismatches,
      tagMismatches,changedGeometryNodes:geometryChanged,
      maximumPixelDelta:Math.round(maxPixelDelta*100)/100,
      stylePropertyDifferences:properties,
      sourceOnlyOrdinals:sourceOnly,perTurn},
    limitations:[
      'Live source styles are measured in a new Chromium visit and can differ from historical snapshot time',
      'Ordinal/within-turn ordering is compared only where the same formulas were observed in both pages',
      'Counts and property names do not reveal formula text or font files and are not an assertion of visual acceptance',
      'This is read-only diagnosis, not a new or modified offline export'
    ]};
}
