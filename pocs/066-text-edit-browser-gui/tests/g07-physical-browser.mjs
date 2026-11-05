// G07 visual verification on the operator's Ubuntu reference VMs.
// Each host launcher records its guest and installed Chromium identity.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {launchTestChromium} from './browser-launch.mjs';

assert.equal
(
  process.env.RUMIAI_G07_REFERENCE,
  '1',
  'reference VM preflight required'
);
assert.ok
(
  process.env.RUMIAI_G07_ARTIFACTS,
  'local report directory required'
);
const output=process.env.RUMIAI_G07_ARTIFACTS;
await mkdir(output,{recursive:true});

const browser=await launchTestChromium();
const page=await browser.newPage({viewport:{width:1140,height:810}});
page.setDefaultTimeout(30000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const root='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/';

try
{
  const response=await page.goto
  (
    root+'canonical-gui.html',
    {waitUntil:'load'}
  );
  assert.equal(response.status(),200);
  await page.waitForFunction
  (
    ()=>window.__canonicalGuiProbe?.snapshot()?.domUnits.length>0
  );
  const initial=await page.evaluate
  (
    ()=>
    {
      return {
        userAgent:navigator.userAgent,
        platform:navigator.platform,
        dpr:devicePixelRatio,
        screen:{width:screen.width,height:screen.height},
        units:window.__canonicalGuiProbe.snapshot().domUnits.length
      };
    }
  );
  await page.screenshot
  (
    {path:join(output,'canonical-initial.png'),fullPage:true}
  );

  const emoji=page.locator('.unit[data-kind="text"]:text-is("😀")').first();
  const bounds=await emoji.boundingBox();
  assert.ok(bounds && bounds.width>4);
  await emoji.click
  (
    {position:{x:bounds.width-2,y:bounds.height/2}}
  );
  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForFunction
  (
    ()=>
    {
      const s=window.__canonicalGuiProbe?.snapshot();
      return s?.domMarks.length===1 &&
        s.domMarks[0].start===1 && s.domMarks[0].end===2;
    }
  );
  const geometry=await page.evaluate
  (
    ()=>
    {
      const a=document.querySelector('.selection-mark')
        ?.getBoundingClientRect();
      const b=document.querySelector(
        '.unit[data-start="1"][data-end="2"]'
      )?.getBoundingClientRect();
      if(!a || !b) return null;
      return {
        startDelta:Math.abs(a.left-b.left),
        widthDelta:Math.abs(a.width-b.width)
      };
    }
  );
  assert.ok(geometry);
  assert.ok(geometry.startDelta<=1);
  assert.ok(geometry.widthDelta<=1);
  await page.screenshot
  (
    {path:join(output,'canonical-selection.png'),fullPage:true}
  );

  await page.locator('#mode').selectOption('annotation');
  await page.waitForFunction
  (
    ()=>window.__canonicalGuiProbe?.snapshot()?.domNotes.length===1
  );
  await page.screenshot
  (
    {path:join(output,'canonical-annotation.png'),fullPage:true}
  );
  await page.locator('#mode').selectOption('substitution');
  await page.waitForFunction
  (
    ()=>window.__canonicalGuiProbe?.snapshot()
      ?.domUnits.some(u=>u.kind==='substitution')
  );
  await page.screenshot
  (
    {path:join(output,'canonical-substitution.png'),fullPage:true}
  );

  await page.goto(root+'index.html',{waitUntil:'load'});
  await page.waitForFunction
  (
    ()=>window.__guiProbe?.snapshot()?.mounted>0
  );
  await page.screenshot
  (
    {path:join(output,'textedit-082-reference.png'),fullPage:true}
  );

  assert.deepEqual(errors,[]);
  const report=
  {
    status:'PASS',scope:'G07 real reference VM Chromium pixel checks',
    browserMode:process.env.RUMIAI_G07_HEADLESS==='1'?'headless':'headful',
    browserVersion:browser.version(),
    browser:initial,geometry,
    screenshots:[
      'canonical-initial.png','canonical-selection.png',
      'canonical-annotation.png','canonical-substitution.png',
      'textedit-082-reference.png'
    ],
    boundary:'No claim for Electron, missing desktop integration in headless mode, other hosts or full editor parity'
  };
  console.log(JSON.stringify(report));
}
finally
{
  await page.close();
  await browser.close();
}
