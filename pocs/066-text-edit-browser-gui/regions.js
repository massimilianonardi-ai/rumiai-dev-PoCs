/* Experimental 2D visual regions over the real, unchanged TextEdit 0.8.2.
 * Only TextEdit owns document content and effective physical selections.
 * This prototype does NOT introduce a product API or a second selection store.
 */
(function()
{
  'use strict';

  const API=globalThis.TextEdit;
  const $=id=>document.getElementById(id);
  if(!API||API.VERSION!=='0.8.2')
  {
    $('warning').textContent='TextEdit 0.8.2 non disponibile.';
    return;
  }

  const model=globalThis.__regionGeometryPoC;
  if(!model)
  {
    $('warning').textContent='Modulo sperimentale geometria 2D non disponibile.';
    return;
  }

  const CELL=29;
  const LINE=38;
  const COLUMNS=18;
  const SAMPLE='A\tB\nfold alpha\nfold beta\nfold gamma\n0123456789\nuvwxyzABCD';
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const policyControls={
    tab:$('tab-policy'),
    fold:$('fold-policy'),
    annotation:$('annotation-policy')
  };
  let editor=null;
  let regions=[];
  let visualRows=[];
  let requested=null;
  let direction={horizontal:true,vertical:true};
  let selected=[];
  let dragging=null;

  function buildRegions()
  {
    const projection=model.buildRegions
    (
      editor.document,
      editor.representation,
      {
        columns:COLUMNS,
        policies:
        {
          tab:policyControls.tab.value,
          fold:policyControls.fold.value,
          annotation:policyControls.annotation.value
        }
      }
    );
    regions=projection.regions;
    visualRows=projection.visualRows;
    const grid=$('grid');
    grid.style.width=(COLUMNS*CELL)+'px';
    grid.style.height=(visualRows.length*LINE)+'px';
    for(const id of ['start-row','end-row'])
      $(id).max=String(Math.max(0,visualRows.length-1));
  }

  function publishPhysical(effective)
  {
    editor.selections.setSelections
    (
      model.physicalSelections(editor.document,effective,direction)
    );
  }

  function select(a,b)
  {
    const maxRow=visualRows.length-1;
    for(const point of [a,b])
    {
      if(!Number.isSafeInteger(point.row)||!Number.isSafeInteger(point.col)||
         point.row<0||point.row>maxRow||point.col<0||point.col>=COLUMNS)
        throw new RangeError('selection point outside the visual grid');
    }
    direction={horizontal:a.col<=b.col,vertical:a.row<=b.row};
    requested=model.clippedRectangle(a,b);
    $('input-result').textContent='';
    selected=model.selectRegions(regions,requested);
    publishPhysical(selected);
    render();
    return snapshot();
  }

  function showRegion(r,selectedIds)
  {
    const element=document.createElement('div');
    element.className='region '+r.kind+(selectedIds.has(r.id)?' selected':'');
    element.dataset.regionId=r.id;
    element.style.left=(r.col*CELL)+'px';
    element.style.top=(r.row*LINE)+'px';
    element.style.width=(r.width*CELL)+'px';
    element.style.height=(r.height*LINE)+'px';
    element.textContent=r.label;
    element.title=r.kind+' | '+r.policy+' | '+(r.source?
      '['+r.source.start+','+r.source.end+')':'nessun intervallo sorgente');
    return element;
  }

  function updateInputStatus()
  {
    // Every retained physical caret remains editable regardless of which
    // high-level selection constructor originally produced it.
    const physicalCount=editor.selections.getSelections().length;
    const inputCount=$('replacement-array').value.split(/\r\n|\r|\n/).length;
    $('apply').disabled=physicalCount===0;
    $('apply-array').disabled=physicalCount===0;
    if(physicalCount===0)
    {
      $('input-status').textContent=selected.length?
        'Elementi visuali selezionati: '+selected.length+
        ', ma nessun intervallo sorgente modificabile.':
        'Nessuna selezione fisica: seleziona una o più celle collegate al testo prima di sostituire.';
    }
    else
    {
      $('input-status').textContent='Selezioni fisiche: '+physicalCount+
        ' · elementi array: '+inputCount+
        (physicalCount===inputCount?' · array pronto.':
          ' · per l’array serve un valore per ciascuna selezione.');
    }
  }

  function render()
  {
    updateInputStatus();
    const grid=$('grid');
    const fragment=document.createDocumentFragment();
    const selectedIds=new Set(selected.map(item=>item.id));
    for(const r of regions)fragment.append(showRegion(r,selectedIds));
    grid.replaceChildren(fragment);

    const snap=snapshot();
    $('summary').textContent=
      'Richiesta: '+JSON.stringify(snap.requested)+'\n'+
      'Elementi selezionati: '+snap.selected.join(', ')+'\n'+
      'Selezioni fisiche TextEdit: '+JSON.stringify(snap.physical)+'\n'+
      'Revision: '+snap.revision+'\n'+
      'Documento: '+JSON.stringify(snap.text);
  }

  function snapshot()
  {
    const doc=editor.document;
    return {
      version:API.VERSION,
      text:doc.toString(),
      revision:doc.revision,
      requested:requested?{...requested}:null,
      direction:{...direction},
      reverseHorizontal:$('reverse-horizontal').checked,
      selected:selected.map(item=>item.id),
      physical:editor.selections.getSelections(),
      regions:regions.map(r=>({
        id:r.id,kind:r.kind,row:r.row,col:r.col,width:r.width,
        height:r.height,source:r.source?{...r.source}:null,
        policy:r.policy,selected:selected.some(item=>item.id===r.id)
      })),
      visualRows:visualRows.length,
      sourceRows:doc.lineCount,
      replacements:editor.representation.replacements,
      annotations:editor.representation.annotations
    };
  }

  function reset()
  {
    if(editor)editor.dispose();
    editor=new API.TextEdit(SAMPLE);
    editor.representation.setColumnMetrics({tabSize:4,widthOf:()=>1});
    const doc=editor.document;
    editor.representation.setReplacements([{
      start:doc.lineStart(1),end:doc.lineStart(4),
      text:'[3 folded rows]'
    }]);
    editor.representation.setAnnotations([{
      id:'info',at:doc.lineStart(4),text:'ℹ nota',affinity:'after'
    }]);
    requested=null;
    direction={horizontal:true,vertical:true};
    selected=[];
    $('warning').textContent='';
    $('input-result').textContent='';
    buildRegions();
    editor.selections.setSelections([]);
    render();
  }

  function reverseLineGraphemes(text)
  {
    const pieces=text.split(/(\r\n|\r|\n)/);
    for(let i=0;i<pieces.length;i+=2)
      pieces[i]=Array.from(segmenter.segment(pieces[i]),item=>item.segment).reverse().join('');
    return pieces.join('');
  }

  function replace(value)
  {
    const physical=editor.selections.getSelections();
    if(!physical.length)
    {
      $('warning').textContent='Nessun testo sorgente selezionato: nessuna modifica.';
      return {changed:false,revision:editor.document.revision};
    }
    const texts=Array.isArray(value)?value:physical.map(()=>value);
    if(texts.length!==physical.length)
      throw new RangeError('Occorre un valore per ogni selezione fisica, nell’ordine attuale.');
    const reverse=$('reverse-horizontal').checked;
    const payloads=[];
    for(let i=0;i<texts.length;i++)
    {
      const text=texts[i];
      if(typeof text!=='string')
      {
        throw new TypeError('Testo sostitutivo non valido.');
      }
      payloads.push(reverse&&!physical[i].forward?reverseLineGraphemes(text):text);
    }

    // The only commit path remains the real selected TextEdit facade.
    editor.replace(payloads);
    requested=null;
    selected=[];
    $('warning').textContent='';
    buildRegions();
    render();
    $('input-result').textContent='Sostituzione eseguita su '+physical.length+
      ' selezione/i · revisione sorgente '+editor.document.revision+'.';
    return {changed:true,revision:editor.document.revision};
  }

  function cellAt(event)
  {
    const bounds=$('grid').getBoundingClientRect();
    const col=Math.floor((event.clientX-bounds.left)/CELL);
    const row=Math.floor((event.clientY-bounds.top)/LINE);
    return {
      row:Math.max(0,Math.min(visualRows.length-1,row)),
      col:Math.max(0,Math.min(COLUMNS-1,col))
    };
  }

  $('grid').addEventListener('pointerdown',event=>
  {
    if(event.button!==0||!visualRows.length)return;
    const point=cellAt(event);
    dragging={id:event.pointerId,start:point};
    $('grid').setPointerCapture(event.pointerId);
    select(point,point);
    event.preventDefault();
  });
  $('grid').addEventListener('pointermove',event=>
  {
    if(!dragging||dragging.id!==event.pointerId)return;
    select(dragging.start,cellAt(event));
  });
  function stopDrag(event)
  {
    if(!dragging||dragging.id!==event.pointerId)return;
    select(dragging.start,cellAt(event));
    dragging=null;
  }
  $('grid').addEventListener('pointerup',stopDrag);
  $('grid').addEventListener('pointercancel',event=>
  {
    if(dragging&&dragging.id===event.pointerId)dragging=null;
  });

  for(const key of Object.keys(policyControls))
    policyControls[key].addEventListener('change',()=>
    {
      buildRegions();
      if(requested)
      {
        selected=model.selectRegions(regions,requested);
        publishPhysical(selected);
      }
      render();
    });

  $('select-range').addEventListener('click',()=>
  {
    const point=(row,col)=>({row:Number($(row).value),col:Number($(col).value)});
    try
    {
      select(point('start-row','start-col'),point('end-row','end-col'));
      $('warning').textContent='';
    }
    catch(error){$('warning').textContent=error.message;}
  });
  $('reset').addEventListener('click',reset);
  function applyText()
  {
    try
    {
      replace($('replacement').value);
    }
    catch(error)
    {
      $('warning').textContent=error.message;
    }
  }
  function applyArray()
  {
    try
    {
      replace($('replacement-array').value.split(/\r\n|\r|\n/));
    }
    catch(error)
    {
      $('warning').textContent=error.message;
    }
  }
  $('replacement-array').addEventListener('input',updateInputStatus);
  $('apply').addEventListener('click',applyText);
  $('apply-array').addEventListener('click',applyArray);

  reset();

  // Experimental observability: not part of the product TextEdit API.
  window.__regionsProbe={
    snapshot,
    select,
    reset,
    replace,
    setPolicy(kind,policy)
    {
      const control=policyControls[kind];
      if(!control||!['none','touch','full'].includes(policy))
        throw new RangeError('invalid region policy');
      control.value=policy;
      control.dispatchEvent(new Event('change'));
      return snapshot();
    },
    cellPoint(row,col)
    {
      const bounds=$('grid').getBoundingClientRect();
      return {x:bounds.left+(col+.5)*CELL,y:bounds.top+(row+.5)*LINE};
    }
  };
})();
