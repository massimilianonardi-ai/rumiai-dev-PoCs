// G04: real Chromium bounded 2D paging through the unmodified compiled
// Document2D core; no monkey-patched view, transport or whole-document DOM.
import assert from 'node:assert/strict';
import {launchTestChromium} from './browser-launch.mjs';

const browser=await launchTestChromium();
const page=await browser.newPage({viewport:{width:1150,height:780}});
page.setDefaultTimeout(45000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/canonical-gui.html';

function viewport()
{
  return page.evaluate
  (
    ()=>window.__canonicalGuiProbe.viewport()
  );
}

function snapshot()
{
  return page.evaluate
  (
    ()=>window.__canonicalGuiProbe.snapshot()
  );
}

async function settle(fixture,backend,row,col)
{
  await page.waitForFunction
  (
    ({fixture,backend,row,col})=>
    {
      const s=window.__canonicalGuiProbe?.viewport();
      return s?.fixture===fixture && s?.firstRow===row &&
        s.firstCol===col && s.renderedRevision===s.viewRevision &&
        s.renderedGeneration===s.generation &&
        s.renderWindow?.rowStart===row &&
        s.renderWindow?.colStart===col &&
        s.paints>0 && s.mountedRows>0;
    },
    {fixture,backend,row,col}
  );
  const s=await viewport();
  assert.ok(s.mountedRows<=3);
  assert.ok(s.renderWindow.rowEnd-s.renderWindow.rowStart<=3);
  assert.equal(s.renderWindow.colEnd-s.renderWindow.colStart,100);
  return s;
}

async function reset(backend,fixture)
{
  await page.locator('#backend').selectOption(backend);
  await page.locator('#fixture').selectOption(fixture);
  await page.locator('#mode').selectOption('cell');
  await page.locator('#reset').click();
  await settle(fixture,backend,0,0);
}

async function wheel(delta,shift=false)
{
  const box=await page.locator('#scroller').boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x+Math.min(35,box.width/2),box.y+24);
  if(shift) await page.keyboard.down('Shift');
  try
  {
    await page.mouse.wheel(0,delta);
  }
  finally
  {
    if(shift) await page.keyboard.up('Shift');
  }
}

function assertGeometry(s)
{
  const published=s.regionsByRow.flat()
    .filter(x=>x.kind!=='annotation');
  assert.deepEqual
  (
    s.domUnits.map(x=>[x.kind,x.row,x.start,x.end]),
    published.map(x=>[
      x.kind,x.start.row,x.start.col,x.end.col
    ])
  );
  assert.deepEqual(s.domUnits.filter(x=>x.clipped),[]);
  assert.equal(s.domUnits.length,published.length);
}

try
{
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  const results=[];

  for(const backend of ['flat','piece'])
  {
    await reset(backend,'long');
    let s=await snapshot();
    assert.equal(s.rowCount,1);
    assert.ok(s.sourceText.length>100000);
    assert.equal(s.domUnits.length<=102,true);
    assert.equal(s.rawRegions.length,1,'Raw stays aggregated');
    assertGeometry(s);

    // Actual Shift + wheel pages 100 cell columns at a time. Whole
    // graphemes/TABs crossing window edges must not be truncated.
    await wheel(80,true);
    await settle('long',backend,0,100);
    s=await snapshot();
    assert.equal(s.firstCol,100);
    assert.ok(s.domUnits.length<=102);
    assert.ok(s.domUnits.some(x=>x.text==='👩‍💻'));
    assert.ok(s.domUnits.some(x=>x.kind==='tab'));
    assertGeometry(s);
    const edge=s.regionsByRow[0].filter(x=>x.kind!=='annotation');
    assert.ok(edge[0].start.col<=100 && edge[0].end.col>100,
      'whole first region must intersect requested first column');

    await wheel(240,true);
    await settle('long',backend,0,400);
    s=await snapshot();
    assertGeometry(s);
    assert.ok(s.domUnits.length<=102);
    const nextUnit=page.locator('.unit').first();
    const box=await nextUnit.boundingBox();
    assert.ok(box);
    await nextUnit.click
    (
      {position:{x:box.width-2,y:box.height/2}}
    );
    await page.waitForFunction
    (
      ()=>window.__canonicalGuiProbe?.snapshot()?.focused===true
    );
    s=await snapshot();
    const oldLen=s.sourceText.length;
    const oldPaint=s.paints;
    await page.keyboard.type('Q');
    await page.waitForFunction
    (
      oldPaint=>
      {
        const s=window.__canonicalGuiProbe?.viewport();
        return s?.viewRevision===1 &&
          s.renderedRevision===1 && s.paints>oldPaint;
      },
      oldPaint
    );
    s=await snapshot();
    assert.equal(s.sourceText.length,oldLen+1);
    assert.equal(s.sourceRevision,1);
    assert.equal(s.contentEvents,1);
    assert.equal(s.lastContentEvent?.invalidation,true);
    assertGeometry(s);

    await wheel(-150,true);
    await settle('long',backend,0,200);
    s=await snapshot();
    assertGeometry(s);
    results.push({
      backend,fixture:'long',sourceLength:s.sourceText.length,
      rowCount:s.rowCount,visibleRows:1,maxObservedUnits:102,
      scrolledTo:400,sourceRevision:s.sourceRevision
    });

    await reset(backend,'many');
    s=await snapshot();
    assert.equal(s.rowCount,1200);
    assert.equal(s.domUnits.length<100,true,
      'three visible short rows only');
    assert.equal(s.domUnits.filter(x=>x.row>2).length,0);

    // Real wheel pages rows; no giant placeholder list is mounted.
    await wheel(101);
    await settle('many',backend,6,0);
    s=await snapshot();
    assert.equal(s.regionsByRow.length,3);
    assert.deepEqual(Array.from(new Set(s.domUnits.map(x=>x.row))),[6,7,8]);
    assertGeometry(s);

    await wheel(11100);
    await settle('many',backend,339,0);
    s=await snapshot();
    assert.deepEqual(Array.from(new Set(s.domUnits.map(x=>x.row))),[339,340,341]);
    assert.ok(s.domUnits.length<100);
    assertGeometry(s);

    await page.locator('#scroller').focus();
    await page.keyboard.press('PageDown');
    await settle('many',backend,342,0);
    await page.keyboard.press('PageUp');
    await settle('many',backend,339,0);

    const first=page.locator('.unit[data-row="339"]').first();
    const rect=await first.boundingBox();
    assert.ok(rect);
    await first.click({position:{x:rect.width-2,y:rect.height/2}});
    await page.waitForFunction
    (
      ()=>window.__canonicalGuiProbe?.snapshot()?.domCaret[0]?.row===339
    );
    const before=await snapshot();
    const beforeLine=before.sourceText.split('\n')[339];
    assert.equal(beforeLine.startsWith('row-0339'),true);
    await page.keyboard.type('Q');
    await page.waitForFunction
    (
      ()=>window.__canonicalGuiProbe?.snapshot()?.sourceRevision===1
    );
    s=await snapshot();
    assert.equal(s.contentEvents,1);
    assert.equal(s.sourceRevision,1);
    assert.equal(s.sourceText.split('\n')[339],beforeLine[0]+'Q'+beforeLine.slice(1));
    assert.equal(s.firstRow,339);
    assertGeometry(s);

    // Reconfigure while old viewport work may be queued: only current
    // generation may paint and the old physical source cannot notify it.
    await wheel(400);
    await page.locator('#fixture').selectOption('basic');
    await settle('basic',backend,0,0);
    s=await snapshot();
    assert.equal(s.sourceText,'A😀Be\u0301\tZ👩‍💻\nHIDDEN\nTAIL');
    assert.equal(s.sourceRevision,0);
    assert.equal(s.regionsByRow.length,3);
    assertGeometry(s);
    const retiring=await page.evaluate
    (
      ()=>window.__canonicalGuiProbe.mutateRetiredSource()
    );
    assert.ok(retiring);
    assert.equal(retiring.retiredRevisionDelta,1);
    assert.equal(retiring.currentSourceUnchanged,true);
    assert.equal(retiring.currentPaintsUnchanged,true);
    assert.equal(retiring.currentEventsUnchanged,true);
    assert.equal(retiring.retiredViewRejectsRead,true);

    const stable=await viewport();
    await page.evaluate
    (
      ()=>new Promise(resolve=>requestAnimationFrame(
        ()=>requestAnimationFrame(resolve)
      ))
    );
    const after=await viewport();
    assert.equal(after.paints,stable.paints,
      'retired document cannot repaint new configuration');
    assert.equal(after.generation,stable.generation);
    assert.equal(after.renderedGeneration,after.generation);
    results.push({
      backend,fixture:'many',rows:1200,visibleRows:3,
      scrolledTo:342,finalRevision:1,retiredDetached:true
    });
  }

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({
    status:'PASS',scope:'G04 canonical bounded 2D viewport lifecycle',
    results,
    limits:'logical wheel/page navigation only; full scrollbars, IME, arbitrary anchors and physical host remain open'
  }));
}
finally
{
  await page.close();
  await browser.close();
}
