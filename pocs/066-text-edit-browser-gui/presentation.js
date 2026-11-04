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
const mixed='A😀Be\u0301\tZ\u0001👩‍💻';
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
    if(code===0x200d) return 'ZWJ';
    if(code===0x200c) return 'ZWNJ';
    if(code===0x200b) return 'ZWSP';
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
            if(region.kind==='text' && region.text.length===1 &&
              /[\x00-\x1f\x7f]/u.test(region.text))
            {
              return [{...region,displayText:display(region.text)}];
            }
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

// Document-side wire-format experiment. A transport choice changes only
// the public getRegions payload, not physical data or selection ownership.
function prototypeCompact(input)
{
  return new Proxy(input,
  {
    get(target,key)
    {
      if(key==='getRegions')
      {
        return (...args)=>globalThis.__presentationTransport.packRows(
          target.getRegions(...args)
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

// GUI decoding depends solely on explicitly supplied unit boundaries.
// There is no Unicode segmentation, raw/cell recognition or source access.
// Direct compact presentation only for the real aggregated Raw adapter.
function prototypeRawDirect(input)
{
  return new Proxy(input,
  {
    get(target,key)
    {
      if(key==='getRegions')
      {
        return (...args)=>globalThis.__presentationDirect.packRawRows(
          target.getRegions(...args)
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

function readRegions(...args)
{
  return globalThis.__presentationTransport.unpackRows(
    view.getRegions(...args)
  );
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
  const mode=$('mode').value;
  const directOption=$('transport').querySelector('[value="direct"]');
  directOption.disabled=mode!=='raw';
  if(mode!=='raw' && $('transport').value==='direct')
  {
    $('transport').value='compact';
  }
  const Backend=$('backend').value==='piece'?D.PieceDocument:D.FlatDocument;
  const text=$('fixture').value==='mixed'?mixed:original;
  source=new Backend(
    ['fold','substitution','annotation'].includes(mode)?
      text+'\nHIDDEN\nTAIL':text
  );
  const raw=new D.RawDocument2D(source);
  layers.push(raw);
  const rawPresented=prototypeRegions(raw,true);
  view=rawPresented;

  if(mode!=='raw')
  {
    const cell=new D.CellDocument2D(rawPresented,4);
    layers.push(cell);
    view=cell;
    if(mode==='nested')
    {
      const nested=new D.CellDocument2D(cell,4);
      layers.push(nested);
      view=nested;
    }
    if(['annotation','fold','substitution'].includes(mode))
    {
      const notes=new D.AnnotationDocument2D(view);
      layers.push(notes);
      notes.setAnnotations([
        {id:'guide',text:'nota non modificabile',at:{row:0,col:1}}
      ]);
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
      const substitute=new D.SubstitutionDocument2D(view);
      layers.push(substitute);
      substitute.setSubstitutions([
        {id:'protected',text:'LONG',
          start:{row:0,col:2},end:{row:0,col:3}}
      ]);
      view=substitute;
    }
    view=prototypeRegions(view,false);
  }
  if($('transport').value==='compact') view=prototypeCompact(view);
  if($('transport').value==='direct') view=prototypeRawDirect(raw);

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
  const rowCount=Math.min(view.rowCount,3);
  const regionRows=readRegions(0,0,rowCount,100);
  const selections=view.getSelections();
  const fragment=document.createDocumentFragment();

  for(let row=0;row<rowCount;row++)
  {
    const element=document.createElement('div');
    element.className='row';
    element.dataset.row=String(row);
    const content=document.createElement('div');
    content.className='content';
    content.dataset.row=String(row);
    const style=getComputedStyle(rows);
    metrics.font=style.fontSize+' '+style.fontFamily;
    const measured=[];
    const annotations=[];

    for(const region of regionRows[row]||[])
    {
      if(region.kind==='annotation')
      {
        annotations.push(region);
        continue;
      }
      const text=region.displayText??region.text;
      const width=Math.ceil(Math.max(
        (region.end.col-region.start.col)*MIN_CELL,
        metrics.measureText(text).width+8
      ));
      const span=document.createElement('span');
      span.className='unit';
      span.dataset.kind=region.kind;
      span.dataset.row=String(row);
      span.dataset.start=String(region.start.col);
      span.dataset.end=String(region.end.col);
      span.title=Array.from(region.text).map(
        c=>'U+'+c.codePointAt(0).toString(16).toUpperCase()
      ).join(' ');
      span.style.width=width+'px';
      span.textContent=text;
      content.appendChild(span);
      measured.push({span,start:region.start.col,end:region.end.col});
    }

    element.appendChild(content);
    fragment.appendChild(element);
    element.__measurement={measured,annotations};
  }

  rows.replaceChildren(fragment);
  for(const element of Array.from(rows.children))
  {
    const row=Number(element.dataset.row);
    const content=element.querySelector('.content');
    const {measured,annotations}=element.__measurement;
    delete element.__measurement;
    // DOM fallback fonts may exceed canvas estimates, particularly emoji.
    // Establish actual pixel advances before drawing caret/overlay anchors.
    const boundaries=new Map([[0,0]]);
    let pixel=0;
    for(const item of measured)
    {
      if(item.span.scrollWidth>item.span.clientWidth)
      {
        item.span.style.width=(item.span.scrollWidth+8)+'px';
      }
      boundaries.set(item.start,pixel);
      pixel+=item.span.getBoundingClientRect().width;
      boundaries.set(item.end,pixel);
    }

    for(const region of annotations)
    {
      const anchor=boundaries.get(region.start.col);
      if(anchor===undefined) continue;
      const indicator=document.createElement('span');
      indicator.className='annotation';
      indicator.dataset.id=region.id;
      indicator.dataset.row=String(row);
      indicator.dataset.start=String(region.start.col);
      indicator.dataset.end=String(region.end.col);
      indicator.title=region.text;
      indicator.textContent='●';
      indicator.style.left=anchor+'px';
      content.appendChild(indicator);
    }

    for(const selection of selections)
    {
      const point=selection.forward?selection.end:selection.start;
      if(point.row!==row || !boundaries.has(point.col)) continue;
      const indicator=document.createElement('span');
      indicator.className='caret';
      indicator.style.left=boundaries.get(point.col)+'px';
      content.appendChild(indicator);
    }
  }
  paints++;
  $('status').textContent=
    'Colonne: '+view.getRowWidth(0)+' · Regioni riga 1: '+
    (regionRows[0]?.length||0)+' · Righe: '+view.rowCount+
    ' · Revisione: '+revision+' · Render: '+paints;
}

function schedule()
{
  if(scheduled) return;
  scheduled=true;
  requestAnimationFrame(render);
}

function caret(row,col)
{
  const point={row,col};
  view.setSelections([{start:point,end:{...point},forward:true}]);
  schedule();
}

scroller.addEventListener('click',event=>
{
  const unit=event.target.closest('.unit');
  if(!unit) return;
  const rectangle=unit.getBoundingClientRect();
  const row=Number(unit.dataset.row);
  const col=Number(
    event.clientX-rectangle.left < rectangle.width/2 ?
      unit.dataset.start : unit.dataset.end
  );
  try
  {
    caret(row,col);
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
    const point=selection.forward?selection.end:selection.start;
    const col=point.col;
    const row=point.row;
    const boundaries=[0,...readRegions(row,0,row+1,100)[0].flatMap(
      region=>[region.start.col,region.end.col]
    )].filter((value,index,list)=>list.indexOf(value)===index)
      .sort((a,b)=>a-b);
    const candidate=event.key==='ArrowLeft'?
      boundaries.filter(x=>x<col).at(-1):
      boundaries.find(x=>x>col);
    if(candidate!==undefined)
    {
      try { caret(row,candidate); }
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
$('transport').addEventListener('change',configure);
$('fixture').addEventListener('change',configure);
$('mode').addEventListener('change',configure);
$('reset').addEventListener('click',configure);

// Diagnostic observation is separate from the GUI renderer. It reads the
// physical source only to verify that display placeholders never mutate data.
globalThis.__presentationProbe=Object.freeze(
{
  allowEdit:()=>
  {
    const before=source.revision;
    view.replace(
      [{start:{row:0,col:0},end:{row:0,col:1},text:'Q'}],
      view.revision
    );
    return {previousRevision:before,sourceRevision:source.revision,
      sourceText:source.toString()};
  },
  attemptProtected:()=>
  {
    const row=$('mode').value==='fold'?1:0;
    const region=readRegions(row,0,row+1,100)[0].find(
      region=>region.kind==='fold'||region.kind==='substitution'
    );
    if(!region) return null;
    const before=source.toString();
    const sourceRevision=source.revision;
    let rejected=false;
    let error='';
    try
    {
      view.replace(
        [{start:region.start,end:region.end,text:'X'}],
        view.revision
      );
    }
    catch(failure)
    {
      rejected=true;
      error=failure.message;
    }
    return {
      rejected,error,
      unchanged:source.toString()===before && source.revision===sourceRevision,
      region
    };
  },
  compareZWJ:()=>
  {
    // Diagnostic ONLY: compare the shipped aggregated Raw input with the
    // proposed one-code-unit-per-region input, under the same real Cell.
    const original='A😀Be\u0301\tZ\u0001👩‍💻';
    const physical=new D.PieceDocument(original);
    const raw=new D.RawDocument2D(physical);
    const ordinary=new D.CellDocument2D(raw,4);
    const projected=new D.CellDocument2D(prototypeRegions(raw,true),4);
    const read=doc=>doc.getRegions(0,0,1,100)[0].map(region=>({
      kind:region.kind,text:region.text,
      start:region.start.col,end:region.end.col
    }));
    try
    {
      return {
        source:physical.toString(),
        standard:read(ordinary),
        atomized:read(projected),
        unicodeGraphemes:Array.from(
          new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(original),
          segment=>segment.segment
        )
      };
    }
    finally
    {
      projected.destroy();
      ordinary.destroy();
      raw.destroy();
    }
  },
  benchmarkMixed:()=>
  {
    const pattern='A😀Be\u0301\tZ\u0001👩‍💻क';
    const text=pattern.repeat(7000);
    const physical=new D.PieceDocument(text);
    const raw=new D.RawDocument2D(physical);
    const rawUnits=prototypeRegions(raw,true);
    const cell=new D.CellDocument2D(rawUnits,4);
    const codec=globalThis.__presentationTransport;
    const enc=new TextEncoder();
    const measures=[];
    const median=fn=>
    {
      for(let i=0;i<2;i++) fn();
      const timings=[];
      for(let i=0;i<7;i++)
      {
        const start=performance.now();
        fn();
        timings.push(performance.now()-start);
      }
      return Number(timings.sort((a,b)=>a-b)[3].toFixed(4));
    };
    try
    {
      for(const [mode,input] of [['raw',rawUnits],['cell',cell]])
      {
        for(const width of [128,512,2048])
        {
          // A bounded read from the same large real source. Record one
          // transport window, not the entire source or a full DOM viewport.
          const read=()=>input.getRegions(0,128,1,128+width);
          const regions=read();
          const compact=codec.packRows(regions);
          const restored=codec.unpackRows(compact);
          const identity=entries=>entries.map(row=>row.map(item=>[
            item.kind,item.text,item.start.row,item.start.col,
            item.end.row,item.end.col,item.displayText??item.text,
            item.id??null
          ]));
          if(JSON.stringify(identity(restored))!==
            JSON.stringify(identity(regions)))
          {
            throw new Error('compact mixed-unicode roundtrip differs');
          }
          const normalJSON=JSON.stringify(regions);
          const compactJSON=JSON.stringify(compact);
          measures.push({
            mode,width,sourceUTF16Length:text.length,
            unitCount:regions[0].length,packedCount:compact[0].length,
            expandedChars:normalJSON.length,packedChars:compactJSON.length,
            expandedUTF8:enc.encode(normalJSON).length,
            packedUTF8:enc.encode(compactJSON).length,
            readMedianMs:median(read),
            packMedianMs:median(()=>codec.packRows(regions)),
            unpackMedianMs:median(()=>codec.unpackRows(compact))
          });
        }
      }
      return measures;
    }
    finally
    {
      cell.destroy();
      raw.destroy();
    }
  },
  benchmarkDirect:(mode,width,repeats=16)=>
  {
    if(!['aggregate','expanded','packed','direct'].includes(mode) ||
      !Number.isSafeInteger(width) || width<1 || width>4096 ||
      !Number.isSafeInteger(repeats) || repeats<1 || repeats>64)
    {
      throw new RangeError('invalid direct benchmark request');
    }
    const pattern='A😀Be\u0301\tZ\u0001👩‍💻क';
    const physical=new D.PieceDocument(pattern.repeat(70000));
    const raw=new D.RawDocument2D(physical);
    const units=prototypeRegions(raw,true);
    const window=[0,4096,1,4096+width];
    const aggregate=()=>raw.getRegions(...window);
    const expanded=()=>units.getRegions(...window);
    const packed=()=>globalThis.__presentationTransport.packRows(expanded());
    const direct=()=>globalThis.__presentationDirect.packRawRows(aggregate());
    const methods={aggregate,expanded,packed,direct};
    const normalized=rows=>globalThis.__presentationTransport
      .unpackRows(rows)[0].map(r=>[
        r.text,r.start.col,r.end.col,r.displayText??r.text
      ]);
    const reference=normalized(expanded());
    if(mode!=='aggregate' &&
      JSON.stringify(normalized(methods[mode]()))!==JSON.stringify(reference))
    {
      raw.destroy();
      throw new Error('direct compact presentation does not match Raw units');
    }
    const results=[];
    const durations=[];
    for(let i=0;i<repeats;i++)
    {
      const before=performance.now();
      results.push(methods[mode]());
      durations.push(performance.now()-before);
    }
    // Retain result objects so CDP can measure their post-GC heap.
    globalThis.__directBenchmarkRetained={physical,raw,results};
    durations.sort((a,b)=>a-b);
    const sample=results[0];
    return {
      mode,width,repeats,sourceUTF16Length:physical.length,
      outputRegions:sample[0].length,
      payloadUTF8:new TextEncoder().encode(JSON.stringify(sample)).length,
      medianMs:durations[Math.floor(durations.length/2)]
    };
  },
  benchmarkRaw:()=>
  {
    // Diagnostic benchmark only: real RawDocument2D on a long physical
    // PieceDocument, identical bounded viewport windows for all candidates.
    const length=100000;
    const physical=new D.PieceDocument('x'.repeat(length));
    const raw=new D.RawDocument2D(physical);
    const unitView=prototypeRegions(raw,true);
    const start=8192;
    const widths=[128,1024,4096];
    const measure=(fn)=>
    {
      for(let i=0;i<3;i++) fn();
      const samples=[];
      for(let i=0;i<9;i++)
      {
        const startTime=performance.now();
        fn();
        samples.push(performance.now()-startTime);
      }
      samples.sort((a,b)=>a-b);
      return Number(samples[4].toFixed(4));
    };
    try
    {
      return widths.map(width=>
      {
        const end=start+width;
        const aggregate=()=>raw.getRegions(0,start,1,end)[0];
        const expanded=()=>unitView.getRegions(0,start,1,end)[0];
        // Experimental format candidate: exact run plus explicit unit
        // boundary offsets. The GUI would consume supplied boundaries,
        // never discover them by Unicode segmentation or implementation ID.
        const compact=()=>
        {
          const region=aggregate()[0];
          return {
            kind:region.kind,text:region.text,start:region.start,
            end:region.end,
            boundaries:Array.from(
              {length:region.text.length+1},(_,index)=>index
            )
          };
        };
        const rawRegions=aggregate();
        const singleRegions=expanded();
        const packed=compact();
        if(rawRegions.map(x=>x.text).join('')!==
           singleRegions.map(x=>x.text).join('') ||
           packed.text!==rawRegions[0].text ||
           singleRegions.length!==width ||
           packed.boundaries.length!==width+1)
        {
          throw new Error('benchmark input views are not equivalent');
        }
        return {
          width,
          sourceLength:length,
          aggregate:{regions:rawRegions.length,
            jsonChars:JSON.stringify(rawRegions).length,
            medianMs:measure(aggregate)},
          expanded:{regions:singleRegions.length,
            jsonChars:JSON.stringify(singleRegions).length,
            medianMs:measure(expanded)},
          compact:{regions:1,boundaries:packed.boundaries.length,
            jsonChars:JSON.stringify(packed).length,
            medianMs:measure(compact)}
        };
      });
    }
    finally
    {
      raw.destroy();
    }
  },
  chunkBoundary:()=>
  {
    const originalChunk='a'.repeat(2047)+'e\u0301B';
    const chunkSource=new D.PieceDocument(originalChunk);
    const chunkRaw=new D.RawDocument2D(chunkSource);
    const chunkCell=new D.CellDocument2D(prototypeRegions(chunkRaw,true));
    try
    {
      return {
        source:chunkSource.toString(),
        regions:chunkCell.getRegions(0,2047,1,2048)[0],
        rect:chunkCell.getRect(0,2047,1,2048)[0],
        rowWidth:chunkCell.getRowWidth(0)
      };
    }
    finally
    {
      chunkCell.destroy();
      chunkRaw.destroy();
    }
  },
  snapshot:()=>({
    mode:$('mode').value,backend:$('backend').value,
    transport:$('transport').value,fixture:$('fixture').value,
    sourceText:source.toString(),sourceRevision:source.revision,
    viewRevision:view.revision,
    rect:view.getRect(0,0,1,100)[0],
    regions:readRegions(0,0,1,100)[0],
    compactPayload:view.getRegions(0,0,Math.min(3,view.rowCount),100),
    visibleText:view.getRect(0,0,Math.min(3,view.rowCount),100),
    regionsByRow:readRegions(0,0,Math.min(3,view.rowCount),100),
    selections:view.getSelections(),
    rendered:Array.from(rows.querySelectorAll('.unit')).map(element=>({
      row:Number(element.dataset.row),
      text:element.textContent,
      start:Number(element.dataset.start),end:Number(element.dataset.end),
      kind:element.dataset.kind,
      clipped:element.scrollWidth>element.clientWidth+1,
      scrollWidth:element.scrollWidth,clientWidth:element.clientWidth
    })),
    annotations:Array.from(rows.querySelectorAll('.annotation')).map(e=>({
      id:e.dataset.id,row:Number(e.dataset.row),
      start:Number(e.dataset.start),end:Number(e.dataset.end),
      label:e.title
    })),
    carets:Array.from(rows.querySelectorAll('.caret')).map(e=>({
      row:Number(e.closest('.row').dataset.row),left:e.style.left
    })),
    paints,lastEvent,
    message:$('message').textContent
  })
});
configure();
})();