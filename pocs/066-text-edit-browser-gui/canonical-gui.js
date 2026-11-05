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
const actions=new globalThis.CanonicalEditorActions
(
  ()=>view,message=>{$('message').textContent=message;}
);
let drag=null;
let keyboardAnchor=null;
const imeInput=$('ime-input');
let composing=false;
let suppressCompositionInput=false;

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
  actions.attachSource(source);
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
  const rowMaximum=Math.max(0,view.rowCount-VISIBLE_ROWS);
  $('vscroll').max=String(rowMaximum);
  $('vscroll').value=String(Math.min(firstRow,rowMaximum));
  let maximum=0;
  for(let row=painted.rowStart;row<painted.rowEnd;row++)
  {
    maximum=Math.max(maximum,view.getRowWidth(row));
  }
  $('hscroll').max=String(Math.max(0,maximum-VISIBLE_COLS));
  $('hscroll').value=String(firstCol);
  $('undo').disabled=actions.state.undo===0;
  $('redo').disabled=actions.state.redo===0;
  const caret=rows.querySelector('.caret');
  if(caret)
  {
    const box=caret.getBoundingClientRect();
    const root=scroller.getBoundingClientRect();
    imeInput.style.left=(box.left-root.left)+'px';
    imeInput.style.top=(box.top-root.top)+'px';
  }
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
  drag=null;
  keyboardAnchor=null;
  composing=false;
  imeInput.value='';
  $('composition-preview').textContent='';
  const Backend=$('backend').value==='piece'?
    D.PieceDocument:D.FlatDocument;
  compose(Backend,$('mode').value);
  view.selectionMode=$('gesture').value;
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
    'Clic e trascina per selezionare; Colonne per rettangoli, Ctrl+C/V e Ctrl+Z/Y per appunti e cronologia.';
  schedule();
}


// The editor only receives the outermost Document2D. The public visible
// regions declare all legal cell boundaries. The GUI never segments text,
// infers source coordinates or edits the backing physical Document.
function revealCursor(cursor)
{
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

// Snap endpoints to advertised Document2D unit boundaries. Never infer
// Unicode, TAB or source offsets in browser gesture interpretation.
function snap(row,col)
{
  const limit=view.getRowWidth(row);
  const desired=Math.max(0,Math.min(limit,col));
  if(desired===0 || desired===limit) return {row,col:desired};
  const regions=view.getRegions
  (
    row,Math.max(0,desired-1),row+1,desired+1
  )[0].filter(item=>item.kind!=='annotation');
  const interior=regions.find
  (
    item=>item.start.col<desired && item.end.col>desired
  );
  if(interior)
  {
    return {
      row,
      col:desired-interior.start.col<=interior.end.col-desired ?
        interior.start.col:interior.end.col
    };
  }
  return {row,col:desired};
}

function applyGesture(anchor,cursor)
{
  if($('gesture').value!=='rectangle' || anchor.row===cursor.row)
  {
    setRange(anchor,cursor);
    return;
  }
  const first=Math.min(anchor.row,cursor.row);
  const last=Math.max(anchor.row,cursor.row);
  if(last-first>2000) throw new RangeError('Selezione troppo estesa');
  const left=Math.min(anchor.col,cursor.col);
  const right=Math.max(anchor.col,cursor.col);
  const forward=anchor.col<=cursor.col;
  const range=[];
  for(let row=first;row<=last;row++)
  {
    const start=snap(row,left);
    const end=snap(row,right);
    range.push({start,end,forward});
  }
  view.setSelections(range);
  revealCursor(cursor);
}

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
  revealCursor(cursor);
}

function moveCaret(row,col)
{
  const point={row,col};
  keyboardAnchor=null;
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
    const gestureAnchor=keyboardAnchor||anchor;
    keyboardAnchor=gestureAnchor;
    applyGesture(gestureAnchor,cursor);
  }
  else
  {
    moveCaret(cursor.row,cursor.col);
  }
}

function moveVertical(direction,extend=false)
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
      if(extend)
      {
        const anchor=keyboardAnchor||
          (selection.forward?selection.start:selection.end);
        keyboardAnchor=anchor;
        applyGesture(anchor,{row,col});
      }
      else moveCaret(row,col);
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

// Pointer capture preserves a drag while the bounded rows are repainted.
function pointerPoint(event)
{
  const element=document.elementFromPoint(event.clientX,event.clientY);
  if(!(element instanceof Element) || !scroller.contains(element))
  {
    return null;
  }
  const unit=element.closest('.unit');
  if(unit && rows.contains(unit))
  {
    const rect=unit.getBoundingClientRect();
    const row=Number(unit.dataset.row);
    const col=event.clientX-rect.left<rect.width/2 ?
      Number(unit.dataset.start):Number(unit.dataset.end);
    return {row,col};
  }
  const line=element.closest('.row');
  if(line && rows.contains(line))
  {
    const row=Number(line.dataset.row);
    return {row,col:view.getRowWidth(row)};
  }
  return null;
}

function perform(action,label)
{
  try
  {
    const outcome=action();
    if(label) $('message').textContent=label;
    schedule();
    return outcome;
  }
  catch(error)
  {
    $('message').textContent='Operazione respinta: '+error.message;
    schedule();
    return null;
  }
}

scroller.addEventListener('pointerdown',event=>
{
  if(event.button!==0 || !view) return;
  const point=pointerPoint(event);
  if(!point) return;
  event.preventDefault();
  keyboardAnchor=null;
  perform(()=>moveCaret(point.row,point.col));
  drag={id:event.pointerId,anchor:point,last:point};
  scroller.setPointerCapture(event.pointerId);
  imeInput.focus({preventScroll:true});
});
scroller.addEventListener('pointermove',event=>
{
  if(!drag || drag.id!==event.pointerId) return;
  const point=pointerPoint(event);
  if(!point || (point.row===drag.last.row && point.col===drag.last.col))
  {
    return;
  }
  perform(()=>applyGesture(drag.anchor,point));
  drag.last=point;
});
function endDrag(event)
{
  if(!drag || drag.id!==event.pointerId) return;
  drag=null;
  if(scroller.hasPointerCapture(event.pointerId))
  {
    scroller.releasePointerCapture(event.pointerId);
  }
}
scroller.addEventListener('pointerup',endDrag);
scroller.addEventListener('pointercancel',endDrag);
scroller.addEventListener('lostpointercapture',()=>{drag=null;});

$('vscroll').addEventListener('input',()=>
{
  moveWindow(Number($('vscroll').value)-firstRow,0);
});
$('hscroll').addEventListener('input',()=>
{
  moveWindow(0,Number($('hscroll').value)-firstCol);
});

$('gesture').addEventListener('change',()=>
{
  keyboardAnchor=null;
  perform
  (
    ()=>{view.selectionMode=$('gesture').value;},
    $('gesture').value==='rectangle'?'Selezione a colonne':'Selezione lineare'
  );
});

function navigateTo(row,col,extend=false)
{
  const point=snap(row,col);
  const prior=view.getSelections()[0];
  const anchor=keyboardAnchor||
    (prior?.forward?prior.start:prior?.end)||point;
  if(extend)
  {
    keyboardAnchor=anchor;
    applyGesture(anchor,point);
  }
  else moveCaret(point.row,point.col);
}

function deleteSelectedOrPrevious()
{
  const selections=view.getSelections();
  if(selections.some
  (
    item=>item.start.row!==item.end.row ||
      item.start.col!==item.end.col
  ))
  {
    view.insert('');
    return;
  }
  if(selections.length!==1) return;
  const point=selections[0].start;
  if(point.col===0) return;
  const region=view.getRegions
  (
    point.row,point.col-1,point.row+1,point.col
  )[0].find
  (
    item=>item.kind!=='annotation' && item.end.col===point.col
  );
  if(!region) return;
  view.replace
  (
    [{start:region.start,end:region.end,text:''}],view.revision
  );
}

function deleteForward()
{
  const selections=view.getSelections();
  if(selections.some
  (
    item=>item.start.row!==item.end.row ||
      item.start.col!==item.end.col
  ))
  {
    view.insert('');
    return;
  }
  deleteNextVisibleUnit();
}

// The native ClipboardEvent is the primary transport for keyboard shortcuts.
// The custom MIME marks our row-shaped transfer; plain text remains standard.
function transferPayload(event)
{
  const payload=actions.copy($('gesture').value==='rectangle');
  if(!payload || !event.clipboardData) return null;
  event.preventDefault();
  event.clipboardData.setData('text/plain',payload.text);
  if(payload.column)
  {
    event.clipboardData.setData
    (
      'application/x-rumiai-column',
      JSON.stringify({rows:payload.rows})
    );
  }
  return payload;
}
scroller.addEventListener('copy',event=>
{
  const payload=transferPayload(event);
  if(payload) $('message').textContent='Copiate '+payload.rows+' selezioni';
});
scroller.addEventListener('cut',event=>
{
  const payload=transferPayload(event);
  if(!payload) return;
  perform(()=>view.insert(''),'Selezione tagliata');
});
scroller.addEventListener('paste',event=>
{
  if(!event.clipboardData) return;
  event.preventDefault();
  const text=event.clipboardData.getData('text/plain');
  const column=$('gesture').value==='rectangle' ||
    !!event.clipboardData.getData('application/x-rumiai-column');
  perform
  (
    ()=>actions.paste(text,column,$('repeat-paste').checked),
    'Incollato con modifica atomica'
  );
});

$('copy').addEventListener('click',async()=>
{
  try
  {
    const payload=actions.copy($('gesture').value==='rectangle');
    if(!payload) throw new Error('Seleziona del testo');
    await navigator.clipboard.writeText(payload.text);
    $('message').textContent='Copiato negli appunti';
  }
  catch(error)
  {
    $('message').textContent='Appunti non disponibili: '+error.message;
  }
});
$('cut').addEventListener('click',async()=>
{
  try
  {
    const payload=actions.copy($('gesture').value==='rectangle');
    if(!payload) throw new Error('Seleziona del testo');
    await navigator.clipboard.writeText(payload.text);
    perform(()=>view.insert(''),'Selezione tagliata');
  }
  catch(error)
  {
    $('message').textContent='Taglia non riuscito: '+error.message;
  }
});
$('paste').addEventListener('click',async()=>
{
  try
  {
    const text=await navigator.clipboard.readText();
    perform
    (
      ()=>actions.paste
      (
        text,$('gesture').value==='rectangle',
        $('repeat-paste').checked
      ),
      'Incollato'
    );
  }
  catch(error)
  {
    $('message').textContent='Incolla non riuscito: '+error.message;
  }
});
$('undo').addEventListener('click',()=>perform(()=>actions.undo(),'Annullato'));
$('redo').addEventListener('click',()=>perform(()=>actions.redo(),'Ripetuto'));

// IME keeps interim composition outside the source; one final committed
// string becomes one Document2D action on compositionend.
imeInput.addEventListener('compositionstart',()=>
{
  composing=true;
  suppressCompositionInput=false;
  $('composition-preview').textContent='Composizione in corso…';
});
imeInput.addEventListener('compositionupdate',event=>
{
  $('composition-preview').textContent='Composizione: '+event.data;
});
imeInput.addEventListener('compositionend',event=>
{
  composing=false;
  suppressCompositionInput=true;
  const text=event.data||imeInput.value;
  imeInput.value='';
  $('composition-preview').textContent='';
  if(text) perform(()=>view.insert(text),'Testo composto inserito');
  setTimeout(()=>{suppressCompositionInput=false;},0);
});
imeInput.addEventListener('beforeinput',event=>
{
  if(composing) return;
  if(event.inputType?.toLowerCase().includes('composition'))
  {
    event.preventDefault();
    suppressCompositionInput=false;
    return;
  }
  if(event.inputType==='insertText' && event.data)
  {
    event.preventDefault();
    if(suppressCompositionInput)
    {
      suppressCompositionInput=false;
      return; // Browser post-composition text already committed once.
    }
    perform(()=>view.insert(event.data),'Testo inserito');
  }
  else if(event.inputType==='insertFromPaste')
  {
    event.preventDefault(); // The ClipboardEvent owns the paste.
  }
});
imeInput.addEventListener('input',()=>
{
  if(!composing) imeInput.value='';
});

scroller.addEventListener('keydown',event=>
{
  if(!view || event.isComposing || composing) return;

  const modifier=event.ctrlKey || event.metaKey;
  const key=event.key.toLowerCase();
  if(modifier && !event.altKey)
  {
    if(key==='z' || key==='y')
    {
      event.preventDefault();
      perform
      (
        ()=>key==='y'||event.shiftKey?actions.redo():actions.undo(),
        key==='y'||event.shiftKey?'Ripetuto':'Annullato'
      );
      return;
    }
    if(key==='a')
    {
      event.preventDefault();
      perform
      (
        ()=>
        {
          const last=view.rowCount-1;
          setRange({row:0,col:0},{row:last,col:view.getRowWidth(last)});
        },
        'Tutto selezionato'
      );
      return;
    }
    if(!['home','end'].includes(key)) return; // Let native clipboard events fire.
  }
  if(event.altKey && !modifier && (event.key==='1'||event.key==='2'))
  {
    event.preventDefault();
    $('gesture').value=event.key==='2'?'rectangle':'line';
    $('gesture').dispatchEvent(new Event('change'));
    return;
  }
  if(event.altKey) return;

  if(event.key==='ArrowLeft'||event.key==='ArrowRight')
  {
    event.preventDefault();
    perform
    (
      ()=>moveHorizontal(event.key==='ArrowLeft'?-1:1,event.shiftKey)
    );
    return;
  }
  if(event.key==='ArrowDown'||event.key==='ArrowUp')
  {
    event.preventDefault();
    perform
    (
      ()=>moveVertical(event.key==='ArrowDown'?1:-1,event.shiftKey)
    );
    return;
  }
  if(event.key==='Home'||event.key==='End')
  {
    event.preventDefault();
    perform
    (
      ()=>
      {
        const current=view.getSelections()[0];
        if(!current) return;
        const point=current.forward?current.end:current.start;
        const row=modifier?
          (event.key==='Home'?0:view.rowCount-1):point.row;
        const col=event.key==='Home'?0:view.getRowWidth(row);
        navigateTo(row,col,event.shiftKey);
      }
    );
    return;
  }
  if(event.key==='PageDown'||event.key==='PageUp')
  {
    event.preventDefault();
    moveWindow(event.key==='PageDown'?VISIBLE_ROWS:-VISIBLE_ROWS,0);
    return;
  }
  if(event.key==='Delete'||event.key==='Backspace')
  {
    event.preventDefault();
    perform
    (
      ()=>event.key==='Delete'?deleteForward():deleteSelectedOrPrevious(),
      'Modifica eliminazione'
    );
    return;
  }
  if(event.key==='Enter'||event.key==='Tab')
  {
    event.preventDefault();
    perform
    (
      ()=>view.insert(event.key==='Enter'?'\n':'\t'),
      'Carattere di controllo inserito'
    );
    return;
  }
  if(!modifier && event.key.length===1 &&
    !/[\x00-\x1f\x7f]/u.test(event.key))
  {
    event.preventDefault();
    perform(()=>view.insert(event.key),'Inserimento tramite Document2D');
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
      mountedUnits:rows.querySelectorAll('.unit').length,
      history:actions.state,verticalMax:Number($('vscroll').max),
      horizontalMax:Number($('hscroll').max)
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
        gesture:$('gesture').value,history:actions.state,
        lastContentEvent,contentEvents,selectionEvents,
        focused:document.activeElement===scroller ||
          document.activeElement===imeInput,
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
