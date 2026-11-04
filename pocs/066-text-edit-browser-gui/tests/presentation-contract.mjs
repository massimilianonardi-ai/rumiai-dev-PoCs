// PoC-only contract experiments against the compiled real Document2D core.
// DOM rendering uses the same GUI for Raw, Cell, Annotation, Fold, Substitution.
// Benchmark values are measurements, not published product performance claims.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1100,height:760}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/presentation.html';
const sample='A😀Be\u0301\tZ\nHIDDEN\nTAIL';

async function snap()
{
  return page.evaluate(()=>window.__presentationProbe.snapshot());
}

async function setup(mode,backend)
{
  await page.locator('#backend').selectOption(backend);
  await page.locator('#mode').selectOption(mode);
  await page.locator('#reset').click();
  await page.waitForFunction(
    ({mode,backend})=>{
      const value=window.__presentationProbe?.snapshot();
      return value?.mode===mode && value.backend===backend &&
        value.paints>0;
    },{mode,backend}
  );
}

async function waitPaint(previous)
{
  await page.waitForFunction(
    previous=>window.__presentationProbe?.snapshot()?.paints>previous,
    previous
  );
}

try
{
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  await page.waitForFunction(
    ()=>window.__presentationProbe?.snapshot()?.paints>0
  );

  for(const backend of ['flat','piece'])
  {
    for(const mode of ['annotation','fold','substitution'])
    {
      await setup(mode,backend);
      const s=await snap();
      assert.equal(s.sourceText,sample);
      assert.equal(s.sourceRevision,0);
      assert.equal(s.visibleText.length,3);
      assert.deepEqual(s.rendered.filter(r=>r.clipped),[],
        'all visible synthetic/ordinary units fit actual DOM boxes');
      assert.equal(s.annotations.length,1,
        'one zero-width overlay is rendered as metadata');
      assert.equal(s.annotations[0].id,'guide');
      assert.equal(s.annotations[0].start,s.annotations[0].end);
      assert.equal(s.annotations[0].row,0);
      assert.equal(s.regions.filter(r=>r.kind==='annotation').length,1);
      assert.equal(s.regions.filter(r=>r.kind==='text').length>0,true);

      if(mode==='annotation')
      {
        assert.equal(s.visibleText[0],'A😀Be\u0301    Z');
        assert.equal(s.rendered.some(r=>r.kind==='annotation'),false);
        assert.equal(s.visibleText[1],'HIDDEN');
      }
      if(mode==='fold')
      {
        assert.equal(s.visibleText[1],'…');
        assert.equal(s.regionsByRow[1].length,1);
        assert.equal(s.regionsByRow[1][0].kind,'fold');
        assert.equal(s.rendered.filter(r=>r.kind==='fold').length,1);
      }
      if(mode==='substitution')
      {
        const special=s.regions.find(r=>r.kind==='substitution');
        assert.ok(special);
        assert.equal(special.text,'LONG');
        assert.equal(special.end.col-special.start.col,4);
        assert.equal(s.rendered.filter(r=>r.kind==='substitution').length,1);
        assert.ok(s.visibleText[0].includes('LONG'));
        assert.equal(s.sourceText.includes('LONG'),false);
      }

      // One GUI, same public API; no GUI-side edit policy derived from kind.
      if(mode!=='annotation')
      {
        const protectedResult=await page.evaluate(
          ()=>window.__presentationProbe.attemptProtected()
        );
        assert.equal(protectedResult.rejected,true,
          'the implementing document rejects a protected edit');
        assert.equal(protectedResult.unchanged,true,
          'the rejected edit cannot change the physical source');
        assert.equal((await snap()).sourceRevision,0);

        const special=page.locator(
          mode==='fold'?'.unit[data-kind="fold"]':
            '.unit[data-kind="substitution"]'
        );
        const bounding=await special.boundingBox();
        assert.ok(bounding && bounding.width>0);
        await special.click();
        assert.equal((await snap()).sourceText,sample,
          'normal pointer interaction must not edit synthetic text');
      }

      // Visible ordinary text remains editable; all layers observe one
      // physical commit and rebuild the new coordinate-space viewport.
      const before=(await snap()).paints;
      const accepted=await page.evaluate(
        ()=>window.__presentationProbe.allowEdit()
      );
      assert.equal(accepted.previousRevision,0);
      assert.equal(accepted.sourceRevision,1);
      assert.ok(accepted.sourceText.startsWith('Q😀Be\u0301\tZ'));
      await waitPaint(before);
      // A preceding pointer selection can queue its own frame. Require
      // the post-commit view content, not merely any later render count.
      await page.waitForFunction(()=>
      {
        const current=window.__presentationProbe?.snapshot();
        return current?.sourceRevision===1 &&
          current.lastEvent?.invalidation===true &&
          current.rendered.every(region=>
            region.kind!=='fold' && region.kind!=='substitution') &&
          current.annotations.length===0;
      });
      const after=await snap();
      assert.equal(after.sourceRevision,1);
      assert.equal(after.lastEvent.invalidation,true);
      assert.equal(after.sourceText.includes('HIDDEN'),true);
      assert.deepEqual(after.rendered.filter(r=>r.clipped),[]);
      assert.equal(after.rendered.filter(
        r=>r.kind==='fold'||r.kind==='substitution'
      ).length,0,'synthetic regions are invalidated after source edit');
      assert.equal(after.annotations.length,0,
        'source-relative annotation configuration was invalidated');
    }
  }

  // Measure bounded windows on a real 100,000-unit PieceDocument source.
  // Keep median timings descriptive: never assert speed ratios on CI.
  const bench=await page.evaluate(
    ()=>window.__presentationProbe.benchmarkRaw()
  );
  assert.deepEqual(bench.map(r=>r.width),[128,1024,4096]);
  for(const measurement of bench)
  {
    assert.equal(measurement.sourceLength,100000);
    assert.equal(measurement.aggregate.regions,1);
    assert.equal(measurement.expanded.regions,measurement.width);
    assert.equal(measurement.compact.boundaries,measurement.width+1);
    assert.ok(measurement.aggregate.jsonChars<
      measurement.compact.jsonChars);
    assert.ok(measurement.compact.jsonChars<
      measurement.expanded.jsonChars,
      'explicit-boundary serialization is smaller than region objects');
    for(const name of ['aggregate','expanded','compact'])
    {
      assert.ok(Number.isFinite(measurement[name].medianMs));
      assert.ok(measurement[name].medianMs>=0);
    }
  }
  assert.deepEqual(errors,[]);

  console.log(JSON.stringify({
    pass:true,
    product:'jsc-compiled Document2D + PoC presentation proxy',
    synthetic:['annotation','whole-row fold','occupied substitution'],
    backends:['FlatDocument','PieceDocument'],
    assertions:['same renderer','zero-width overlays',
      'source-less protected edits reject atomically',
      'source unchanged by rendering','allowed edit commits once',
      'full invalidation after editing','visible DOM glyphs not clipped'],
    benchmark:{
      host:'GitHub-hosted Ubuntu 24.04 x64 Chromium',
      kind:'bounded 100k-line-length descriptive median of 9 iterations',
      caveat:'jsonChars are serialized characters, not actual heap bytes',
      measurements:bench
    }
  }));
}
finally
{
  await browser.close();
}
