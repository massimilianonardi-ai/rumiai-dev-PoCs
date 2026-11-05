// G06: side-by-side normal-path comparison of ACTUAL stable 0.8.2 browser
// GUI and separate canonical compiled Document2D GUI. Compare source text;
// their selection coordinates deliberately differ (UTF-16 vs visual cells).
import assert from 'node:assert/strict';
import {launchTestChromium} from './browser-launch.mjs';

const browser=await launchTestChromium();
const legacy=await browser.newPage({viewport:{width:1140,height:810}});
const canonical=await browser.newPage({viewport:{width:1140,height:810}});
const errors=[];
legacy.on('pageerror',error=>errors.push('legacy: '+error.message));
canonical.on('pageerror',error=>errors.push('canonical: '+error.message));
const root='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/';
const sample='A😀Be\u0301\tZ👩‍💻\nHIDDEN\nTAIL';
const inserted='A😀Xe\u0301\tZ👩‍💻\nHIDDEN\nTAIL';
const results=[];

const oldState=()=>legacy.evaluate(()=>window.__guiProbe.snapshot());
const newState=()=>canonical.evaluate(()=>window.__canonicalGuiProbe.snapshot());

async function initialize(backend)
{
  await legacy.evaluate(text=>window.__guiProbe.setText(text),sample);
  await legacy.waitForFunction
  (
    sample=>window.__guiProbe?.snapshot()?.text===sample,
    sample
  );
  await canonical.locator('#backend').selectOption(backend);
  await canonical.locator('#mode').selectOption('cell');
  await canonical.locator('#fixture').selectOption('basic');
  await canonical.locator('#reset').click();
  await canonical.waitForFunction
  (
    backend=>
    {
      const s=window.__canonicalGuiProbe?.snapshot();
      return s?.backend===backend && s.sourceText.startsWith('A😀B') &&
        s.domUnits.length>0 && s.renderedRevision===s.viewRevision;
    },
    backend
  );
}

async function clickAfterEmoji()
{
  const point=await legacy.evaluate
  (
    ()=>window.__guiProbe.point(0,3)
  );
  await legacy.mouse.click(point.x,point.y);
  const emoji=canonical.locator(
    '.unit[data-kind="text"]:text-is("😀")'
  ).first();
  const box=await emoji.boundingBox();
  assert.ok(box && box.width>4);
  await emoji.click({position:{x:box.width-2,y:box.height/2}});
  await canonical.waitForFunction
  (
    ()=>window.__canonicalGuiProbe?.snapshot()?.domCaret[0]?.col===2
  );
}

function caret(selection)
{
  return selection.forward?selection.end:selection.start;
}

async function verify(legacyCol,canonicalCol,content=sample)
{
  const a=await oldState();
  const b=await newState();
  assert.equal(a.text,content);
  assert.equal(b.sourceText,content);
  assert.equal(caret(a.selection[0]).row,0);
  assert.equal(caret(b.selections[0]).row,0);
  assert.equal(caret(a.selection[0]).col,legacyCol);
  assert.equal(caret(b.selections[0]).col,canonicalCol);
  return {a,b};
}

async function keyBoth(key)
{
  await legacy.locator('#scroller').focus();
  await canonical.locator('#scroller').focus();
  await legacy.keyboard.press(key);
  await canonical.keyboard.press(key);
  await canonical.waitForFunction
  (
    ()=>window.__canonicalGuiProbe?.snapshot()?.renderedRevision===
        window.__canonicalGuiProbe?.snapshot()?.viewRevision
  );
}

try
{
  const [a,b]=await Promise.all
  (
    [
      legacy.goto(root+'index.html',{waitUntil:'load'}),
      canonical.goto(root+'canonical-gui.html',{waitUntil:'load'})
    ]
  );
  assert.equal(a.status(),200);
  assert.equal(b.status(),200);
  await legacy.waitForFunction
  (
    ()=>window.__guiProbe?.snapshot()?.mounted>0
  );
  const renderAPI=await canonical.evaluate
  (
    ()=>({
      exported:typeof window.CanonicalRegionRenderer,
      methods:Object.getOwnPropertyNames(
        window.CanonicalRegionRenderer.prototype
      )
    })
  );
  assert.equal(renderAPI.exported,'function');
  assert.deepEqual(renderAPI.methods,['constructor','render']);

  for(const backend of ['flat','piece'])
  {
    await initialize(backend);
    await clickAfterEmoji();
    await verify(3,2);

    await keyBoth('ArrowLeft');
    await verify(1,1);
    await keyBoth('ArrowRight');
    await verify(3,2);

    // Whole grapheme selection is measured in different coordinate spaces.
    await keyBoth('Shift+ArrowRight');
    const {a:before,b:current}=await verify(4,3);
    assert.deepEqual(
      [before.selection[0].start.col,before.selection[0].end.col],
      [3,4]
    );
    assert.deepEqual(
      [current.selections[0].start.col,current.selections[0].end.col],
      [2,3]
    );
    assert.deepEqual(current.domMarks.map(x=>[x.row,x.start,x.end]),
      [[0,2,3]]);

    // This is a real DOM mark covering the exposed 'B' unit in pixels.
    const pixels=await canonical.evaluate
    (
      ()=>
      {
        const mark=document.querySelector('.selection-mark');
        const item=document.querySelector(
          '.unit[data-row="0"][data-start="2"][data-end="3"]'
        );
        if(!mark||!item) return null;
        const a=mark.getBoundingClientRect();
        const b=item.getBoundingClientRect();
        return {
          leftDelta:Math.abs(a.left-b.left),
          widthDelta:Math.abs(a.width-b.width)
        };
      }
    );
    assert.ok(pixels,'selection must paint from public boundaries');
    assert.ok(pixels.leftDelta<=1);
    assert.ok(pixels.widthDelta<=1);

    await legacy.keyboard.type('X');
    await canonical.keyboard.type('X');
    await canonical.waitForFunction
    (
      ()=>window.__canonicalGuiProbe?.snapshot()?.sourceRevision===1
    );
    await verify(4,3,inserted);
    const after=await newState();
    assert.equal(after.contentEvents,1);
    assert.deepEqual(after.domMarks,[],
      'typing replaces the selection and collapses the caret');
    results.push({
      backend,path:'emoji/caret/right selection/type',
      sameSource:true,legacyCaretUtf16:4,canonicalCaretCell:3
    });

    // Reversed selection: the actual 0.8.2 GUI and canonical view have
    // different numeric extents for the same complete emoji.
    await initialize(backend);
    await clickAfterEmoji();
    await keyBoth('Shift+ArrowLeft');
    const reversed=await verify(1,1);
    assert.deepEqual
    (
      [
        reversed.a.selection[0].start.col,
        reversed.a.selection[0].end.col,
        reversed.a.selection[0].forward
      ],
      [1,3,false]
    );
    assert.deepEqual
    (
      [
        reversed.b.selections[0].start.col,
        reversed.b.selections[0].end.col,
        reversed.b.selections[0].forward
      ],
      [1,2,false]
    );
    assert.deepEqual
    (
      reversed.b.domMarks.map(x=>[x.start,x.end]),
      [[1,2]]
    );
    await keyBoth('ArrowRight');
    const collapsed=await verify(3,2);
    assert.equal(collapsed.a.selection[0].start.col,
      collapsed.a.selection[0].end.col);
    assert.equal(collapsed.b.selections[0].start.col,
      collapsed.b.selections[0].end.col);
    results.push({
      backend,path:'reverse Shift+arrow and plain-arrow collapse',
      sameSource:true,legacySelectedUtf16:2,canonicalSelectedCells:1
    });
  }

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({
    status:'PASS',scope:'G06 actual 0.8.2 vs nominal Document2D GUI',
    variants:results,
    knownDisparities:[
      'legacy supports pointer drag/Alt rectangle, canonical does not',
      'legacy has Backspace/Enter/Tab and native proportional scrollbars',
      'canonical only paints same-row selections and pages logical windows',
      'legacy glyph widths are configurable; Cell currently gives other graphemes one cell'
    ],
    limitation:'Real hosted Chromium only; this is parity of common paths, not full GUI equivalence or physical host validation.'
  }));
}
finally
{
  await legacy.close();
  await canonical.close();
  await browser.close();
}
