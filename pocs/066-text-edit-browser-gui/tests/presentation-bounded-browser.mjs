// Actual compiled *disposable* Cell candidate (same genuine #scanRow),
// real nested/synthetic Document2D views and Chromium heap observations.
// The PoC method is NOT shipped by rumiai-os. This test does not silently
// treat chunked getRegions reads as allocation-free direct production.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const compiled=resolve(
  'rumiai-os/lib/sys/js/core/document2d-candidate.generated.js'
);
const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/presentation.html';
const boundedURL='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/presentation-bounded.js';
const browser=await chromium.launch({
  headless:true,args:['--no-sandbox','--enable-precise-memory-info']
});

async function candidatePage()
{
  const page=await browser.newPage({viewport:{width:1100,height:760}});
  let loaded=0;
  await page.route('**/document2d-browser.generated.js',async route=>
  {
    loaded++;
    await route.fulfill({
      path:compiled,contentType:'application/javascript'
    });
  });
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  await page.waitForFunction(
    ()=>window.__presentationProbe?.snapshot()?.paints>0
  );
  await page.addScriptTag({url:boundedURL});
  assert.equal(loaded,1,'only this browser page uses experimental core');
  return page;
}

function packedEvidence()
{
  const D=window.m.text.document;
  const codec=window.__presentationTransport;
  const bounded=window.__presentationBounded;

  function normalize(rows)
  {
    return rows.map(row=>row.map(record=>[
      record.kind,record.text,record.start.row,record.start.col,
      record.end.row,record.end.col,record.id??null
    ]));
  }

  function check(view,label,rect,chunk)
  {
    const [r0,c0,r1,c1]=rect;
    const baseline=view.getRegions(r0,c0,r1,c1);
    const expected=normalize(baseline);
    const packed=codec.packRows(baseline);
    const partial=bounded.packWindow(view,r0,c0,r1,c1,chunk);
    const unpacked=normalize(codec.unpackRows(partial));
    if(JSON.stringify(unpacked)!==JSON.stringify(expected))
    {
      throw new Error('incremental mismatch '+label+
        ' rect='+JSON.stringify(rect)+' chunk='+chunk+
        ' expected='+JSON.stringify(expected).slice(0,400)+
        ' actual='+JSON.stringify(unpacked).slice(0,400));
    }
    if(JSON.stringify(normalize(codec.unpackRows(packed)))!==
      JSON.stringify(expected))
    {
      throw new Error('existing packed baseline differs '+label);
    }

    return {
      units:baseline.reduce((n,row)=>n+row.length,0),
      packed:packed.reduce((n,row)=>n+row.length,0),
      incremental:partial.reduce((n,row)=>n+row.length,0),
      baselineBytes:JSON.stringify(packed).length,
      incrementalBytes:JSON.stringify(partial).length,
      synthetic:baseline.flat().filter(x=>x.kind!=='text').length
    };
  }

  const stats={
    backends:[],fixtures:[],generic:0,wholeCells:0,notes:0,
    synthetic:0,nonTextKinds:[],oversizeComparisons:0
  };
  const kinds=new Set();
  const fixtures=[
    'A😀Be\u0301\tZ\u0001👩‍💻',
    'A🇮🇹👨‍👩‍👧‍👦क्‍ष\tZ',
    'prefix'+('A😀B\u0301\t👩‍💻Z'.repeat(22))
  ];

  for(const [name,Backend] of [
    ['FlatDocument',D.FlatDocument],
    ['PieceDocument',D.PieceDocument]
  ])
  {
    stats.backends.push(name);
    for(const text of fixtures)
    {
      stats.fixtures.push(name+':'+text.length);
      const physical=new Backend(text+'\nHIDDEN\nTAIL');
      const raw=new D.RawDocument2D(physical);
      const cell=new D.CellDocument2D(raw,4);
      const notes=new D.AnnotationDocument2D(cell);
      const nested=new D.CellDocument2D(notes,4);
      const fold=new D.FoldDocument2D(nested);
      const substitution=new D.SubstitutionDocument2D(nested);

      try
      {
        notes.setAnnotations([
          {id:'note-first',text:'metadata',at:{row:0,col:1}},
          {id:'note-at-eol',text:'last',at:{
            row:0,col:cell.getRowWidth(0)
          }}
        ]);
        fold.setFolds([{startRow:1,endRow:2}]);
        substitution.setSubstitutions([
          {id:'protected',text:'LONG',
            start:{row:0,col:2},end:{row:0,col:3}}
        ]);

        const views=[
          ['cell',cell],['nested',nested],['annotation',notes],
          ['fold',fold],['substitution',substitution]
        ];
        const rects=[
          [0,0,3,48], [0,1,1,33], [0,2,1,3], [0,7,1,68],
          [0,0,1,Math.min(512,cell.getRowWidth(0)+2)]
        ];
        for(const [mode,view] of views)
        {
          for(const rect of rects)
          {
            for(const chunk of [3,16,64])
            {
              const result=check(view,mode,rect,chunk);
              stats.generic++;
              if(result.synthetic) stats.synthetic++;
              if(result.incremental!==result.packed)
              {
                // Chunk runs may legitimately differ in exact record
                // count across a token crossing; decoded units are equal.
                stats.oversizeComparisons++;
              }
              for(const r of view.getRegions(...rect).flat())
              {
                if(r.kind!=='text') kinds.add(r.kind);
              }
            }

            if(typeof view.__pocPackRegions==='function')
            {
              const direct=view.__pocPackRegions(...rect);
              const expected=normalize(view.getRegions(...rect));
              const actual=normalize(codec.unpackRows(direct));
              if(JSON.stringify(actual)!==JSON.stringify(expected))
              {
                throw new Error('direct compiled Cell mismatch '+mode+
                  ' '+JSON.stringify(rect));
              }
              stats.wholeCells++;
            }
          }
        }
        const notesCheck=notes.getRegions(
          0,0,1,cell.getRowWidth(0)+1
        )[0].filter(r=>r.kind==='annotation');
        if(notesCheck.length!==2) throw Error('metadata missing');
        stats.notes+=notesCheck.length;
      }
      finally
      {
        substitution.destroy();
        fold.destroy();
        nested.destroy();
        notes.destroy();
        cell.destroy();
        raw.destroy();
      }
    }
  }
  stats.nonTextKinds=Array.from(kinds).sort();
  if(!stats.nonTextKinds.includes('annotation') ||
    !stats.nonTextKinds.includes('tab') ||
    !stats.nonTextKinds.includes('fold') ||
    !stats.nonTextKinds.includes('substitution'))
  {
    throw Error('synthetic and TAB coverage incomplete');
  }
  return stats;
}

const statsPage=await candidatePage();
let contract;
try
{
  contract=await statsPage.evaluate(packedEvidence);
}
finally {await statsPage.close();}

const result=[];
const modes=['expanded-then-packed','generic-bounded','direct-cell'];
for(const mode of modes)
{
  const page=await candidatePage();
  try
  {
    await page.evaluate(()=>
    {
      const D=window.m.text.document;
      const source=new D.PieceDocument(
        'A😀Be\u0301\tZ\u0001👩‍💻'.repeat(10000)
      );
      const raw=new D.RawDocument2D(source);
      const cell=new D.CellDocument2D(raw,4);
      window.__pocBench={source,raw,cell};
    });

    const session=await page.context().newCDPSession(page);
    await session.send('HeapProfiler.collectGarbage');
    const before=(await session.send('Runtime.getHeapUsage')).usedSize;
    const measured=await page.evaluate(mode=>
    {
      const {source,cell}=window.__pocBench;
      const codec=window.__presentationTransport;
      const bounded=window.__presentationBounded;
      const read=()=>
      {
        if(mode==='direct-cell')
        {
          return cell.__pocPackRegions(0,0,1,512);
        }
        if(mode==='generic-bounded')
        {
          return bounded.packWindow(cell,0,0,1,512,64);
        }
        return codec.packRows(cell.getRegions(0,0,1,512));
      };
      const reference=cell.getRegions(0,0,1,512);
      const expected=JSON.stringify(reference);
      const result=read();
      const unpacked=codec.unpackRows(result);
      if(JSON.stringify(unpacked)!==expected)
      {
        throw Error('benchmark baseline unit mismatch '+mode);
      }
      const outputs=[];
      const times=[];
      for(let i=0;i<24;i++)
      {
        const start=performance.now();
        outputs.push(read());
        times.push(performance.now()-start);
      }
      globalThis.__pocBench.outputs=outputs;
      times.sort((a,b)=>a-b);
      return {
        mode,sourceLength:source.length,repeats:outputs.length,
        samplePackedRegions:result[0].length,
        sampleExpandedRegions:reference[0].length,
        payloadUTF8:new TextEncoder().encode(JSON.stringify(result)).length,
        medianMs:Number(times[12].toFixed(4))
      };
    },mode);
    const beforeGC=(await session.send('Runtime.getHeapUsage')).usedSize;
    await session.send('HeapProfiler.collectGarbage');
    const after=(await session.send('Runtime.getHeapUsage')).usedSize;
    assert.ok(measured.sourceLength>100000);
    result.push({
      ...measured,heapBeforeBytes:before,
      heapBeforeGCBytes:beforeGC,
      heapRetainedDeltaBytes:after-before
    });
    await session.detach();
  }
  finally {await page.close();}
}
await browser.close();

console.log(JSON.stringify({
  status:'PASS',
  nature:'real compiler + disposable modified Cell #scanRow candidate',
  contract,
  measurements:result,
  caveat:'Only direct-cell consumes private scanner without public expanded regions. Generic bounded mode still allocates per-chunk region objects and may rescan Cell from row start; CPU and retained heap not production budgets. No actual product or GUI public API changed.'
}));
