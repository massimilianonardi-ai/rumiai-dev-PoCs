// Contract-first PoC 066. The renderer depends on the *public* Document2D
// interface only. The composer alone knows which concrete layers exist.
// There is no Raw per-unit proxy, no transport codec and no Unicode splitter.
(function()
{
'use strict';

const D=globalThis.m?.text?.document;
const $=id=>document.getElementById(id);
if(!D?.CellDocument2D || !D?.RawDocument2D)
{
  $('message').textContent='Core Document2D non disponibile.';
  return;
}

const sample='A😀Be\u0301\tZ👩‍💻\nHIDDEN\nTAIL';
const rows=$('rows');
const metrics=document.createElement('canvas').getContext('2d');
const CELL_PX=20;
let source=null;
let view=null;
let layers=[];
let unsubscribe=null;
let paints=0;
let scheduled=false;
let lastEvent=null;
let lastRendered=null;

function destroy()
{
  if(unsubscribe)
  {
    unsubscribe();
    unsubscribe=null;
  }
  for(const layer of layers.reverse()) layer.destroy();
  layers=[];
  source=view=null;
}

function compose(Backend,mode)
{
  source=new Backend(sample);
  const raw=new D.RawDocument2D(source);
  layers.push(raw);

  const cell=new D.CellDocument2D(raw,4);
  layers.push(cell);
  view=cell;

  if(mode==='nested')
  {
    const nested=new D.CellDocument2D(view,4);
    layers.push(nested);
    view=nested;
  }

  if(['annotation','fold','substitution'].includes(mode))
  {
    const notes=new D.AnnotationDocument2D(view);
    layers.push(notes);
    notes.setAnnotations
    (
      [{id:'guide',text:'Annotazione senza contenuto fisico',
        at:{row:0,col:1}}]
    );
    view=notes;
  }

  if(mode==='fold')
  {
    const fold=new D.FoldDocument2D(view);
    layers.push(fold);
    fold.setFolds([{startRow:1,endRow:2}]);
    view=fold;
  }

  if(mode==='substitution')
  {
    const substitution=new D.SubstitutionDocument2D(view);
    layers.push(substitution);
    substitution.setSubstitutions
    (
      [{id:'protected',text:'LONG',
        start:{row:0,col:2},end:{row:0,col:3}}]
    );
    view=substitution;
  }
}

function renderDocument(document2D,element,colStart,colEnd)
{
  const revision=document2D.revision;
  const rowEnd=Math.min(3,document2D.rowCount);
  const visible=document2D.getRegions(0,colStart,rowEnd,colEnd);
  const selections=document2D.getSelections();
  const fragment=globalThis.document.createDocumentFragment();
  const measurements=[];
  const style=getComputedStyle(element);
  metrics.font='18px '+(style.fontFamily||'monospace');

  for(let row=0;row<rowEnd;row++)
  {
    const line=globalThis.document.createElement('div');
    line.className='row';
    line.dataset.row=String(row);
    const content=globalThis.document.createElement('div');
    content.className='content';
    content.dataset.row=String(row);
    const units=[];
    const notes=[];

    for(const region of visible[row]||[])
    {
      if(region.kind==='annotation')
      {
        notes.push(region);
        continue;
      }

      // A displayed TAB symbol is a GUI glyph choice; logical width
      // comes only from region.end.col-region.start.col.
      const glyph=region.kind==='tab'?'⇥':region.text;
      const width=Math.ceil(Math.max
      (
        CELL_PX*(region.end.col-region.start.col),
        metrics.measureText(glyph).width+12
      ));
      const span=globalThis.document.createElement('span');
      span.className='unit';
      span.dataset.kind=region.kind;
      span.dataset.row=String(row);
      span.dataset.start=String(region.start.col);
      span.dataset.end=String(region.end.col);
      span.style.width=width+'px';
      span.textContent=glyph;
      content.appendChild(span);
      units.push({span,start:region.start.col,end:region.end.col});
    }

    line.appendChild(content);
    fragment.appendChild(line);
    measurements.push({row,content,units,notes});
  }

  element.replaceChildren(fragment);
  for(const {row,content,units,notes} of measurements)
  {
    const positions=new Map([[colStart,0]]);
    let left=0;

    for(const unit of units)
    {
      if(unit.span.scrollWidth>unit.span.clientWidth)
      {
        unit.span.style.width=(unit.span.scrollWidth+12)+'px';
      }
      positions.set(unit.start,left);
      left+=unit.span.getBoundingClientRect().width;
      positions.set(unit.end,left);
    }

    for(const region of notes)
    {
      const x=positions.get(region.start.col);
      if(x===undefined) continue;
      const note=globalThis.document.createElement('span');
      note.className='annotation';
      note.dataset.id=region.id;
      note.dataset.row=String(row);
      note.dataset.col=String(region.start.col);
      note.title=region.text;
      note.textContent='●';
      note.style.left=x+'px';
      content.appendChild(note);
    }

    for(const selection of selections)
    {
      const point=selection.forward?selection.end:selection.start;
      if(point.row!==row || !positions.has(point.col)) continue;
      const caret=globalThis.document.createElement('span');
      caret.className='caret';
      caret.dataset.row=String(row);
      caret.dataset.col=String(point.col);
      caret.style.left=positions.get(point.col)+'px';
      content.appendChild(caret);
    }
  }
  if(revision!==document2D.revision)
  {
    // A revision invalidated the drawn geometry; request another frame.
    schedule();
    return;
  }
  paints++;
  lastRendered={revision,visible,rowCount:rowEnd};
  $('status').textContent=
    'Righe: '+document2D.rowCount+
    ' · Colonne prima riga: '+document2D.getRowWidth(0)+
    ' · Revisione: '+revision+' · Render: '+paints;
}

function render()
{
  scheduled=false;
  if(view) renderDocument(view,rows,0,100);
}

function schedule()
{
  if(scheduled) return;
  scheduled=true;
  requestAnimationFrame(render);
}

function configure()
{
  destroy();
  paints=0;
  lastEvent=null;
  lastRendered=null;
  const Backend=$('backend').value==='piece'?
    D.PieceDocument:D.FlatDocument;
  compose(Backend,$('mode').value);
  view.setSelections
  (
    [{start:{row:0,col:0},end:{row:0,col:0},forward:true}]
  );
  unsubscribe=view.subscribe(event=>
  {
    lastEvent={
      type:event.type,revision:event.revision,
      invalidation:event.invalidation?.all===true
    };
    schedule();
  });
  $('message').textContent='Vista canonica pronta; interazioni in G02.';
  schedule();
}

$('mode').addEventListener('change',configure);
$('backend').addEventListener('change',configure);
$('reset').addEventListener('click',configure);

// Diagnostics are deliberately outside the renderer. The GUI is never
// handed the backing physical Document or any internal coordinate mapping.
globalThis.__canonicalGuiProbe=Object.freeze
(
  {
    snapshot:()=>
    {
      const visible=lastRendered?.visible||[];
      return {
        mode:$('mode').value,backend:$('backend').value,
        paints,sourceText:source?.toString(),
        sourceRevision:source?.revision,viewRevision:view?.revision,
        renderedRevision:lastRendered?.revision,
        rowCount:view?.rowCount,firstRowWidth:view?.getRowWidth(0),
        rawRegions:layers[0]?.getRegions(0,0,1,100)[0],
        regionsByRow:visible,
        selections:view?.getSelections(),lastEvent,
        domUnits:Array.from(rows.querySelectorAll('.unit'),item=>({
          kind:item.dataset.kind,row:Number(item.dataset.row),
          start:Number(item.dataset.start),end:Number(item.dataset.end),
          text:item.textContent,clipped:item.scrollWidth>item.clientWidth,
          width:item.getBoundingClientRect().width
        })),
        domNotes:Array.from(rows.querySelectorAll('.annotation'),item=>({
          id:item.dataset.id,row:Number(item.dataset.row),
          col:Number(item.dataset.col)
        })),
        domCaret:Array.from(rows.querySelectorAll('.caret'),item=>({
          row:Number(item.dataset.row),col:Number(item.dataset.col)
        }))
      };
    }
  }
);

configure();
})();
