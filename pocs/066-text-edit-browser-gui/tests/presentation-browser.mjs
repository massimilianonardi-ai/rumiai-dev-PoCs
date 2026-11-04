// Real compiled Document2D + real Chromium.
// A PoC-only document-side getRegions projection explores presentation
// semantics; success does NOT claim that production RawDocument2D has changed.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1100,height:760}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const base='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/presentation.html';
const sample='A😀Be\u0301\tZ';

async function snapshot()
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
      const probe=window.__presentationProbe;
      if(!probe) return false;
      const s=probe.snapshot();
      return s.mode===mode && s.backend===backend && s.paints>0;
    },
    {mode,backend}
  );
}

async function waitForRevision(revision)
{
  await page.waitForFunction(
    revision=>window.__presentationProbe?.snapshot()?.sourceRevision===revision,
    revision
  );
}

try
{
  const response=await page.goto(base,{waitUntil:'load'});
  assert.equal(response.status(),200);
  await page.waitForFunction(
    ()=>window.__presentationProbe?.snapshot()?.paints>0
  );

  for(const backend of ['flat','piece'])
  {
    for(const mode of ['raw','cell','nested'])
    {
      await setup(mode,backend);
      const s=await snapshot();
      assert.equal(s.sourceText,sample,'real source must remain unchanged');
      assert.equal(s.sourceRevision,0);
      assert.equal(s.regions.length,mode==='raw'?8:6);
      assert.equal(s.rendered.length,s.regions.length);
      assert.ok(s.rendered.every(r=>!r.clipped),'no rendered unit clipped');
      assert.equal(s.selections[0].start.col,0);

      if(mode==='raw')
      {
        assert.equal(s.rect,sample,'Raw read remains exact UTF-16 text');
        assert.deepEqual(
          s.regions.map(r=>r.text),
          ['A','\uD83D','\uDE00','B','e','\u0301','\t','Z']
        );
        assert.deepEqual(
          s.regions.map(r=>[r.start.col,r.end.col]),
          Array.from({length:8},(_,index)=>[index,index+1])
        );
        assert.equal(s.rendered[1].text,'H');
        assert.equal(s.rendered[2].text,'L');
        assert.equal(s.rendered[5].text,'◌\u0301');
        assert.equal(s.rendered.map(r=>r.text).includes('😀'),false);
      }
      else
      {
        assert.equal(s.rect,'A😀Be\u0301    Z');
        assert.deepEqual(
          s.regions.map(r=>r.text),
          ['A','😀','B','e\u0301','\t','Z']
        );
        assert.deepEqual(
          s.regions.map(r=>[r.start.col,r.end.col]),
          [[0,1],[1,2],[2,3],[3,4],[4,8],[8,9]]
        );
        assert.equal(s.rendered[1].text,'😀');
        assert.equal(s.rendered[4].text,'⇥');
        assert.equal(s.rendered[4].end-s.rendered[4].start,4);
      }
    }

    // Same GUI, real pointer/focus/keyboard against a real CellDocument2D.
    await setup('cell',backend);
    const emoji=page.locator('.unit').nth(1);
    const emojiBox=await emoji.boundingBox();
    assert.ok(emojiBox && emojiBox.width>0);
    await emoji.click({position:{x:emojiBox.width-2,y:emojiBox.height/2}});
    let s=await snapshot();
    assert.equal(s.selections[0].end.col,2,'click chooses published end');

    await page.keyboard.press('ArrowLeft');
    s=await snapshot();
    assert.equal(s.selections[0].end.col,1);
    await page.keyboard.press('ArrowRight');
    s=await snapshot();
    assert.equal(s.selections[0].end.col,2);
    assert.equal(s.sourceText,sample,'navigation cannot modify source');

    await page.keyboard.type('X');
    await waitForRevision(1);
    s=await snapshot();
    assert.equal(s.sourceText,'A😀XBe\u0301\tZ');
    assert.equal(s.lastEvent.invalidation,true);
    assert.ok(s.rendered.some(region=>region.text==='😀'));

    // The candidate document-side raw projection must never change how a
    // composed CellDocument2D reads or edits the actual source.
    await setup('nested',backend);
    s=await snapshot();
    assert.equal(s.sourceText,sample);
    assert.deepEqual(
      s.regions.map(r=>r.text),['A','😀','B','e\u0301','\t','Z']
    );
    const tab=page.locator('.unit[data-kind="tab"]');
    const tabBox=await tab.boundingBox();
    assert.ok(tabBox && tabBox.width>0);
    await tab.click({position:{x:tabBox.width*0.45,y:tabBox.height/2}});
    s=await snapshot();
    assert.ok([4,8].includes(s.selections[0].end.col),
      'TAB interior cannot become an invented caret position');
    assert.equal(s.sourceText,sample);
  }

  assert.deepEqual(errors,[],'browser runtime errors');
  console.log(JSON.stringify({
    pass:true,
    nature:'experiment; Raw getRegions projection is not product output',
    backends:['FlatDocument','PieceDocument'],
    modes:['Raw UTF-16 units','Cell graphemes','nested Cell'],
    scenarios:['exact source preserved','independent display units',
      'Unicode surrogate diagnostics','combining-mark diagnostics',
      'TAB geometry','no clipped glyphs','real mouse hit-test',
      'keyboard caret navigation','one public insert commit',
      'Raw->Cell recomposition']
  }));
}
finally
{
  await browser.close();
}
