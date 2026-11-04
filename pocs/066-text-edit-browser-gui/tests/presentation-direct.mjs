// Real Chromium/real RawDocument2D experimental direct compact benchmark.
// Post-GC heap is retained JS heap, NOT peak allocation or process RSS.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({
  headless:true,args:['--no-sandbox','--enable-precise-memory-info']
});
const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/presentation.html';
const modes=['aggregate','expanded','packed','direct'];
const results=[];
try
{
  for(const width of [128,2048,4096])
  {
    for(const mode of modes)
    {
      // Isolation makes a pre/post-GC heap delta interpretable.
      const page=await browser.newPage({viewport:{width:1100,height:760}});
      try
      {
        const response=await page.goto(url,{waitUntil:'load'});
        assert.equal(response.status(),200);
        await page.waitForFunction(
          ()=>window.__presentationProbe?.snapshot()?.paints>0
        );
        const session=await page.context().newCDPSession(page);
        await session.send('HeapProfiler.collectGarbage');
        const before=(await session.send('Runtime.getHeapUsage')).usedSize;
        const sample=await page.evaluate(
          args=>window.__presentationProbe.benchmarkDirect(
            args.mode,args.width,24
          ),{mode,width}
        );
        await session.send('HeapProfiler.collectGarbage');
        const after=(await session.send('Runtime.getHeapUsage')).usedSize;
        assert.ok(Number.isFinite(before) && Number.isFinite(after));
        assert.ok(sample.sourceUTF16Length>=100000);
        assert.ok(sample.payloadUTF8>0);
        if(mode==='expanded') assert.ok(sample.outputRegions>=width);
        else assert.ok(sample.outputRegions<=2);
        results.push({
          width,mode,retainedWindows:sample.repeats,
          outputRegions:sample.outputRegions,
          payloadUTF8:sample.payloadUTF8,
          heapBeforeBytes:before,heapAfterBytes:after,
          retainedHeapDeltaBytes:after-before,
          medianMs:Number(sample.medianMs.toFixed(4))
        });
        await session.detach();
      }
      finally {await page.close();}
    }
  }

  // Same actual GUI renderer for explicit, expanded-then-packed and direct.
  const page=await browser.newPage({viewport:{width:1100,height:760}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try
  {
    const response=await page.goto(url,{waitUntil:'load'});
    assert.equal(response.status(),200);
    await page.locator('#backend').selectOption('piece');
    await page.locator('#fixture').selectOption('mixed');
    await page.locator('#mode').selectOption('raw');
    const comparable=[];
    for(const choice of ['expanded','compact','direct'])
    {
      await page.locator('#transport').selectOption(choice);
      await page.waitForFunction(
        choice=>{
          const s=window.__presentationProbe?.snapshot();
          return s?.transport===choice && s.paints>0;
        },choice
      );
      const s=await page.evaluate(()=>window.__presentationProbe.snapshot());
      assert.deepEqual(s.rendered.filter(unit=>unit.clipped),[]);
      comparable.push({
        choice,sourceText:s.sourceText,sourceRevision:s.sourceRevision,
        units:s.regions.map(r=>[
          r.kind,r.text,r.start.col,r.end.col,r.displayText??r.text
        ]),
        dom:s.rendered.map(r=>[r.text,r.start,r.end,r.kind]),
        mountedUnits:await page.locator('#rows .unit').count(),
        mountedRows:await page.locator('#rows .row').count()
      });
    }
    for(const item of comparable.slice(1))
    {
      assert.deepEqual(item.units,comparable[0].units);
      assert.deepEqual(item.dom,comparable[0].dom);
      assert.equal(item.mountedUnits,comparable[0].mountedUnits);
      assert.equal(item.mountedRows,comparable[0].mountedRows);
    }
    // A source longer than 100000 UTF-16 units must still only mount
    // the current 100-column GUI viewport, identically in all transports.
    await page.locator('#fixture').selectOption('long');
    const longComparable=[];
    for(const choice of ['expanded','compact','direct'])
    {
      await page.locator('#transport').selectOption(choice);
      await page.waitForFunction(
        choice=>{
          const s=window.__presentationProbe?.snapshot();
          return s?.fixture==='long' && s.transport===choice && s.paints>0;
        },choice
      );
      const s=await page.evaluate(()=>window.__presentationProbe.snapshot());
      assert.ok(s.sourceText.length>=100000);
      const mountedUnits=await page.locator('#rows .unit').count();
      const mountedRows=await page.locator('#rows .row').count();
      assert.equal(mountedUnits,100);
      assert.equal(mountedRows,1);
      assert.deepEqual(s.rendered.filter(unit=>unit.clipped),[]);
      longComparable.push({
        choice,mountedUnits,mountedRows,
        units:s.regions.map(r=>[
          r.kind,r.text,r.start.col,r.end.col,r.displayText??r.text
        ]),
        dom:s.rendered.map(r=>[r.text,r.start,r.end,r.kind])
      });
    }
    for(const item of longComparable.slice(1))
    {
      assert.deepEqual(item.units,longComparable[0].units);
      assert.deepEqual(item.dom,longComparable[0].dom);
    }
    await page.locator('#fixture').selectOption('mixed');
    await page.waitForFunction(
      ()=>window.__presentationProbe?.snapshot()?.fixture==='mixed' &&
        window.__presentationProbe.snapshot().paints>0
    );
    await page.locator('#transport').selectOption('direct');
    await page.locator('.unit').nth(2).click();
    await page.locator('#scroller').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('Q');
    await page.waitForFunction(
      ()=>window.__presentationProbe.snapshot().sourceRevision===1
    );
    const edited=await page.evaluate(()=>window.__presentationProbe.snapshot());
    assert.ok(edited.sourceText.includes('Q'));
    assert.equal(edited.lastEvent.invalidation,true);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({
      status:'PASS',scope:'candidate direct Raw producer + unchanged DOM GUI',
      comparisons:results,
      gui:comparable.map(({choice,mountedUnits,mountedRows})=>({
        choice,mountedUnits,mountedRows
      })),
      guiLong:longComparable.map(({choice,mountedUnits,mountedRows})=>({
        choice,mountedUnits,mountedRows
      })),
      caveat:'Post-GC retained Chromium JS heap for 24 windows; not peak allocations, RSS or physical-host evidence. Timings uncalibrated.'
    }));
  }
  finally {await page.close();}
}
finally {await browser.close();}
