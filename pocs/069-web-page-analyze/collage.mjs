// Render an evidence-grounded visual collage, not a synthetic site or MHTML.
const escape = value => String(value).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function assessTileContinuity(first,second) {
  const a=first?.capture?.originalAnchors||[];
  const b=second?.capture?.originalAnchors||[];
  const topA=first?.capture?.before?.top;
  const topB=second?.capture?.before?.top;
  const movement=finite(topA)&&finite(topB)?topB-topA:null;
  const height=first?.capture?.scrollViewport?.height;
  const overlap=movement!==null&&finite(height)?height-Math.abs(movement):null;
  const identity=item=>typeof item?.key==='string'
    ? item.key+':'+item.line
    : Number.isInteger(item?.fingerprint)&&Array.isArray(item.path)
      ? item.fingerprint+':'+item.path.join('.'):null;
  const known=new Map();
  for(const item of a) {
    const k=identity(item);
    if(k&&finite(item.top))known.set(k,item.top);
  }
  const offsets=[];
  for(const item of b) {
    const k=identity(item);
    if(k&&known.has(k)&&finite(item.top)&&movement!==null)
      offsets.push(item.top-known.get(k)+movement);
  }
  if(offsets.length<2)
    return {status:'unverified',matches:offsets.length,movement,overlap};
  offsets.sort((x,y)=>x-y);
  const shift=offsets[Math.floor(offsets.length/2)];
  const spread=Math.max(...offsets.map(x=>Math.abs(x-shift)));
  return {status:spread<=5&&Math.abs(shift)<=12?'consistent':'shifted',
    matches:offsets.length,movement,overlap,shift,spread};
}

export function planCollage(entries) {
  const eligible = entries.filter(e => {
    const cap=e.capture, box=cap?.scrollViewport, geo=cap?.before;
    return !!(cap?.screenshotStable !== false && box && geo &&
      finite(geo.top) && finite(geo.max) &&
      finite(box.x) && finite(box.y) && finite(box.width) &&
      finite(box.height) && finite(box.viewportWidth) &&
      box.width>32 && box.height>32 && box.viewportWidth>=box.width);
  });
  const omitted=entries.length-eligible.length;
  if (!eligible.length) return {
    type:'timeline', segments:[], omitted, states:entries.length,
    reason:'capture.scrollViewport absent: older captures cannot be stitched safely'
  };
  // A dynamic virtualized document can change its scroll extent between
  // checkpoints. Coordinate alignment is only provisional in that case.
  const extents=eligible.map(e=>e.capture.before.max);
  const changingExtent=Math.max(...extents)-Math.min(...extents)>30;
  const widths=eligible.map(e=>e.capture.scrollViewport.width);
  const changingViewport=Math.max(...widths)-Math.min(...widths)>2;
  const sorted=eligible.map(e=>({
    ...e,start:e.capture.before.top,
    end:e.capture.before.top+e.capture.scrollViewport.height
  })).sort((a,b)=>a.start-b.start || b.end-a.end);
  // The readable default MUST keep every observed pixel in the scroll box.
  // Coordinate-overlap trimming can delete real text on virtualized pages.
  // Unsafe or geometry-less captures remain accessible as full screenshots.
  const safeTiles=entries.map
  (
    e=>
    {
      const cap=e.capture||{};
      const box=cap.scrollViewport;
      const geometryValid=!!(box&&
        finite(box.x)&&finite(box.y)&&
        finite(box.width)&&finite(box.height)&&
        finite(box.viewportWidth)&&
        box.x>=0&&box.y>=0&&
        box.width>32&&box.height>32&&
        box.viewportWidth>=box.width);
      return {
        id:e.id,
        top:finite(cap.before?.top)?cap.before.top:null,
        stable:cap.screenshotStable!==false,
        box:geometryValid?box:null
      };
    }
  ).sort
  (
    (a,b)=>
      (a.top??Number.POSITIVE_INFINITY)-(b.top??Number.POSITIVE_INFINITY) ||
      a.id.localeCompare(b.id)
  );

  // Greedy interval coverage, preserving source provenance for every strip.
  const start=sorted[0].start, end=Math.max(...sorted.map(e=>e.end));
  const expectedBottom=Math.max(...eligible.map(e=>
    e.capture.before.max+e.capture.scrollViewport.height));
  let cursor=start, steps=0;const segments=[],gaps=[];
  if(start>4)gaps.push({start:0,end:start});
  while(cursor<end && steps<entries.length*3+10){
    steps++;
    const available=sorted.filter(e=>e.start<=cursor && e.end>cursor);
    if(!available.length){
      const next=sorted.find(e=>e.start>cursor);
      if(!next)break;
      gaps.push({start:cursor,end:next.start});
      cursor=next.start;
      continue;
    }
    const best=available.reduce((a,b)=>b.end>a.end?b:a);
    const nextBoundary=Math.min(best.end,end);
    if(nextBoundary<=cursor)break;
    segments.push({
      id:best.id,from:cursor,to:nextBoundary,
      cropX:best.capture.scrollViewport.x,
      cropY:best.capture.scrollViewport.y+cursor-best.start,
      width:best.capture.scrollViewport.width,
      sourceWidth:best.capture.scrollViewport.viewportWidth,
      sourceTop:best.start,
      sourceEnd:best.end
    });
    cursor=nextBoundary;
  }
  if(expectedBottom>end+4)
    gaps.push({start:end,end:expectedBottom});
  return {type:'strips',segments,safeTiles,gaps,omitted,states:entries.length,
    changingExtent,changingViewport,
    completeGeometry:omitted===0 && gaps.length===0 && cursor>=end &&
      !changingExtent && !changingViewport,
    span:{from:start,to:end,expectedBottom},reason:changingExtent?
    'scroll extent changed: visual concatenation may contain discontinuities':
    'screen-space fragments only: rendering fidelity and DOM completeness unverified'};
}

function pageShell(title,content) {
  return '<!doctype html><html lang="it"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escape(title)+'</title><style>'+
    ':root{color-scheme:light}body{font:15px/1.5 system-ui,sans-serif;margin:0 auto;padding:1.5rem;max-width:1400px;color:#222}'+
    'a{color:#07599c}header{position:sticky;top:0;background:#fff;padding:.6rem 0;border-bottom:1px solid #aaa;z-index:2}'+
    '.note{padding:1rem;border:1px solid #ccc;background:#f7f7f7}section{margin:1rem 0;border-bottom:1px solid #ddd;padding:.6rem 0}'+
    '.strip{position:relative;overflow:hidden;border-left:2px solid #bbb}'+
    '.strip img{position:absolute;max-width:none;height:auto}'+
    '.fallback{display:block;width:min(100%,1000px);height:auto}small{color:#555}'+
    '</style></head><body>'+content+'</body></html>';
}
export function collageHtml(site,entries){
  const plan=planCollage(entries);
  const title=site+' — collage degli stati osservati';
  const nav='<header><a href="./comparison.html">Confronto screenshot</a> · '+
    '<a href="../">Entrambi i siti</a></header>';
  let html='<h1>'+escape(title)+'</h1>'+nav+
    '<p class="note">Questo collage utilizza solo screenshot <strong>originali</strong> del browser.'+
    ' Non inventa HTML, CSS o contenuti rimossi dal DOM. Ogni parte conserva il proprio checkpoint.'+
    ' Un file MHTML fotografa un solo stato, non tutta la cronologia.</p>';
  if(plan.type==='timeline'){
    html+='<p class="note">Catture precedenti prive di geometria del contenitore:'+
      ' visualizzazione cronologica senza ritagli e senza falsa unione.</p>';
    for(const e of entries){
      html+='<section><h2>Stato '+escape(e.id)+'</h2>'+
        '<a href="./comparison.html">Confronta con il suo MHTML</a>'+
        '<img class="fallback" loading="lazy" alt="Viewport '+escape(e.id)+'"'+
        ' src="./states/'+escape(e.id)+'/original.png"></section>';
    }
  }else{
    html+='<p class="note"><strong>Montaggio conservativo:</strong> '+
      'ogni tessera mostra tutta l’area scrollabile realmente fotografata. '+
      'Le sovrapposizioni possono ripetere testo: non vengono tagliate '+
      'sulla sola base di scrollTop. La presenza di immagini contigue non '+
      'dimostra che il contenuto mai catturato sia stato recuperato.</p>';
    for(const item of plan.safeTiles)
    {
      const source='./states/'+escape(item.id)+'/original.png';
      html+='<section><small>Checkpoint '+escape(item.id)+
        (item.top===null?' · scroll sconosciuto':
          ' · scrollTop '+escape(item.top))+
        (item.stable?'':' · screenshot instabile')+
        '</small>';
      if(item.box)
      {
        const box=item.box;
        html+='<div class="strip" style="width:'+box.width+
          'px;max-width:100%;height:'+box.height+'px">'+
          '<img loading="lazy" alt="Tessera completa '+escape(item.id)+
          '" src="'+source+'" style="width:'+box.viewportWidth+
          'px;left:-'+box.x+'px;top:-'+box.y+'px"></div>';
      }
      else
      {
        html+='<p>Geometria mancante: viewport originale non ritagliato.</p>'+
          '<img class="fallback" loading="lazy" alt="Viewport '+escape(item.id)+
          '" src="'+source+'">';
      }
      html+='</section>';
    }
    html+='<details><summary>Composizione compatta basata su coordinate '+
      '(sperimentale: può eliminare frammenti di testo alle giunzioni)'+
      '</summary>';
    if(plan.changingExtent||plan.changingViewport||plan.omitted||plan.gaps.length){
      html+='<p class="note"><strong>Copertura provvisoria.</strong> '+
        (plan.changingExtent?'Altezza scrollabile variabile; ':'')+
        (plan.changingViewport?'Larghezza del contenitore variabile; ':'')+
        (plan.omitted?plan.omitted+' stati senza geometria; ':'')+
        (plan.gaps.length?plan.gaps.length+' intervalli privi di acquisizione; ':'')+
        'Non considerare questa composizione un documento continuo verificato.</p>';
    }
    let previous=0;
    for(const item of plan.segments){
      if(item.from>previous){
        html+='<section><strong>Intervallo non acquisito: '+
          escape(previous)+'–'+escape(item.from)+'</strong></section>';
      }
      html+='<section><small>Checkpoint '+escape(item.id)+
        ' · coordinate '+escape(item.from)+'–'+escape(item.to)+'</small>'+
        '<div class="strip" style="width:'+item.width+'px;max-width:100%;height:'+
        (item.to-item.from)+'px">'+
        '<img loading="lazy" alt="Frammento dallo stato '+escape(item.id)+'" '+
        'src="./states/'+escape(item.id)+'/original.png" '+
        'style="width:'+item.sourceWidth+'px;left:-'+item.cropX+
        'px;top:-'+item.cropY+'px"></div></section>';
      previous=item.to;
    }
    if(previous<plan.span.expectedBottom){
      html+='<section><strong>Intervallo non acquisito: '+
        escape(previous)+'–'+escape(plan.span.expectedBottom)+
        '</strong></section>';
    }
    html+='</details>';
  }
  html+='<p><a href="./comparison.html">Torna al confronto originale/MHTML</a></p>';
  return pageShell(title,html);
}
