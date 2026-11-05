// PoC 066: real Chromium user-flow regression for column drag, keyboard
// history, clipboard transport, IME composition and bounded scrollbars.
// The core under test is the actual pinned jsc compilation, not a mock.
import assert from 'node:assert/strict';
import {launchTestChromium} from './browser-launch.mjs';

const browser=await launchTestChromium();
const page=await browser.newPage({viewport:{width:1200,height:850}});
page.setDefaultTimeout(30000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/canonical-gui.html';
const original='A😀Be\u0301\tZ👩‍💻\nHIDDEN\nTAIL';
const snapshot=()=>page.evaluate(()=>window.__canonicalGuiProbe.snapshot());

async function settle(test)
{
  await page.waitForFunction
  (
    text=>window.__canonicalGuiProbe?.snapshot()?.sourceText===text,
    test
  );
  return snapshot();
}

async function reset(backend,fixture='basic')
{
  await page.locator('#backend').selectOption(backend);
  await page.locator('#fixture').selectOption(fixture);
  await page.locator('#mode').selectOption('cell');
  await page.locator('#reset').click();
  await page.waitForFunction
  (
    ({backend,fixture})=>
    {
      const s=window.__canonicalGuiProbe?.snapshot();
      return s?.backend===backend && s.fixture===fixture &&
        s.sourceRevision===0 && s.renderedRevision===s.viewRevision;
    },
    {backend,fixture}
  );
}

async function dragRect()
{
  const a=page.locator('.unit[data-row="0"][data-start="0"]').first();
  const b=page.locator('.unit[data-row="1"][data-start="1"]').first();
  const ab=await a.boundingBox();
  const bb=await b.boundingBox();
  assert.ok(ab && bb);
  await page.mouse.move(ab.x+ab.width-2,ab.y+ab.height/2);
  await page.mouse.down();
  await page.mouse.move(bb.x+bb.width-2,bb.y+bb.height/2,{steps:8});
  await page.mouse.up();
  await page.waitForFunction
  (
    ()=>
    {
      const s=window.__canonicalGuiProbe?.snapshot();
      return s?.selections?.length===2 && s.domMarks.length===2;
    }
  );
  return snapshot();
}

async function clipboard(type,plain,column=false)
{
  return page.evaluate
  (
    ({type,plain,column})=>
    {
      const transfer=new DataTransfer();
      if(plain!==null) transfer.setData('text/plain',plain);
      if(column)
      {
        transfer.setData('application/x-rumiai-column','{"rows":2}');
      }
      const event=new ClipboardEvent
      (
        type,{bubbles:true,cancelable:true,clipboardData:transfer}
      );
      document.getElementById('scroller').dispatchEvent(event);
      return {
        handled:event.defaultPrevented,
        text:transfer.getData('text/plain'),
        column:transfer.getData('application/x-rumiai-column')
      };
    },
    {type,plain,column}
  );
}

try
{
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);

  for(const backend of ['flat','piece'])
  {
    await reset(backend);
    await page.locator('#gesture').selectOption('rectangle');
    let s=await dragRect();
    assert.deepEqual
    (
      s.selections.map(item=>[
        item.start.row,item.start.col,item.end.col
      ]),
      [[0,1,2],[1,1,2]]
    );
    assert.deepEqual
    (
      s.domMarks.map(item=>[item.row,item.start,item.end]),
      [[0,1,2],[1,1,2]]
    );
    assert.equal(s.sourceText,original);

    const copied=await clipboard('copy',null);
    assert.equal(copied.handled,true);
    assert.equal(copied.text,'😀\nI');
    assert.ok(copied.column.includes('"rows":2'));

    const cut=await clipboard('cut',null);
    assert.equal(cut.handled,true);
    const removed=original.replace('😀','').replace('HIDDEN','HDDEN');
    s=await settle(removed);
    assert.equal(s.sourceRevision,1);
    assert.equal(s.history.undo,1);

    await page.keyboard.press('ControlOrMeta+z');
    s=await settle(original);
    assert.equal(s.history.redo,1);

    await page.keyboard.press('ControlOrMeta+y');
    s=await settle(removed);
    assert.equal(s.history.undo,1);

    const pasted=await clipboard('paste','😀\nI',true);
    assert.equal(pasted.handled,true);
    s=await settle(original);
    assert.equal(s.sourceRevision,4,'one source commit per column action');
    assert.equal(s.history.undo,2);

    // Wrong row count is rejected without a partial edit or revision.
    const mismatch=await clipboard('paste','x\ny\nz',true);
    assert.equal(mismatch.handled,true);
    s=await snapshot();
    assert.equal(s.sourceText,original);
    assert.equal(s.sourceRevision,4);

    await page.keyboard.press('ControlOrMeta+z');
    await settle(removed);
    await page.keyboard.press('ControlOrMeta+y');
    await settle(original);

    await page.locator('#gesture').selectOption('line');
    await reset(backend);
    const first=page.locator('.unit[data-row="0"][data-start="0"]').first();
    const box=await first.boundingBox();
    assert.ok(box);
    await first.click({position:{x:box.width-2,y:box.height/2}});
    await page.waitForFunction
    (
      ()=>window.__canonicalGuiProbe?.snapshot()?.focused===true
    );
    await page.locator('#ime-input').evaluate
    (
      element=>
      {
        element.dispatchEvent(new CompositionEvent
        (
          'compositionstart',{bubbles:true,data:''}
        ));
        element.dispatchEvent(new CompositionEvent
        (
          'compositionupdate',{bubbles:true,data:'漢'}
        ));
        element.dispatchEvent(new CompositionEvent
        (
          'compositionend',{bubbles:true,data:'漢'}
        ));
        element.dispatchEvent(new InputEvent
        (
          'beforeinput',
          {bubbles:true,cancelable:true,inputType:'insertFromComposition',data:'漢'}
        ));
      }
    );
    s=await settle('A漢'+original.slice(1));
    assert.equal(s.sourceRevision,1,'IME commits exactly one user action');
    await page.keyboard.press('ControlOrMeta+z');
    await settle(original);

    await reset(backend,'many');
    assert.equal((await page.locator('#vscroll').inputValue()),'0');
    s=await snapshot();
    assert.equal(s.rowCount,1200);
    await page.locator('#vscroll').evaluate
    (
      element=>{element.value='120';element.dispatchEvent(new Event('input'));}
    );
    await page.waitForFunction
    (
      ()=>window.__canonicalGuiProbe?.viewport()?.firstRow===120
    );
    assert.ok((await page.evaluate
    (
      ()=>window.__canonicalGuiProbe.viewport().mountedRows
    ))<=3);

    await reset(backend,'long');
    const horizontal=await page.locator('#hscroll').evaluate
    (
      element=>Number(element.max)
    );
    assert.ok(horizontal>100);
    await page.locator('#hscroll').evaluate
    (
      element=>{element.value='100';element.dispatchEvent(new Event('input'));}
    );
    await page.waitForFunction
    (
      ()=>window.__canonicalGuiProbe?.viewport()?.firstCol===100
    );
    const v=await page.evaluate(()=>window.__canonicalGuiProbe.viewport());
    assert.ok(v.mountedRows<=3);
    assert.ok(v.mountedUnits<=102);

    console.log('PoC 066 advanced GUI PASS: '+backend);
  }

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify
  (
    {status:'PASS',scope:'column drag, clipboard, history, IME and real scrollbars',
      backends:['flat','piece'],remaining:'manual OS clipboard/IME host validation'}
  ));
}
finally
{
  await page.close();
  await browser.close();
}
