// Headless Chromium smoke test for the ACTUAL TextEdit library + browser PoC.
// Experimental test: permanent product contract tests belong to rumiai-tests.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1140,height:810}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const base='http://127.0.0.1:8765/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/';
const result=await page.goto(base,{waitUntil:'load'});
assert.equal(result.status(),200);
await page.waitForFunction(()=>window.__guiProbe?.snapshot()?.mounted>0);
const snap=()=>page.evaluate(()=>window.__guiProbe.snapshot());
const position=(row,col)=>page.evaluate(({row,col})=>{
  const line=document.querySelector('.row[data-row="'+row+'"] .content');
  if(!line)throw new Error('row not in viewport: '+row);
  const text=line.firstChild,range=document.createRange();
  range.setStart(text,col);
  range.collapse(true);
  const box=range.getBoundingClientRect();
  const container=line.getBoundingClientRect();
  return {x:box.left,y:container.top+12};
},{row,col});

try{
  let state=await snap();
  assert.equal(state.version,'0.8.1');
  assert.equal(state.rows,7);
  assert.ok(state.mounted>0&&state.mounted<80);
  assert.equal(state.selection.length,1);
  assert.equal(state.selection[0].start.row,0);

  // Ordinary printable keyboard path and selection-aware editing.
  await page.locator('#scroller').focus();
  await page.keyboard.type('Z');
  state=await snap();assert.ok(state.text.startsWith('Zalpha'));
  await page.keyboard.press('Backspace');
  state=await snap();assert.ok(state.text.startsWith('alpha'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  state=await snap();
  assert.equal(state.selection[0].start.col,1);
  assert.equal(state.selection[0].end.col,2);
  await page.keyboard.type('X');
  state=await snap();assert.ok(state.text.startsWith('aXpha'));

  // A real mouse drag across two displayed rows.
  await page.locator('#sample').click();
  await page.waitForFunction(()=>window.__guiProbe.snapshot().text.startsWith('alpha'));
  let from=await position(0,1),to=await position(1,3);
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();
  state=await snap();
  assert.equal(state.selection.length,1);
  assert.equal(state.selection[0].start.row,0);
  assert.equal(state.selection[0].end.row,1);

  // Alt+drag delegates rectangle policy to TextEditAdvancedSelections.
  await page.locator('#sample').click();
  await page.waitForFunction(()=>window.__guiProbe.snapshot().selection.length===1);
  from=await position(0,1);to=await position(2,3);
  await page.keyboard.down('Alt');
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();
  await page.keyboard.up('Alt');
  state=await snap();
  assert.equal(state.selection.length,3);
  assert.deepEqual(state.selection.map(s=>s.start.row),[0,1,2]);
  await page.waitForTimeout(50);
  const marks=await page.locator('.mark').count();
  assert.ok(marks>=3,'all three rectangle spans must be rendered');
  await page.locator('#scroller').focus();
  await page.keyboard.type('Q');
  state=await snap();
  assert.equal(state.selection.length,3);
  assert.ok(state.text.includes('aQha')||state.text.includes('aQa'),
    'text edits go through actual TextEdit across rectangle selections');

  // Scroll a genuinely large PieceDocument without mounting 100k DOM rows.
  await page.locator('#large').click();
  await page.waitForFunction(()=>window.__guiProbe.snapshot().rows===100000);
  state=await snap();
  assert.ok(state.mounted<90);
  await page.locator('#jump').click();
  await page.waitForFunction(()=>window.__guiProbe.snapshot().first>=49000);
  state=await snap();
  assert.ok(state.mounted<90&&state.maxMounted<90);
  assert.equal(state.rows,100000);
  assert.equal(errors.length,0,'no browser script errors: '+errors.join(' | '));
  console.log(JSON.stringify({pass:true,version:state.version,
    rendered:state.mounted,maxMounted:state.maxMounted,
    jumpedToRow:state.first+1,tests:['keyboard-input','keyboard-range',
    'mouse-drag','alt-rectangle','multi-selection-edit','viewport-100k']}));
}finally{
  await browser.close();
}
