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
const longSample='A😀Be\u0301\tZ👩‍💻XY'.repeat(9000);
const manySample=Array.from
(
  {length:1200},
  (_,i)=>'row-'+String(i).padStart(4,'0')+' A😀Be\u0301\tZ👩‍💻'
).join('\n');
const VISIBLE_ROWS=3;
const VISIBLE_COLS=100;
const rows=$('rows');
const renderer=new globalThis.CanonicalRegionRenderer
(
  rows,VISIBLE_ROWS,VISIBLE_COLS
);
let source=null;
let view=null;
let layers=[];
let unsubscribe=null;
let paints=0;
let scheduled=false;
let lastEvent=null;
let lastContentEvent=null;
let contentEvents=0;
let selectionEvents=0;
let lastRendered=null;
let firstRow=0;
let firstCol=0;
let generation=0;
let frame=null;
let regionReads=0;
let retiredSource=null;
let retiredView=null;

function destroy()
{
  if(unsubscribe)
  {
    unsubscribe();
    unsubscribe=null;
  }
  retiredSource=source;
  retiredView=view;
  for(const layer of layers.reverse()) layer.destroy();
  layers=[];
  source=view=null;
}

function compose(Backend,mode)
{
  const fixture=$('fixture').value;
  source=new Backend
  (
    fixture==='long' ? longSample :
    fixture==='many' ? manySample : sample
  );
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


function render()
{
  if(!view) return;
  firstRow=Math.min
  (
    firstRow,Math.max(0,view.rowCount-VISIBLE_ROWS)
  );
  regionReads++;
  const painted=renderer.render(view,firstRow,firstCol);
  if(!painted)
  {
    schedule();
    return;
  }
  paints++;
  lastRendered={...painted,generation};
  $('status').textContent=
    'Vista righe '+painted.rowStart+'–'+painted.rowEnd+
    ' · colonne '+painted.colStart+'–'+painted.colEnd+
    ' · righe totali '+view.rowCount+
    ' · revisione '+painted.revision+' · render '+paints;
}

function schedule()
{
  if(scheduled) return;
  scheduled=true;
  const ticket=generation;
  frame=requestAnimationFrame
  (
    ()=>
    {
      frame=null;
      scheduled=false;
      if(ticket!==generation) return;
      render();
    }
  );
}

function configure()
{
  generation++;
  if(frame!==null)
  {
    cancelAnimationFrame(frame);
    frame=null;
  }
  scheduled=false;
  destroy();
  firstRow=0;
  firstCol=0;
  scroller.scrollTop=0;
  scroller.scrollLeft=0;
  regionReads=0;
  paints=0;
  lastEvent=null;
  lastContentEvent=null;
  contentEvents=0;
  selectionEvents=0;
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
    if(event.type==='content')
    {
      contentEvents++;
      lastContentEvent=lastEvent;
    }
    if(event.type==='selections') selectionEvents++;
    schedule();
  });
  $('message').textContent=
    'Clic sulla metà sinistra/destra di un elemento, frecce e digitazione.';
  schedule();
}


// The editor only receives the outermost Document2D. The public visible
// regions declare all legal cell boundaries. The GUI never segments text,
// infers source coordinates or edits the backing physical Document.
function setRange(anchor,cursor)
{
  const forward=anchor.row<cursor.row ||
    (anchor.row===cursor.row && anchor.col<=cursor.col);
  const start=forward?anchor:cursor;
  const end=forward?cursor:anchor;
  view.setSelections
  (
    [{start:{...start},end:{...end},forward}]
  );
  if(cursor.row<firstRow || cursor.row>=firstRow+VISIBLE_ROWS)
  {
    firstRow=Math.max
    (
      0,Math.min(cursor.row,view.rowCount-VISIBLE_ROWS)
    );
  }
  if(cursor.col<firstCol || cursor.col>firstCol+VISIBLE_COLS)
  {
    firstCol=Math.floor(cursor.col/VISIBLE_COLS)*VISIBLE_COLS;
  }
  schedule();
}

function moveCaret(row,col)
{
  const point={row,col};
  setRange(point,point);
}

function moveHorizontal(direction,extend=false)
{
  const selection=view.getSelections()[0];
  if(!selection) return;

  // Ordinary unshifted arrow collapses the existing selected interval,
  // matching the current TextEdit 0.8.2 browser interaction.
  const selected=selection.start.row!==selection.end.row ||
    selection.start.col!==selection.end.col;
  if(selected && !extend)
  {
    const target=direction<0?selection.start:selection.end;
    moveCaret(target.row,target.col);
    return;
  }

  const anchor=selection.forward?selection.start:selection.end;
  const point=selection.forward?selection.end:selection.start;
  const at=point.col+(direction<0?-1:0);
  if(at<0) return;

  // A bounded one-column public read returns the whole intersecting
  // grapheme/TAB; no source offsets or GUI-side Unicode segmentation.
  const next=view.getRegions
  (
    point.row,at,point.row+1,at+1
  )[0].find
  (
    region=>region.kind!=='annotation' &&
      region.start.col<=at && region.end.col>at
  );
  if(!next) return;

  const cursor={row:point.row,col:direction<0?next.start.col:next.end.col};
  if(extend)
  {
    setRange(anchor,cursor);
  }
  else
  {
    moveCaret(cursor.row,cursor.col);
  }
}

function moveVertical(direction)
{
  const selection=view.getSelections()[0];
  if(!selection) return;

  const point=selection.forward?selection.end:selection.start;
  const row=point.row+direction;
  if(row<0 || row>=view.rowCount) return;
  const target=Math.min(point.col,view.getRowWidth(row));
  const regions=view.getRegions
  (
    row,Math.max(0,target-1),row+1,target+1
  )[0].filter(region=>region.kind!=='annotation');
  const boundaries=new Set([0,target]);
  for(const region of regions)
  {
    boundaries.add(region.start.col);
    boundaries.add(region.end.col);
  }
  const valid=Array.from(boundaries)
    .filter(col=>col>=0 && col<=view.getRowWidth(row))
    .sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b);
  // setSelections is the authority on legal exposed endpoints, including
  // protected rows; no fallback to backing coordinates is allowed.
  for(const col of valid)
  {
    try
    {
      moveCaret(row,col);
      return;
    }
    catch(error)
    {
      if(!(error instanceof RangeError)) throw error;
    }
  }
}

function moveWindow(rowDelta,colDelta)
{
  if(!view) return;
  const rowEnd=Math.max(0,view.rowCount-VISIBLE_ROWS);
  const nextRow=Math.max(0,Math.min(rowEnd,firstRow+rowDelta));
  let nextCol=firstCol;

  if(colDelta!==0)
  {
    let maximum=0;
    for(let row=nextRow;row<Math.min(view.rowCount,nextRow+VISIBLE_ROWS);row++)
    {
      maximum=Math.max(maximum,view.getRowWidth(row));
    }
    nextCol=Math.max
    (
      0,Math.min(Math.max(0,maximum-VISIBLE_COLS),firstCol+colDelta)
    );
  }

  if(nextRow===firstRow && nextCol===firstCol) return;
  firstRow=nextRow;
  firstCol=nextCol;
  scroller.scrollTop=0;
  scroller.scrollLeft=0;
  schedule();
}


// A deliberately bounded Delete interaction: one *visible* whole unit.
// The view alone decides whether the interval is editable. This is not a
// general deletion/selection/clipboard implementation (G04+).
function deleteNextVisibleUnit()
{
  const selection=view.getSelections()[0];
  if(!selection || !lastRendered ||
    lastRendered.revision!==view.revision)
  {
    schedule();
    return;
  }

  if(selection.start.row!==selection.end.row ||
    selection.start.col!==selection.end.col)
  {
    return;
  }

  const point=selection.start;
  const regions=lastRendered.visible[point.row-lastRendered.rowStart]||[];
  const unit=regions.find
  (
    region=>region.kind!=='annotation' &&
      region.start.col===point.col && region.end.col>point.col
  );
  if(!unit) return;

  view.replace
  (
    [{start:{...point},end:{...unit.end},text:''}],
    view.revision
  );
  schedule();
}

const scroller=$('scroller');
// The DOM intentionally contains only three rows. Real wheel events page
// the logical bounded viewport; this is not a document-sized scrollbar.
scroller.addEventListener('wheel',event=>
{
  if(!view) return;
  const horizontal=event.shiftKey ||
    Math.abs(event.deltaX)>Math.abs(event.deltaY);
  const delta=horizontal?(event.deltaX||event.deltaY):event.deltaY;
  if(!delta) return;
  const pages=Math.max(1,Math.ceil(Math.abs(delta)/100));
  event.preventDefault();
  moveWindow
  (
    horizontal?0:Math.sign(delta)*pages*VISIBLE_ROWS,
    horizontal?Math.sign(delta)*pages*VISIBLE_COLS:0
  );
},{passive:false});

scroller.addEventListener('click',event=>
{
  const target=event.target;
  if(!(target instanceof Element)) return;
  const unit=target.closest('.unit');
  if(!unit || !rows.contains(unit)) return;

  const rect=unit.getBoundingClientRect();
  const row=Number(unit.dataset.row);
  const col=event.clientX-rect.left<rect.width/2 ?
    Number(unit.dataset.start) : Number(unit.dataset.end);

  try
  {
    moveCaret(row,col);
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
  if(!view || event.ctrlKey || event.altKey || event.metaKey ||
    event.isComposing)
  {
    return;
  }

  if(event.key==='ArrowLeft' || event.key==='ArrowRight')
  {
    event.preventDefault();
    try
    {
      moveHorizontal(event.key==='ArrowLeft'?-1:1,event.shiftKey);
    }
    catch(error)
    {
      $('message').textContent='Navigazione respinta: '+error.message;
    }
    return;
  }

  if(event.key==='PageDown' || event.key==='PageUp')
  {
    event.preventDefault();
    moveWindow(event.key==='PageDown'?VISIBLE_ROWS:-VISIBLE_ROWS,0);
    return;
  }

  if(event.key==='ArrowDown' || event.key==='ArrowUp')
  {
    event.preventDefault();
    try
    {
      moveVertical(event.key==='ArrowDown'?1:-1);
    }
    catch(error)
    {
      $('message').textContent='Navigazione respinta: '+error.message;
    }
    return;
  }

  if(event.key==='Delete')
  {
    event.preventDefault();
    try
    {
      deleteNextVisibleUnit();
    }
    catch(error)
    {
      $('message').textContent='Eliminazione respinta: '+error.message;
    }
    return;
  }

  // G02 handles ordinary non-composing one-key text input. IME,
  // paste, Enter, full deletion policies and composed text are separate work.
  if(event.key.length===1 && !/[\x00-\x1f\x7f]/u.test(event.key))
  {
    event.preventDefault();
    try
    {
      view.insert(event.key);
      $('message').textContent='Inserimento tramite Document2D';
      schedule();
    }
    catch(error)
    {
      $('message').textContent='Inserimento respinto: '+error.message;
    }
  }
});

$('fixture').addEventListener('change',configure);
$('mode').addEventListener('change',configure);
$('backend').addEventListener('change',configure);
$('reset').addEventListener('click',configure);

// Diagnostics are deliberately outside the renderer. The GUI is never
// handed the backing physical Document or any internal coordinate mapping.
globalThis.__canonicalGuiProbe=Object.freeze
(
  {
    // Diagnostic probe: exercises the real public selection method.
    // Invalid in-token positions are not produced by GUI pointer/keys.
    attemptSelectionAt:(row,col)=>
    {
      const before=JSON.stringify(view.getSelections());
      const revision=view.revision;
      const sourceRevision=source.revision;
      let rejected=false;
      let reason='';
      try
      {
        moveCaret(row,col);
      }
      catch(error)
      {
        rejected=true;
        reason=error.message;
      }
      return {
        rejected,reason,
        selectionUnchanged:JSON.stringify(view.getSelections())===before,
        revisionUnchanged:view.revision===revision,
        sourceUnchanged:source.revision===sourceRevision
      };
    },
    // Deliberately diagnostic: the real public atomic replace contract is
    // exercised with a valid edit plus a protected synthetic interval.
    // Tests must not confuse this direct API proof with an actual key event.
    attemptProtectedBatch:()=>
    {
      const before=source.toString();
      const physicalRevision=source.revision;
      const viewRevision=view.revision;
      const events=contentEvents;
      const selections=JSON.stringify(view.getSelections());
      const synthetic=view.getRegions(0,0,view.rowCount,100)
        .flat().find(region=>
          region.kind==='fold'||region.kind==='substitution');
      if(!synthetic) throw new Error('no protected interval in view');

      const first=view.getRegions(0,0,1,2)[0].find
      (
        region=>region.kind==='text' &&
          region.start.col===0 && region.end.col===1
      );
      if(!first) throw new Error('no ordinary control region');

      let rejected=false;
      let reason='';
      try
      {
        view.replace
        (
          [
            {start:{...first.start},end:{...first.end},text:'Q'},
            {start:{...synthetic.start},end:{...synthetic.end},text:'X'}
          ],
          view.revision
        );
      }
      catch(error)
      {
        rejected=true;
        reason=error.message;
      }
      return {
        rejected,reason,syntheticKind:synthetic.kind,
        originalUnchanged:source.toString()===before,
        sourceRevisionUnchanged:source.revision===physicalRevision,
        viewRevisionUnchanged:view.revision===viewRevision,
        contentEventsUnchanged:contentEvents===events,
        selectionsUnchanged:JSON.stringify(view.getSelections())===selections
      };
    },
    viewport:()=>({
      fixture:$('fixture').value,mode:$('mode').value,
      firstRow,firstCol,generation,paints,regionReads,
      rowCount:view?.rowCount,viewRevision:view?.revision,
      renderedRevision:lastRendered?.revision,
      renderedGeneration:lastRendered?.generation,
      renderWindow:lastRendered ? {
        rowStart:lastRendered.rowStart,rowEnd:lastRendered.rowEnd,
        colStart:lastRendered.colStart,colEnd:lastRendered.colEnd
      } : null,
      mountedRows:rows.childElementCount,
      mountedUnits:rows.querySelectorAll('.unit').length
    }),
    mutateRetiredSource:()=>
    {
      if(!retiredSource) return null;
      const priorRevision=retiredSource.revision;
      const currentRevision=source.revision;
      const currentPaints=paints;
      const currentEvents=contentEvents;
      retiredSource.replace([{start:0,end:0,text:'!'}]);
      return {
        retiredRevisionDelta:retiredSource.revision-priorRevision,
        currentSourceUnchanged:source.revision===currentRevision,
        currentPaintsUnchanged:paints===currentPaints,
        currentEventsUnchanged:contentEvents===currentEvents,
        retiredViewRejectsRead:(()=>{
          try
          {
            retiredView.getRegions(0,0,1,1);
            return false;
          }
          catch(error)
          {
            return true;
          }
        })()
      };
    },
    snapshot:()=>
    {
      const visible=lastRendered?.visible||[];
      return {
        mode:$('mode').value,backend:$('backend').value,
        fixture:$('fixture').value,
        firstRow,firstCol,generation,regionReads,
        paints,sourceText:source?.toString(),
        sourceRevision:source?.revision,viewRevision:view?.revision,
        renderedRevision:lastRendered?.revision,
        rowCount:view?.rowCount,
        firstRowWidth:$('fixture').value==='basic'?
          view?.getRowWidth(0):null,
        rawRegions:layers[0]?.getRegions(0,0,1,100)[0],
        regionsByRow:visible,
        selections:view?.getSelections(),lastEvent,
        lastContentEvent,contentEvents,selectionEvents,
        focused:document.activeElement===scroller,
        statusMessage:$('message').textContent,
        domUnits:Array.from(rows.querySelectorAll('.unit'),item=>({
          kind:item.dataset.kind,row:Number(item.dataset.row),
          start:Number(item.dataset.start),end:Number(item.dataset.end),
          text:item.textContent,clipped:item.scrollWidth>item.clientWidth,
          width:item.getBoundingClientRect().width
        })),
        domMarks:Array.from(rows.querySelectorAll('.selection-mark'),item=>({
          row:Number(item.dataset.row),
          start:Number(item.dataset.start),end:Number(item.dataset.end),
          x:item.getBoundingClientRect().x,
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
