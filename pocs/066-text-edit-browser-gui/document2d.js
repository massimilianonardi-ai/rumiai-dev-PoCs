// Browser integration experiment against the actual jsc-compiled m core.
// This DOM adapter consumes only the public Document2D interface.
// The existing TextEdit 0.8.2 GUI remains separate and unchanged.
(function()
{
'use strict';

const D=globalThis.m?.text?.document;
const $=id=>document.getElementById(id);
if(!D || !D.FlatDocument || !D.CellDocument2D)
{
  $('message').textContent='Core m.text.document assente: compilare modules-js.json prima di aprire questa pagina.';
  return;
}

const scroller=$('scroller');
const spacer=$('spacer');
const rows=$('rows');
const HEIGHT=28;
const CELL=13;
const GUTTER=62;
const MAX_COLUMNS=120;
const OVERSCAN=3;
const p=(row,col)=>({row,col});
const note=(row,col)=>({id:'guide',text:'annotazione',at:p(row,col)});

let source=null;
let raw=null;
let lower=null;
let notes=null;
let upper=null;
let view=null;
let unsubscribe=null;
let lastEvent=null;
let invalidations=0;
let paints=0;
let scheduled=false;
let maxMounted=0;

function dispose()
{
  if(unsubscribe)
  {
    unsubscribe();
    unsubscribe=null;
  }

  if(view) view.destroy();
  if(upper) upper.destroy();
  if(notes) notes.destroy();
  if(lower) lower.destroy();
  if(raw) raw.destroy();

  source=raw=lower=notes=upper=view=null;
}

function message(text)
{
  $('message').textContent=text;
}

function snapshot()
{
  if(!view) return null;

  let selections=[];
  try { selections=view.getSelections(); } catch(error) {}
  return {
    kind:$('kind').value,
    backend:$('backend').value,
    sourceText:source.toString(),
    sourceRevision:source.revision,
    revision:view.revision,
    rowCount:view.rowCount,
    visibleText:view.getRect(0,0,Math.min(6,view.rowCount),MAX_COLUMNS),
    selections,
    lastEvent,
    invalidations,
    paints,
    mounted:rows.children.length,
    maxMounted,
    renderedRows:Array.from(rows.children).map(row=>({
      row:Number(row.dataset.row),
      text:row.querySelector('.content').textContent,
      regions:Array.from(row.querySelectorAll('.region')).map(region=>({
        kind:region.dataset.kind,
        start:Number(region.dataset.start),
        end:Number(region.dataset.end),
        text:region.textContent
      })),
      annotations:row.querySelectorAll('.annotation').length,
      carets:row.querySelectorAll('.caret').length
    })),
    message:$('message').textContent
  };
}

function paint()
{
  scheduled=false;
  if(!view) return;

  const count=view.rowCount;
  spacer.style.height=(count*HEIGHT)+'px';
  spacer.style.minWidth=(GUTTER+MAX_COLUMNS*CELL)+'px';
  const first=Math.min
  (
    Math.max(0,count-1),
    Math.max(0,Math.floor(scroller.scrollTop/HEIGHT)-OVERSCAN)
  );
  const end=Math.min
  (
    count,Math.ceil((scroller.scrollTop+scroller.clientHeight)/HEIGHT)+OVERSCAN
  );

  const rendered=view.getRegions(first,0,end,MAX_COLUMNS);
  const selections=view.getSelections();
  const fragment=document.createDocumentFragment();

  for(let row=first;row<end;row++)
  {
    const element=document.createElement('div');
    element.className='row';
    element.dataset.row=String(row);

    const gutter=document.createElement('span');
    gutter.className='gutter';
    gutter.textContent=String(row+1);
    element.appendChild(gutter);

    const content=document.createElement('div');
    content.className='content';
    content.dataset.row=String(row);
    content.style.width=(MAX_COLUMNS*CELL)+'px';

    for(const region of rendered[row-first] || [])
    {
      const start=region.start.col;
      const finish=region.end.col;

      if(region.kind==='annotation')
      {
        const overlay=document.createElement('span');
        overlay.className='annotation';
        overlay.dataset.id=region.id||'';
        overlay.style.left=(start*CELL)+'px';
        overlay.title=region.text;
        overlay.textContent='●';
        content.appendChild(overlay);
        continue;
      }

      if(finish<=start) continue;

      const span=document.createElement('span');
      span.className='region';
      span.dataset.kind=region.kind;
      span.dataset.start=String(start);
      span.dataset.end=String(finish);
      span.style.width=((finish-start)*CELL)+'px';
      span.textContent=region.text==='\t'?'·':region.text;
      content.appendChild(span);
    }

    for(const selection of selections)
    {
      const caret=selection.forward?selection.end:selection.start;
      if(caret.row!==row) continue;
      const indicator=document.createElement('span');
      indicator.className='caret';
      indicator.style.left=(caret.col*CELL)+'px';
      content.appendChild(indicator);
    }

    element.appendChild(content);
    fragment.appendChild(element);
  }

  rows.replaceChildren(fragment);
  rows.style.transform='translateY('+(first*HEIGHT)+'px)';
  paints++;
  maxMounted=Math.max(maxMounted,rows.children.length);
  $('status').textContent=
    'Revisioni vista/sorgente: '+view.revision+'/'+source.revision+
    ' · righe: '+view.rowCount+
    ' · invalidazioni complete: '+invalidations+
    ' · render: '+paints+
    ' · righe DOM: '+rows.children.length;
}

function schedule()
{
  if(scheduled) return;
  scheduled=true;
  requestAnimationFrame(paint);
}

function changed(event)
{
  lastEvent={
    type:event.type,
    revision:event.revision,
    invalidation:event.invalidation?{...event.invalidation}:null,
    geometry:event.geometry?
    {
      previousRevision:event.geometry.previousRevision,
      revision:event.geometry.revision,
      oldRowCount:event.geometry.oldRowCount,
      newRowCount:event.geometry.newRowCount,
      edits:event.geometry.edits.map(entry=>({
        old:{start:{...entry.old.start},end:{...entry.old.end}},
        new:{start:{...entry.new.start},end:{...entry.new.end}}
      }))
    }:null
  };

  if(event.invalidation?.all===true)
  {
    invalidations++;
  }

  // Even exact edit endpoints do not justify a partial viewport repaint.
  // Re-read the entire *bounded visible window* from the current view.
  schedule();
}

function configure()
{
  dispose();

  const fold=$('kind').value==='fold';
  const Backend=$('backend').value==='piece'?D.PieceDocument:D.FlatDocument;
  source=new Backend(fold?'A\tB😀C\nHIDDEN\nxy😀z\nTAIL':'A\tBC😀DE\nTAIL');
  raw=new D.RawDocument2D(source);
  lower=new D.CellDocument2D(raw,4);
  notes=new D.AnnotationDocument2D(lower);
  notes.setAnnotations([fold?note(3,1):note(1,1)]);
  upper=new D.CellDocument2D(notes,8);
  view=fold?new D.FoldDocument2D(upper):new D.SubstitutionDocument2D(upper);

  if(fold)
  {
    view.setInlineFold({start:p(0,4),end:p(2,1)});
  }
  else
  {
    view.setSubstitutions
    (
      [
        {id:'right',text:'LONG',start:p(0,7),end:p(0,8)},
        {id:'left',text:'Q',start:p(0,4),end:p(0,6)}
      ]
    );
  }

  view.setSelections([{start:p(0,0),end:p(0,0),forward:true}]);
  unsubscribe=view.subscribe(changed);
  lastEvent=null;
  invalidations=0;
  paints=0;
  maxMounted=0;
  scroller.scrollTop=0;
  message('Vista iniziale pronta. Il marcatore e le sostituzioni non sono testo modificabile.');
  schedule();
}

function perform(edits)
{
  const revision=view.revision;
  const sourceRevision=source.revision;
  try
  {
    view.replace(edits,revision);
    if(source.revision!==sourceRevision+1)
    {
      throw new Error('La modifica non ha prodotto esattamente un commit fisico');
    }
    message('Modifica confermata sulla sorgente.');
    return true;
  }
  catch(error)
  {
    message('Modifica respinta: '+error.message);
    schedule();
    return false;
  }
}

function allowed()
{
  return $('kind').value==='fold'?
    perform([{start:p(0,0),end:p(0,1),text:'Q'}]):
    perform([{start:p(0,10),end:p(0,11),text:'Z'}]);
}

function blocked()
{
  return $('kind').value==='fold'?
    perform([{start:p(0,4),end:p(0,5),text:'X'}]):
    perform([{start:p(0,8),end:p(0,8),text:'X'}]);
}

function outside()
{
  if($('kind').value==='fold')
  {
    const offset=source.lineStart(1)+2;
    source.replace(offset,offset+1,'K');
  }
  else
  {
    source.replace(2,3,'K');
  }
  message('Modifica esterna confermata: geometria sintetica invalidata.');
  return true;
}

function updateNote()
{
  const row=$('kind').value==='fold'?3:1;
  notes.setAnnotations([note(row,2)]);
  message('Annotazione riconfigurata: nessuna modifica fisica.');
  return true;
}

function caret(row,col)
{
  const point=p(row,col);
  view.setSelections([{start:point,end:point,forward:true}]);
  schedule();
}

scroller.addEventListener('click',event=>
{
  const content=event.target.closest('.content');
  if(!content || !view) return;
  const row=Number(content.dataset.row);
  const left=content.getBoundingClientRect().left;
  let col=Math.max(0,Math.min(view.getRowWidth(row),
    Math.round((event.clientX-left)/CELL)));
  const regions=view.getRegions(row,0,row+1,Math.max(col+1,MAX_COLUMNS))[0]||[];

  // An indivisible region has two valid boundaries, never an interior caret.
  for(const region of regions)
  {
    if(region.kind==='annotation') continue;
    if(region.start.col<col && col<region.end.col)
    {
      col=(col-region.start.col <= region.end.col-col)?
        region.start.col:region.end.col;
      break;
    }
  }

  try
  {
    caret(row,col);
    message('Cursore impostato su ('+row+','+col+').');
  }
  catch(error)
  {
    message('Cursore respinto: '+error.message);
  }
});

scroller.addEventListener('keydown',event=>
{
  if(!view || event.ctrlKey || event.metaKey || event.altKey ||
    [...event.key].length!==1 || event.key==='\n') return;
  if(!/^[^\x00-\x1f\x7f]$/u.test(event.key)) return;

  const selections=view.getSelections();
  if(selections.length!==1) return;
  event.preventDefault();
  perform
  (
    [{start:selections[0].start,end:selections[0].end,text:event.key}]
  );
});

$('reset').addEventListener('click',configure);
$('kind').addEventListener('change',configure);
$('backend').addEventListener('change',configure);
$('allowed').addEventListener('click',allowed);
$('blocked').addEventListener('click',blocked);
$('outside').addEventListener('click',outside);
$('note').addEventListener('click',updateNote);
scroller.addEventListener('scroll',schedule);

globalThis.__document2dGuiProbe=Object.freeze
(
  {
    snapshot,
    caret,
    allowed,
    blocked,
    outside,
    updateNote
  }
);
configure();
})();
