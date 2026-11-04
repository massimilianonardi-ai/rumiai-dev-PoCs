// Real headless Chromium integration: jsc-compiled Document2D -> DOM.
// The old TextEdit 0.8.2 browser GUI remains independently verified.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch
(
  {headless:true,args:['--no-sandbox']}
);
const page=await browser.newPage({viewport:{width:1120,height:760}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const base='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/document2d.html';

async function snap()
{
  return page.evaluate(()=>window.__document2dGuiProbe.snapshot());
}

async function paintedAfter(previous)
{
  await page.waitForFunction
  (
    count=>window.__document2dGuiProbe?.snapshot()?.paints>count,
    previous
  );
}

async function kind(name,backend)
{
  await page.locator('#backend').selectOption(backend);
  await page.locator('#kind').selectOption(name);
  await page.locator('#reset').click();
  await page.waitForFunction
  (
    params=>
    {
      const s=window.__document2dGuiProbe?.snapshot();
      return s && s.kind===params.name && s.backend===params.backend &&
        s.paints>0;
    },
    {name,backend}
  );
}

try
{
  const response=await page.goto(base,{waitUntil:'load'});
  assert.equal(response.status(),200);
  await page.waitForFunction
  (
    ()=>window.__document2dGuiProbe?.snapshot()?.mounted>0
  );

  for(const backend of ['flat','piece'])
  {
    await kind('fold',backend);
    let s=await snap();
    assert.equal(s.rowCount,2);
    assert.equal(s.sourceRevision,0);
    assert.ok(s.visibleText[0].includes('…'));
    assert.ok(s.renderedRows.some(r=>
      r.regions.some(region=>region.kind==='fold')));
    assert.ok(s.renderedRows.some(r=>r.annotations>0),
      'source-less overlay must remain visible in a surviving row');
    assert.ok(s.mounted<25 && s.maxMounted<25);

    // Real DOM selection through public Document2D. No second owner.
    let previous=s.paints;
    await page.evaluate(()=>window.__document2dGuiProbe.caret(1,2));
    await paintedAfter(previous);
    s=await snap();
    assert.deepEqual(s.selections[0].start,{row:1,col:2});
    assert.ok(s.renderedRows.some(r=>r.row===1 && r.carets>0));

    // A prohibited marker interval cannot commit a physical source edit.
    const sourceBefore=s.sourceText;
    previous=s.paints;
    await page.locator('#blocked').click();
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,0);
    assert.equal(s.sourceText,sourceBefore);
    assert.ok(s.message.includes('Modifica respinta'));
    assert.ok(s.renderedRows.some(r=>
      r.regions.some(region=>region.kind==='fold')));

    // A valid displayed row edit uses the same public API and one commit.
    previous=s.paints;
    await page.locator('#allowed').click();
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,1);
    assert.ok(s.sourceText.startsWith('Q\tB😀C'));
    assert.equal(s.rowCount,4);
    assert.equal(s.lastEvent.invalidation.all,true);
    assert.ok(s.lastEvent.geometry,'the proven visible edit exposes geometry');
    assert.deepEqual(s.lastEvent.geometry.edits[0].old.start,{row:0,col:0});
    assert.equal(s.renderedRows.some(r=>
      r.regions.some(region=>region.kind==='fold')),false);
    assert.ok(s.invalidations>=1 && s.mounted===4);
    assert.ok(s.selections.length>0);
    assert.ok(s.renderedRows.some(r=>r.carets>0));

    // Reset and exercise ordinary keyboard input through the rendered view.
    await page.locator('#reset').click();
    await page.waitForFunction(()=>window.__document2dGuiProbe.snapshot()?.paints>0);
    await page.evaluate(()=>window.__document2dGuiProbe.caret(1,2));
    await page.locator('#scroller').focus();
    previous=(await snap()).paints;
    await page.keyboard.type('Z');
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,1);
    assert.ok(s.sourceText.includes('TAZIL'));
    assert.equal(s.lastEvent.invalidation.all,true);
    assert.equal(s.rowCount,4);

    // An external change inside hidden content never fabricates old view
    // geometry. Fold configuration is cleared and viewport re-reads source.
    await page.locator('#reset').click();
    await page.waitForFunction(()=>window.__document2dGuiProbe.snapshot()?.paints>0);
    previous=(await snap()).paints;
    await page.locator('#outside').click();
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,1);
    assert.equal(s.lastEvent.invalidation.all,true);
    assert.equal(s.lastEvent.geometry,null);
    assert.equal(s.rowCount,4);
    assert.equal(s.renderedRows.some(r=>
      r.regions.some(region=>region.kind==='fold')),false);

    // Overlay-only revision changes cannot masquerade as physical edits.
    await page.locator('#reset').click();
    await page.waitForFunction(()=>window.__document2dGuiProbe.snapshot()?.paints>0);
    previous=(await snap()).paints;
    await page.locator('#note').click();
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,0);
    assert.equal(s.lastEvent.geometry,null);
    assert.equal(s.lastEvent.invalidation.all,true);
    assert.equal(s.rowCount,4);

    await kind('substitution',backend);
    s=await snap();
    assert.equal(s.rowCount,2);
    assert.ok(s.visibleText[0].includes('LONG'));
    assert.equal(s.renderedRows[0].regions.filter(r=>
      r.kind==='substitution').length,2);

    previous=s.paints;
    await page.locator('#blocked').click();
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,0);
    assert.ok(s.message.includes('Modifica respinta'));
    assert.equal(s.renderedRows[0].regions.filter(r=>
      r.kind==='substitution').length,2);

    previous=s.paints;
    await page.locator('#allowed').click();
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,1);
    assert.ok(s.sourceText.includes('DZ'));
    assert.equal(s.lastEvent.invalidation.all,true);
    assert.deepEqual
    (
      s.lastEvent.geometry.edits[0].old.start,{row:0,col:10}
    );
    assert.deepEqual
    (
      s.lastEvent.geometry.edits[0].new.start,{row:0,col:8}
    );
    assert.equal(s.renderedRows[0].regions.filter(r=>
      r.kind==='substitution').length,0);

    await page.locator('#reset').click();
    await page.waitForFunction(()=>window.__document2dGuiProbe.snapshot()?.paints>0);
    previous=(await snap()).paints;
    await page.locator('#outside').click();
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,1);
    assert.equal(s.lastEvent.geometry,null);
    assert.equal(s.lastEvent.invalidation.all,true);
    assert.equal(s.renderedRows[0].regions.filter(r=>
      r.kind==='substitution').length,0);

    await page.locator('#reset').click();
    await page.waitForFunction(()=>window.__document2dGuiProbe.snapshot()?.paints>0);
    previous=(await snap()).paints;
    await page.locator('#note').click();
    await paintedAfter(previous);
    s=await snap();
    assert.equal(s.sourceRevision,0);
    assert.equal(s.lastEvent.geometry,null);
    assert.equal(s.lastEvent.invalidation.all,true);
    assert.equal(s.renderedRows[0].regions.filter(r=>
      r.kind==='substitution').length,0);
    assert.ok(s.maxMounted<25);
  }

  assert.deepEqual(errors,[],'browser runtime exceptions');
  console.log(JSON.stringify
  (
    {
      pass:true,
      product:'jsc-compiled m.text.document',
      backends:['FlatDocument','PieceDocument'],
      scenarios:[
        'initial real-core paint','zero-width annotations',
        'caret from public Document2D','protected-fold rejection',
        'single atomic source edit','postcommit full viewport redraw',
        'keyboard input','hidden-source conservative invalidation',
        'annotation-only invalidation','occupied substitution rejection',
        'substitution width-changing endpoint geometry',
        'separate physical backends'
      ]
    }
  ));
}
finally
{
  await browser.close();
}
