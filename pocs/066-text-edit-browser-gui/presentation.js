// Presentation contract experiment. Uses the actual compiled Document2D.
// The experimental proxy is a document-side candidate, NOT the published
// RawDocument2D output contract or a replacement source/selection engine.
(function()
{
'use strict';

const D=globalThis.m?.text?.document;
const $=id=>document.getElementById(id);
if(!D?.RawDocument2D || !D?.CellDocument2D)
{
  $('message').textContent='Core Document2D non disponibile.';
  return;
}

const original='A😀Be\u0301\tZ';
const rows=$('rows');
const scroller=$('scroller');
const canvas=document.createElement('canvas');
const metrics=canvas.getContext('2d');
const MIN_CELL=17;
let source=null;
let view=null;
let layers=[];
let unsubscribe=null;
let paints=0;
let scheduled=false;
let lastEvent=null;

// This prototype is installed by the document composer, BEFORE handing a
// view to the GUI. It changes only getRegions, preserves exact region.text,
// and forwards ALL other public Document2D behavior to the real implementation.
// CellDocument2D consumes raw unit regions and must reconstruct graphemes
// from the unchanged text, not from the displayText presentation candidate.
function prototypeRegions(input,rawUnits)
{
  function display(unit)
  {
    const code=unit.charCodeAt(0);
    if(code>=0xd800 && code<=0xdbff) return 'H';
    if(code>=0xdc00 && code<=0xdfff) return 'L';
    if(unit==='\t') return '⇥';
    if(/^\p{Mark}$/u.test(unit)) return '◌'+unit;
    if(code<32 || code===127) return '·';
    return unit;
  }

  return new Proxy(input,
  {
    get(target,key)
    {
      if(key==='getRegions')
      {
        return (...args)=>target.getRegions(...args).map(regions=>
          regions.flatMap(region=>
          {
            if(rawUnits && region.kind==='text')
            {
              return Array.from({length:region.text.length},(_,index)=>
              {
                const text=region.text[index];
                const col=region.start.col+index;
                return {
                  kind:'text',text,displayText:display(text),
                  start:{row:region.start.row,col},
                  end:{row:region.start.row,col:col+1}
                };
              });
            }
            if(region.kind==='tab') return [{...region,displayText:'⇥'}];
            return [region];
          })
        );
      }
      const value=Reflect.get(target,key,target);
      return typeof value==='function' ? value.bind(target) : value;
    },
    set(target,key,value)
    {
      return Reflect.set(target,key,value,target);
    }
  });
}

function dispose()
{
  if(unsubscribe) unsubscribe();
  for(const layer of layers.reverse()) layer.destroy();
  layers=[];
  unsubscribe=null;
  source=view=null;
}

function configure()
{
  dispose();
  const Backend=$('backend').value==='piece'?D.PieceDocument:D.FlatDocument;
  source=new Backend(original);
  const raw=new D.RawDocument2D(source);
  layers.push(raw);
  const rawPresented=prototypeRegions(raw,true);
  view=rawPresented;

  if($('mode').value!=='raw')
  {
    const cell=new D.CellDocument2D(rawPresented,4);
    layers.push(cell);
    view=cell;
    if($('mode').value==='nested')
    {
      const nested=new D.CellDocument2D(cell,4);
      layers.push(nested);
      view=nested;
    }
    view=prototypeRegions(view,false);
  }

  view.setSelections([{start:{row:0,col:0},end:{row:0,col:0},forward:true}]);
  unsubscribe=view.subscribe(event=>
  {
    lastEvent={type:event.type,revision:event.revision,
      invalidation:event.invalidation?.all===true};
    schedule();
  });
  paints=0;
  lastEvent=null;
  scroller.scrollLeft=0;
  $('message').textContent='Clic su una unità, frecce sinistra/destra e digitazione.';
  schedule();
}

function render()
{
  scheduled=false;
  if(!view) return;

  const revision=view.revision;
  const regionRows=view.getRegions(0,0,1,100);
  const selections=view.getSelections();
  const element=document.createElement('div');
  element.className='row';
  const content=document.createElement('div');
  content.className='content';

  const style=getComputedStyle(element);
  metrics.font=style.fontSize+' '+style.fontFamily;
  const boundaries=new Map([[0,0]]);
  let pixel=0;
  for(const region of regionRows[0]||[])
  {
    if(region.kind==='annotation') continue;
    const text=region.displayText??region.text;
    const width=Math.ceil(Math.max(
      (region.end.col-region.start.col)*MIN_CELL,
      metrics.measureText(text).width+8
    ));
    const span=document.createElement('span');
    span.className='unit';
    span.dataset.kind=region.kind;
    span.dataset.start=String(region.start.col);
    span.dataset.end=String(region.end.col);
    span.title=Array.from(region.text).map(
      c=>'U+'+c.codePointAt(0).toString(16).toUpperCase()
    ).join(' ');
    span.style.width=width+'px';
    span.textContent=text;
    content.appendChild(span);

    boundaries.set(region.start.col,pixel);
    pixel+=width;
    boundaries.set(region.end.col,pixel);
  }

  for(const selection of selections)
  {
    const point=selection.forward?selection.end:selection.start;
    if(point.row!==0 || !boundaries.has(point.col)) continue;
    const caret=document.createElement('span');
    caret.className='caret';
    caret.style.left=boundaries.get(point.col)+'px';
    content.appendChild(caret);
  }
  element.appendChild(content);
  rows.replaceChildren(element);
  paints++;
  $('status').textContent=
    'Colonne: '+view.getRowWidth(0)+' · Regioni: '+(regionRows[0]?.length||0)+
    ' · Revisione: '+revision+' · Render: '+paints;
}

function schedule()
{
  if(scheduled) return;
  scheduled=true;
  requestAnimationFrame(render);
}

function caret(col)
{
  const point={row:0,col};
  view.setSelections([{start:point,end:{...point},forward:true}]);
  schedule();
}

scroller.addEventListener('click',event=>
{
  const unit=event.target.closest('.unit');
  if(!unit) return;
  const rectangle=unit.getBoundingClientRect();
  const col=Number(
    event.clientX-rectangle.left < rectangle.width/2 ?
      unit.dataset.start : unit.dataset.end
  );
  try
  {
    caret(col);
    scroller.focus();
    $('message').textContent='Cursore alla colonna '+col;
  }
  catch(error)
  {
    $('message').textContent='Posizione respinta: '+error.message;
  }
});

scroller.addEventListener('keydown',event=>
{
  if(!view || event.ctrlKey || event.metaKey || event.altKey) return;

  if(event.key==='ArrowLeft' || event.key==='ArrowRight')
  {
    event.preventDefault();
    const selection=view.getSelections()[0];
    if(!selection) return;
    const col=(selection.forward?selection.end:selection.start).col;
    const boundaries=[0,...view.getRegions(0,0,1,100)[0].flatMap(
      region=>[region.start.col,region.end.col]
    )].filter((value,index,list)=>list.indexOf(value)===index)
      .sort((a,b)=>a-b);
    const candidate=event.key==='ArrowLeft'?
      boundaries.filter(x=>x<col).at(-1):
      boundaries.find(x=>x>col);
    if(candidate!==undefined)
    {
      try { caret(candidate); }
      catch(error) { $('message').textContent=error.message; }
    }
    return;
  }

  if(event.key.length===1 && !/[\x00-\x1f\x7f]/u.test(event.key))
  {
    event.preventDefault();
    try
    {
      view.insert(event.key);
      $('message').textContent='Inserimento attraverso Document2D';
      schedule();
    }
    catch(error)
    {
      $('message').textContent='Inserimento respinto: '+error.message;
    }
  }
});

$('backend').addEventListener('change',configure);
$('mode').addEventListener('change',configure);
$('reset').addEventListener('click',configure);

// Diagnostic observation is separate from the GUI renderer. It reads the
// physical source only to verify that display placeholders never mutate data.
globalThis.__presentationProbe=Object.freeze(
{
  snapshot:()=>({
    mode:$('mode').value,backend:$('backend').value,
    sourceText:source.toString(),sourceRevision:source.revision,
    viewRevision:view.revision,
    rect:view.getRect(0,0,1,100)[0],
    regions:view.getRegions(0,0,1,100)[0],
    selections:view.getSelections(),
    rendered:Array.from(rows.querySelectorAll('.unit')).map(element=>({
      text:element.textContent,
      start:Number(element.dataset.start),end:Number(element.dataset.end),
      kind:element.dataset.kind,
      clipped:element.scrollWidth>element.clientWidth+1,
      scrollWidth:element.scrollWidth,clientWidth:element.clientWidth
    })),
    paints,lastEvent,
    message:$('message').textContent
  })
});
configure();
})();