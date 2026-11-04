// Actual Chromium consumer of the PoC-only compact Document2D region payload.
// Tests the same GUI with explicit vs compact payload; no product API changed.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1100,height:760}});
page.setDefaultTimeout(20000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/presentation.html';
const normalize=region=>[
  region.kind,region.text,region.start.row,region.start.col,
  region.end.row,region.end.col,region.displayText??region.text,
  region.id??null
];

async function configure({mode,backend,fixture,transport})
{
  await page.locator('#backend').selectOption(backend);
  await page.locator('#fixture').selectOption(fixture);
  await page.locator('#mode').selectOption(mode);
  await page.locator('#transport').selectOption(transport);
  await page.locator('#reset').click();
  await page.waitForFunction(
    params=>{
      const current=window.__presentationProbe?.snapshot();
      return current?.mode===params.mode &&
        current.backend===params.backend &&
        current.fixture===params.fixture &&
        current.transport===params.transport && current.paints>0;
    },{mode,backend,fixture,transport}
  );
  return page.evaluate(()=>window.__presentationProbe.snapshot());
}

function comparable(snapshot)
{
  return {
    sourceText:snapshot.sourceText,
    sourceRevision:snapshot.sourceRevision,
    visibleText:snapshot.visibleText,
    regions:snapshot.regionsByRow.map(row=>row.map(normalize)),
    rendered:snapshot.rendered,
    annotations:snapshot.annotations,
    carets:snapshot.carets,
    selections:snapshot.selections
  };
}

try
{
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  await page.waitForFunction(
    ()=>window.__presentationProbe?.snapshot()?.paints>0
  );

  let compared=0;
  for(const backend of ['flat','piece'])
  {
    for(const fixture of ['basic','mixed'])
    {
      for(const mode of ['raw','cell','nested','annotation','fold','substitution'])
      {
        const params={backend,fixture,mode};
        const explicit=await configure({...params,transport:'expanded'});
        const compact=await configure({...params,transport:'compact'});
        assert.deepEqual(comparable(compact),comparable(explicit),
          'same GUI and exposed units: '+JSON.stringify(params));
        assert.deepEqual(compact.rendered.filter(r=>r.clipped),[],
          'no clipped glyphs '+JSON.stringify(params));
        assert.ok(compact.compactPayload.flat().some(r=>
          r.kind==='text' && Array.isArray(r.cells)),
          'compact payload must really be presented to the GUI');
        const packed=compact.compactPayload.flat().filter(r=>r.cells);
        for(const region of packed)
        {
          assert.equal(region.cells.at(-1)[0],
            region.end.col-region.start.col);
          assert.equal(region.cells.at(-1)[1],region.text.length);
        }

        if(fixture==='mixed' && mode==='raw')
        {
          assert.ok(compact.regions.some(r=>r.text==='\u200d'),
            'raw source exposes a distinct ZWJ unit');
          assert.ok(compact.rendered.some(r=>r.text==='ZWJ'));
          assert.ok(compact.regions.some(r=>r.text==='\u0001'));
          assert.ok(compact.rendered.some(r=>r.text==='·'),
            'control character is represented without source mutation');
        }
        if(fixture==='mixed' && mode!=='raw')
        {
          assert.ok(compact.regions.some(r=>r.text==='👩‍💻'),
            'cell keeps multi-code-point emoji indivisible');
        }
        if(mode==='fold'||mode==='substitution')
        {
          const attempted=await page.evaluate(
            ()=>window.__presentationProbe.attemptProtected()
          );
          assert.equal(attempted.rejected,true);
          assert.equal(attempted.unchanged,true);
          const after=await page.evaluate(
            ()=>window.__presentationProbe.snapshot()
          );
          assert.equal(after.sourceText,compact.sourceText);
          assert.equal(after.sourceRevision,0);
        }
        if(['annotation','fold','substitution'].includes(mode))
        {
          assert.equal(compact.annotations.length,1);
          assert.equal(compact.annotations[0].start,
            compact.annotations[0].end);
          assert.ok(compact.compactPayload.flat().some(
            r=>r.kind==='annotation'),
            'metadata must retain its own record');
        }
        compared++;
      }
    }

    // Genuine browser focus, pointer hit-testing, arrows, selection-driven
    // insert and invalidation with compact payload (no diagnostic caret call).
    const params={backend,fixture:'mixed',mode:'cell',transport:'compact'};
    const before=await configure(params);
    const emoji=page.locator('.unit').nth(1);
    const rect=await emoji.boundingBox();
    assert.ok(rect && rect.width>2);
    await emoji.click({position:{x:rect.width-2,y:rect.height/2}});
    let after=await page.evaluate(
      ()=>window.__presentationProbe.snapshot()
    );
    assert.equal(after.selections[0].end.col,2);
    await page.keyboard.press('ArrowLeft');
    after=await page.evaluate(()=>window.__presentationProbe.snapshot());
    assert.equal(after.selections[0].end.col,1);
    await page.keyboard.press('ArrowRight');
    after=await page.evaluate(()=>window.__presentationProbe.snapshot());
    assert.equal(after.selections[0].end.col,2);
    await page.keyboard.type('X');
    await page.waitForFunction(
      ()=>window.__presentationProbe?.snapshot()?.sourceRevision===1
    );
    after=await page.evaluate(()=>window.__presentationProbe.snapshot());
    assert.equal(after.sourceText,
      before.sourceText.slice(0,3)+'X'+before.sourceText.slice(3));
    assert.ok(after.lastEvent.invalidation);
    assert.ok(after.rendered.some(r=>r.text==='👩‍💻'));
    assert.deepEqual(after.rendered.filter(r=>r.clipped),[]);
  }

  // Pure transport decoder rejects invalid/inconsistent advertised extents,
  // rather than silently discovering new Unicode breakpoints.
  const negative=await page.evaluate(()=>
  {
    try
    {
      window.__presentationTransport.unpackRows([[
        {kind:'text',text:'😀',start:{row:0,col:0},
          end:{row:0,col:1},cells:[[1,1]]}
      ]]);
      return false;
    }
    catch(error) {return error instanceof RangeError;}
  });
  assert.equal(negative,true,'invalid boundary payload must be rejected');

  const measurements=await page.evaluate(
    ()=>window.__presentationProbe.benchmarkMixed()
  );
  assert.equal(measurements.length,6);
  for(const measurement of measurements)
  {
    assert.ok(measurement.sourceUTF16Length>=100000);
    assert.ok(measurement.unitCount>=measurement.packedCount);
    assert.ok(measurement.packedChars<measurement.expandedChars);
    assert.ok(measurement.packedUTF8<measurement.expandedUTF8);
    for(const name of ['readMedianMs','packMedianMs','unpackMedianMs'])
    {
      assert.ok(Number.isFinite(measurement[name]));
      assert.ok(measurement[name]>=0);
    }
  }
  assert.deepEqual(errors,[]);

  console.log(JSON.stringify({
    pass:true,
    nature:'real Chromium + genuine compiled Document2D, experimental compact getRegions',
    combinations:compared,
    modes:['raw','cell','nested','annotation','fold','substitution'],
    backends:['FlatDocument','PieceDocument'],
    fixtures:['basic','mixed Unicode with TAB and control + ZWJ'],
    verified:['expanded/compact DOM parity','explicit unit boundaries',
      'no Unicode parsing in renderer','synthetic labels and overlays',
      'protected edits atomic','mouse+arrow+insert','source preserved',
      'bad boundaries rejected'],
    benchmark:{
      description:'real 100k+ UTF16 PieceDocument; bounded mixed Unicode windows',
      caveat:'descriptive median durations; JSON chars/UTF8 bytes are not heap memory',
      measurements
    }
  }));
}
finally
{
  await browser.close();
}
