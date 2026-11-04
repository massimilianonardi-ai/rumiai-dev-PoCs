// G02: genuine pointer/keyboard events against canonical, unpatched
// Raw->Cell Document2D; no text proxy, transport codec or fake core.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch
(
  {headless:true,args:['--no-sandbox']}
);
const page=await browser.newPage({viewport:{width:1100,height:760}});
page.setDefaultTimeout(20000);

const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/canonical-gui.html';
const original='A😀Be\u0301\tZ👩‍💻\nHIDDEN\nTAIL';
const edited='A😀XBe\u0301\tZ👩‍💻\nHIDDEN\nTAIL';

function probe()
{
  return page.evaluate
  (
    ()=>window.__canonicalGuiProbe.snapshot()
  );
}

async function waitCaret(col,row=0)
{
  await page.waitForFunction
  (
    ({row,col})=>
    {
      const s=window.__canonicalGuiProbe?.snapshot();
      return s?.renderedRevision===s.viewRevision &&
        s.domCaret.length===1 &&
        s.domCaret[0].row===row && s.domCaret[0].col===col;
    },
    {row,col}
  );
  const s=await probe();
  assert.equal(s.selections.length,1);
  assert.deepEqual(s.selections[0].start,{row,col});
  assert.deepEqual(s.selections[0].end,{row,col});
  return s;
}

async function reset(backend,mode='cell')
{
  await page.locator('#backend').selectOption(backend);
  await page.locator('#mode').selectOption(mode);
  await page.locator('#reset').click();
  await page.waitForFunction
  (
    ({backend,mode})=>
    {
      const s=window.__canonicalGuiProbe?.snapshot();
      return s?.backend===backend && s.mode===mode &&
        s.paints>0 && s.sourceRevision===0 &&
        s.renderedRevision===s.viewRevision &&
        s.domCaret.length===1 && s.domCaret[0].col===0;
    },
    {backend,mode}
  );
}

async function clickEnd(selector,side)
{
  const unit=page.locator(selector).first();
  const box=await unit.boundingBox();
  assert.ok(box && box.width>4,'actual unit has measurable width');
  await unit.click
  (
    {position:{
      x:side==='left'?2:box.width-2,
      y:box.height/2
    }}
  );
}

const results=[];
try
{
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);

  for(const backend of ['flat','piece'])
  {
    await reset(backend);

    const emoji='.unit[data-kind="text"]:text-is("😀")';
    const combining='.unit[data-kind="text"]:text-is("e\u0301")';
    const zwj='.unit[data-kind="text"]:text-is("👩‍💻")';
    const tab='.unit[data-kind="tab"]';

    await clickEnd(emoji,'right');
    let s=await waitCaret(2);
    assert.equal(s.focused,true,'real click focuses editor');
    assert.equal(s.sourceRevision,0);

    await page.keyboard.press('ArrowLeft');
    s=await waitCaret(1);
    assert.equal(s.sourceText,original);
    await page.keyboard.press('ArrowRight');
    await waitCaret(2);

    await clickEnd(emoji,'left');
    await waitCaret(1);
    await clickEnd(combining,'left');
    await waitCaret(3);
    await clickEnd(combining,'right');
    await waitCaret(4);

    await clickEnd(tab,'left');
    await waitCaret(4);
    await clickEnd(tab,'right');
    await waitCaret(8);
    await page.keyboard.press('ArrowLeft');
    await waitCaret(4);
    await page.keyboard.press('ArrowRight');
    await waitCaret(8);

    const invalid=await page.evaluate
    (
      ()=>window.__canonicalGuiProbe.attemptSelectionAt(0,5)
    );
    assert.equal(invalid.rejected,true,
      'interior TAB boundary is not a valid Document2D selection');
    assert.ok(invalid.reason);
    assert.equal(invalid.selectionUnchanged,true);
    assert.equal(invalid.revisionUnchanged,true);
    assert.equal(invalid.sourceUnchanged,true);

    await clickEnd(zwj,'left');
    await waitCaret(9);
    await clickEnd(zwj,'right');
    await waitCaret(10);
    await page.keyboard.press('ArrowLeft');
    await waitCaret(9);
    await page.keyboard.press('ArrowRight');
    await waitCaret(10);

    s=await probe();
    assert.equal(s.sourceText,original);
    assert.equal(s.viewRevision,0,
      'selection navigation must not change coordinate revision');
    assert.equal(s.contentEvents,0);
    const beforePaint=s.paints;

    await clickEnd(emoji,'right');
    await waitCaret(2);
    await page.keyboard.type('X');
    await page.waitForFunction
    (
      previous=>
      {
        const s=window.__canonicalGuiProbe?.snapshot();
        return s?.sourceRevision===1 &&
          s.contentEvents===1 && s.paints>previous &&
          s.renderedRevision===s.viewRevision;
      },
      beforePaint
    );
    s=await probe();
    assert.equal(s.sourceText,edited,
      'one typed key commits exactly one physical source edit');
    assert.equal(s.sourceRevision,1);
    assert.equal(s.viewRevision,1);
    assert.equal(s.contentEvents,1);
    assert.equal(s.lastContentEvent?.type,'content');
    assert.equal(s.lastContentEvent?.invalidation,true);
    assert.ok(s.domUnits.some(u=>u.text==='X'));
    assert.deepEqual(s.domUnits.filter(u=>u.clipped),[],
      'real Unicode/TAB DOM remains unclipped after edit');
    assert.equal(s.domCaret.length,1);
    assert.deepEqual(s.domCaret[0],{row:0,col:3},
      'caret advances to boundary after inserted text');
    results.push({
      backend,sourceRevision:s.sourceRevision,
      viewRevision:s.viewRevision,contentEvents:s.contentEvents,
      selectionEvents:s.selectionEvents,finalCaret:s.domCaret[0],
      painted:s.paints
    });
  }

  // The same handler must accept a composed Cell->Annotation view without
  // interpreting the annotation as editable text or reading source offsets.
  for(const backend of ['flat','piece'])
  {
    await reset(backend,'annotation');
    await clickEnd('.unit[data-kind="text"]:text-is("😀")','right');
    await waitCaret(2);
    await page.keyboard.type('K');
    await page.waitForFunction
    (
      ()=>window.__canonicalGuiProbe?.snapshot()?.sourceRevision===1
    );
    const s=await probe();
    assert.equal(s.sourceText,original.replace('😀','😀K'));
    assert.equal(s.contentEvents,1);
  }

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({
    status:'PASS',scope:'G02 canonical GUI real Chromium input',
    variants:results,
    composition:'Annotation with real edit on Flat/Piece',
    pending:'G03 protected fold/substitution; G04 scrolling, IME, physical host'
  }));
}
finally
{
  await page.close();
  await browser.close();
}
