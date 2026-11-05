// G01: canonical unmodified Raw->Cell and wrappers in a REAL browser.
// The renderer has only the nominal Document2D public API. No PoC
// per-unit Raw proxy, no packed codec, no patched Cell core.
import assert from 'node:assert/strict';
import {launchTestChromium} from './browser-launch.mjs';

const browser=await launchTestChromium();
const page=await browser.newPage({viewport:{width:1100,height:760}});
page.setDefaultTimeout(20000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/canonical-gui.html';
const original='A😀Be\u0301\tZ👩‍💻\nHIDDEN\nTAIL';
const modes=['cell','nested','annotation','fold','substitution'];
const results=[];

try
{
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);

  for(const backend of ['flat','piece'])
  {
    for(const mode of modes)
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
            s.paints>0 && s.renderedRevision===s.viewRevision &&
            s.domUnits.length>0;
        },
        {backend,mode}
      );

      const s=await page.evaluate
      (
        ()=>window.__canonicalGuiProbe.snapshot()
      );
      assert.equal(s.sourceText,original);
      assert.equal(s.sourceRevision,0);
      assert.equal(s.rowCount,3,
        'a folded row retains one visible marker row');
      assert.equal(s.rawRegions.length,1,
        'published Raw remains aggregated');
      assert.equal(s.rawRegions[0].text,original.split('\n')[0],
        'Raw has unchanged UTF-16 text');

      const regions=s.regionsByRow.flat();
      const units=regions.filter(r=>r.kind!=='annotation');
      assert.equal(s.domUnits.length,units.length);
      assert.deepEqual
      (
        s.domUnits.map(r=>[r.kind,r.row,r.start,r.end]),
        units.map(r=>[
          r.kind,r.start.row,r.start.col,r.end.col
        ])
      );
      assert.deepEqual
      (
        s.domUnits.filter(r=>r.clipped),[],
        'no visible glyph clipped'
      );
      assert.ok(s.domUnits.every(r=>r.width>0));
      assert.deepEqual(s.domCaret,[{row:0,col:0}],
        'caret anchored to public cell boundary');

      const zwj=units.filter(r=>r.text==='👩‍💻');
      assert.equal(zwj.length,1,
        'canonical aggregated Raw must preserve one whole ZWJ grapheme');
      assert.equal(zwj[0].end.col-zwj[0].start.col,1);
      assert.equal(units.filter(r=>r.text==='👩‍').length,0);
      assert.equal(units.filter(r=>r.text==='💻').length,0);
      const combining=units.filter(r=>r.text==='e\u0301');
      assert.equal(combining.length,1);
      assert.equal(combining[0].end.col-combining[0].start.col,1);
      const tab=units.find(r=>r.kind==='tab');
      assert.ok(tab);
      assert.equal(tab.text,'\t');
      assert.equal(tab.end.col-tab.start.col,4);
      assert.ok(s.domUnits.some(r=>
        r.kind==='tab' && r.text==='⇥'));

      if(['annotation','fold','substitution'].includes(mode))
      {
        assert.deepEqual(s.domNotes,
          [{id:'guide',row:0,col:1}]);
        const note=regions.find(r=>r.kind==='annotation');
        assert.ok(note && note.start.col===note.end.col);
        assert.equal(s.domUnits.some(r=>r.kind==='annotation'),false);
      }
      else assert.deepEqual(s.domNotes,[]);

      if(mode==='fold')
      {
        assert.ok(s.domUnits.some(r=>r.kind==='fold'));
        assert.equal(s.regionsByRow[1][0].kind,'fold');
      }
      if(mode==='substitution')
      {
        const substitute=units.find(r=>r.kind==='substitution');
        assert.ok(substitute);
        assert.equal(substitute.text,'LONG');
        assert.equal(substitute.end.col-substitute.start.col,4);
        assert.equal(s.sourceText.includes('LONG'),false);
      }

      results.push({
        backend,mode,displayUnits:s.domUnits.length,
        notes:s.domNotes.length,revision:s.viewRevision
      });
    }
  }

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({
    status:'PASS',
    scope:'G01 canonical real compiled Document2D and Chromium DOM',
    variants:results,
    caveat:'Only initial rendering; pointer/navigation/edit/scroll/IME and physical host acceptance remain G02-G07.'
  }));
}
finally
{
  await page.close();
  await browser.close();
}
