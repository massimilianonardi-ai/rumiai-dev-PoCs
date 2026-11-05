// G03: actual Chromium pointer and Delete key around source-less overlays,
// whole-row Fold and occupied Substitution using the *unmodified* canonical
// Raw->Cell->... chain. Atomic mixed edits use the real public replace API.
import assert from 'node:assert/strict';
import {launchTestChromium} from './browser-launch.mjs';

const browser=await launchTestChromium();
const page=await browser.newPage({viewport:{width:1100,height:760}});
page.setDefaultTimeout(20000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/canonical-gui.html';
const original='A😀Be\u0301\tZ👩‍💻\nHIDDEN\nTAIL';
const modes=['annotation','fold','substitution'];

function snapshot()
{
  return page.evaluate
  (
    ()=>window.__canonicalGuiProbe.snapshot()
  );
}

async function reset(backend,mode)
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
        s.domCaret.length===1 && s.domCaret[0].col===0;
    },
    {backend,mode}
  );
}

async function clickRegion(kind,side='left',row=0)
{
  const unit=page.locator(
    '.unit[data-kind="'+kind+'"][data-row="'+row+'"]'
  ).first();
  // A requestAnimationFrame paint can replace the bounded DOM after an
  // interaction. Resolve the currently visible unit before measuring it.
  await unit.waitFor({state:'visible'});
  const box=await unit.boundingBox();
  assert.ok(box && box.width>5);
  await unit.click
  (
    {position:{
      x:side==='left'?2:box.width-2,
      y:box.height/2
    }}
  );
}

async function waitCaret(row,col)
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
  return snapshot();
}

function assertStable(s,mode,backend,base)
{
  assert.equal(s.sourceText,original,
    'protected interaction cannot mutate '+mode+'/'+backend);
  assert.equal(s.sourceRevision,0);
  assert.equal(s.viewRevision,base.viewRevision);
  assert.equal(s.contentEvents,0);
  assert.deepEqual(s.domUnits.filter(unit=>unit.clipped),[]);
}

try
{
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  const results=[];

  for(const backend of ['flat','piece'])
  {
    for(const mode of modes)
    {
      await reset(backend,mode);
      const before=await snapshot();
      assert.equal(before.sourceText,original);
      assert.deepEqual(before.domNotes,[{id:'guide',row:0,col:1}]);
      const noteRegion=before.regionsByRow[0].find
      (
        region=>region.kind==='annotation'
      );
      assert.ok(noteRegion);
      assert.equal(noteRegion.start.col,noteRegion.end.col,
        'annotation has zero visible width');

      const geometry=await page.evaluate
      (
        ()=>
        {
          const content=document.querySelector(
            '.content[data-row="0"]'
          );
          const note=content.querySelector('.annotation');
          const left=content.querySelector(
            '.unit[data-start="0"][data-end="1"]'
          );
          const right=content.querySelector(
            '.unit[data-start="1"][data-end="2"]'
          );
          if(!note || !left || !right) return null;
          const offset=note.offsetLeft;
          const boundary=left.offsetLeft+left.offsetWidth;
          return {
            noteLeft:offset,boundary,
            nextStart:right.offsetLeft,
            pointerEvents:getComputedStyle(note).pointerEvents
          };
        }
      );
      assert.ok(geometry);
      assert.ok(Math.abs(geometry.noteLeft-geometry.boundary)<=1,
        'zero-width annotation centered on public boundary');
      assert.ok(Math.abs(geometry.nextStart-geometry.boundary)<=1);
      assert.equal(geometry.pointerEvents,'none');
      assert.equal(before.domUnits.some(x=>x.kind==='annotation'),false);

      // Real mouse input at the annotation anchor belongs to the adjacent
      // ordinary text: overlays cannot become insertion destinations.
      const adjacent=page.locator(
        '.unit[data-row="0"][data-start="1"][data-end="2"]'
      ).first();
      const adjacentBox=await adjacent.boundingBox();
      assert.ok(adjacentBox);
      await adjacent.click
      (
        {position:{x:2,y:adjacentBox.height/2}}
      );
      let current=await waitCaret(0,1);
      assertStable(current,mode,backend,before);

      if(mode==='fold')
      {
        const folded=before.regionsByRow[1];
        assert.equal(folded.length,1);
        assert.equal(folded[0].kind,'fold');
        assert.deepEqual(
          [folded[0].start.col,folded[0].end.col],[0,1]
        );
        for(const side of ['left','right'])
        {
          await clickRegion('fold',side,1);
          await page.waitForFunction
          (
            ()=>window.__canonicalGuiProbe?.snapshot()
              ?.statusMessage.startsWith('Posizione respinta:')
          );
          current=await snapshot();
          assert.deepEqual(current.domCaret,[{row:0,col:1}],
            'fold row cannot own a caret');
          assertStable(current,mode,backend,before);
        }
        const invalid=await page.evaluate
        (
          ()=>window.__canonicalGuiProbe.attemptSelectionAt(1,0)
        );
        assert.equal(invalid.rejected,true);
        assert.equal(invalid.selectionUnchanged,true);
      }

      if(mode==='substitution')
      {
        const replacement=before.regionsByRow[0].find
        (
          region=>region.kind==='substitution'
        );
        assert.ok(replacement);
        assert.equal(replacement.text,'LONG');
        assert.deepEqual(
          [replacement.start.col,replacement.end.col],[2,6]
        );

        await clickRegion('substitution','left');
        current=await waitCaret(0,2);
        assertStable(current,mode,backend,before);
        const invalid=await page.evaluate
        (
          ()=>window.__canonicalGuiProbe.attemptSelectionAt(0,3)
        );
        assert.equal(invalid.rejected,true);
        assert.equal(invalid.selectionUnchanged,true);
        assert.equal(invalid.sourceUnchanged,true);

        await page.keyboard.press('Delete');
        await page.waitForFunction
        (
          ()=>window.__canonicalGuiProbe?.snapshot()
            ?.statusMessage.startsWith('Eliminazione respinta:')
        );
        current=await snapshot();
        assert.ok(current.statusMessage.includes('respinta'));
        assert.deepEqual(current.domCaret,[{row:0,col:2}]);
        assertStable(current,mode,backend,before);

        await clickRegion('substitution','right');
        current=await waitCaret(0,6);
        assertStable(current,mode,backend,before);
        await page.keyboard.press('ArrowLeft');
        await waitCaret(0,2);
        await page.keyboard.press('ArrowRight');
        await waitCaret(0,6);
      }

      if(mode==='fold'||mode==='substitution')
      {
        const atomic=await page.evaluate
        (
          ()=>window.__canonicalGuiProbe.attemptProtectedBatch()
        );
        assert.equal(atomic.rejected,true,
          'combined valid+protected batch must reject atomically');
        assert.ok(atomic.reason);
        assert.equal(atomic.originalUnchanged,true);
        assert.equal(atomic.sourceRevisionUnchanged,true);
        assert.equal(atomic.viewRevisionUnchanged,true);
        assert.equal(atomic.contentEventsUnchanged,true);
        assert.equal(atomic.selectionsUnchanged,true);
      }

      current=await snapshot();
      assertStable(current,mode,backend,before);
      results.push({
        backend,mode,initialViewRevision:before.viewRevision,
        annotationAt:noteRegion.start.col,
        protected:mode!=='annotation',
        sourceRevision:current.sourceRevision,
        contentEvents:current.contentEvents
      });
    }
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({
    status:'PASS',scope:'G03 canonical synthetic DOM and atomic refusal',
    results,
    caveat:'Fold marker clicks and public atomic replace are different paths. Only simple scoped Delete at the start of Substitution is tested; not full keyboard deletion policy or multirow viewport.'
  }));
}
finally
{
  await page.close();
  await browser.close();
}
