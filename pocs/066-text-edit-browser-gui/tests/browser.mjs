// Headless Chromium smoke test for the ACTUAL TextEdit library + browser PoC.
// Experimental test: permanent product contract tests belong to rumiai-tests.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1140,height:810}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const base='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/';
const result=await page.goto(base,{waitUntil:'load'});
assert.equal(result.status(),200);
await page.waitForFunction(()=>window.__guiProbe?.snapshot()?.mounted>0);
const snap=()=>page.evaluate(()=>window.__guiProbe.snapshot());
const position=(row,col)=>page.evaluate(({row,col})=>
  window.__guiProbe.point(row,col),{row,col});

try{
  let state=await snap();
  assert.equal(state.version,'0.8.1');
  assert.equal(state.rows,7);
  assert.ok(state.mounted>0&&state.mounted<80);
  assert.equal(state.selection.length,1);
  assert.equal(state.selection[0].start.row,0);

  // Changing font must remeasure visible glyphs without mutating TextEdit state.
  const monoX=(await position(0,10)).x;
  await page.locator('#font-proportional').click();
  await page.waitForFunction(()=>
    document.getElementById('scroller').classList.contains('proportional-font'));
  assert.equal(await page.locator('#font-proportional').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#font-mono').getAttribute('aria-pressed'),'false');
  const proportionalX=(await position(0,10)).x;
  assert.ok(Math.abs(proportionalX-monoX)>3,
    'proportional font must change measured pixel geometry');
  assert.deepEqual((await snap()).selection,state.selection,
    'changing the font must not change the selected physical coordinates');

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
  const rectangle=state.selection;
  await page.locator('#font-mono').click();
  await page.waitForFunction(()=>
    !document.getElementById('scroller').classList.contains('proportional-font'));
  assert.equal(await page.locator('#font-mono').getAttribute('aria-pressed'),'true');
  assert.deepEqual((await snap()).selection,rectangle,
    'changing back to monospaced must preserve a rectangular selection');
  assert.ok(await page.locator('.mark').count()>=3);
  await page.locator('#scroller').focus();
  await page.keyboard.type('Q');
  state=await snap();
  assert.equal(state.selection.length,3);
  assert.ok(state.text.includes('aQha')||state.text.includes('aQa'),
    'text edits go through actual TextEdit across rectangle selections');

  // Compare the same real source in natural and snapped cell-grid modes.
  const source=['A漢B😀e\u0301\tZ','A字B😀e\u0301\tZ','A\t👩‍👩‍👧‍👦B'].join('\n');
  await page.evaluate(text=>window.__guiProbe.setText(text),source);
  await page.waitForFunction(()=>window.__guiProbe.snapshot().text.includes('漢'));
  const stableSource=(await snap()).text;
  const naturalGeometry=await page.evaluate(()=>window.__guiProbe.geometry(0));
  await page.locator('#mode-grid').click();
  await page.waitForFunction(()=>window.__guiProbe.snapshot().mode==='grid'&&
    document.querySelectorAll('.grid-cell').length>0);
  state=await snap();
  assert.equal(state.text,stableSource,'cell grid must not change document content');
  assert.equal(await page.locator('#mode-grid').getAttribute('aria-pressed'),'true');
  assert.ok(state.cellPixels>4);
  const gridGeometry=await page.evaluate(()=>window.__guiProbe.geometry(0));
  const at=(positions,index)=>positions.find(p=>p.index===index);
  const approx=(actual,expected)=>Math.abs(actual-expected)<.6;
  assert.ok(approx(at(gridGeometry,1).x,state.cellPixels));
  assert.ok(approx(at(gridGeometry,2).x,3*state.cellPixels),
    'Han grapheme must reserve exactly two logical cells');
  const emojiColumn=at(gridGeometry,5).col.col;
  assert.ok(emojiColumn>=6,'emoji must reserve at least two cells');
  assert.ok(approx(at(gridGeometry,5).x,emojiColumn*state.cellPixels),
    'font-fallback emoji reserves an integer cell span without compression');
  assert.equal(at(gridGeometry,7).col.col,emojiColumn+1,
    'decomposed e + accent is one indivisible logical cell');
  const nextTabStop=4*Math.ceil((emojiColumn+1)/4);
  assert.equal(at(gridGeometry,8).col.col,nextTabStop,
    'tab advances to the next logical 4-column boundary');
  assert.ok(approx(at(gridGeometry,8).x,nextTabStop*state.cellPixels));
  const tabGeometry=await page.evaluate(()=>window.__guiProbe.geometry(2));
  const endTab=tabGeometry.find(p=>p.index===2);
  assert.equal(endTab.col.col,4,'tab after first ASCII cell advances three cells');
  assert.ok(approx(endTab.x,4*state.cellPixels));
  assert.ok(at(naturalGeometry,5).x!==at(gridGeometry,5).x,
    'natural font advances and snapped grid are independent renderers');

  // In-grid mouse positioning must resolve actual grapheme boundaries.
  let target=await position(0,5);await page.mouse.click(target.x,target.y);
  state=await snap();
  assert.equal(state.selection[0].end.col,5);
  await page.locator('#scroller').focus();
  await page.keyboard.press('Backspace');
  state=await snap();
  assert.ok(state.text.startsWith('A漢Be\u0301'),'backspace removes the emoji as one grapheme');

  // Reset fixture and exercise a rectangular selection across wide kanji.
  await page.evaluate(text=>window.__guiProbe.setText(text),source);
  await page.waitForFunction(()=>window.__guiProbe.snapshot().mode==='grid'&&
    document.querySelector('.row[data-row="1"] .grid-cell'));
  const left=await position(0,1),right=await position(1,2);
  await page.keyboard.down('Alt');
  await page.mouse.move(left.x,left.y);await page.mouse.down();
  await page.mouse.move(right.x,right.y,{steps:6});await page.mouse.up();
  await page.keyboard.up('Alt');
  state=await snap();
  assert.equal(state.selection.length,2,'grid rectangle spans exactly two source rows');
  assert.deepEqual(state.selection.map(x=>x.start.col),[1,1]);
  assert.ok(state.selection.every(x=>x.end.col>=2),
    'grid rectangle includes complete wide graphemes');
  assert.equal(state.text,source);
  await page.locator('#mode-natural').click();
  await page.waitForFunction(()=>window.__guiProbe.snapshot().mode==='natural');
  assert.equal((await snap()).text,source);
  assert.deepEqual((await snap()).selection,state.selection,
    'renderer changes never rewrite physical selections');

  // Scroll a genuinely large PieceDocument without mounting 100k DOM rows.
  await page.locator('#large').click();
  await page.waitForFunction(()=>window.__guiProbe.snapshot().rows===100000);
  state=await snap();
  assert.ok(state.mounted<90);
  // Native scrollbar track interactions are NOT text pointer drags.
  // Regression: formerly pointerdown on the scroll container selected from
  // the document caret to the top/bottom during scrollbar dragging.
  const beforeScrollbar=state.selection;
  const bounds=await page.locator('#scroller').boundingBox();
  const scrollX=bounds.x+bounds.width-3;
  const scrollY=bounds.y+bounds.height*.3;
  await page.mouse.move(scrollX,scrollY);
  await page.mouse.down();
  await page.mouse.move(scrollX,scrollY+125,{steps:6});
  await page.mouse.up();
  state=await snap();
  assert.deepEqual(state.selection,beforeScrollbar,
    'native scrollbar gesture must not change text selection');

  await page.locator('#jump').click();
  await page.waitForFunction(()=>window.__guiProbe.snapshot().first>=49000);
  state=await snap();
  assert.ok(state.mounted<90&&state.maxMounted<90);
  assert.equal(state.rows,100000);
  // Row 50053 (1-based) is intentionally among every 97th Unicode row.
  await page.evaluate(()=>{document.getElementById('scroller').scrollTop=50052*24;});
  await page.waitForFunction(()=>document.querySelector('.row[data-row="50052"]'));
  const unicodeFixture=await page.evaluate(()=>{
    // Actual visible DOM projection: the GUI stores no duplicate document.
    const content=row=>document.querySelector('.row[data-row="'+row+'"] .content')?.textContent;
    return {unicode:content(50052),ordinary:content(50053)};
  });
  assert.ok(unicodeFixture.unicode.includes('😀e\u0301'));
  assert.ok(!unicodeFixture.ordinary.includes('😀e\u0301'));
  assert.equal(errors.length,0,'no browser script errors: '+errors.join(' | '));
  console.log(JSON.stringify({pass:true,version:state.version,
    rendered:state.mounted,maxMounted:state.maxMounted,
    jumpedToRow:state.first+1,tests:['keyboard-input','keyboard-range',
    'font-proportional','mouse-drag','alt-rectangle','font-selection-stability','multi-selection-edit','wide-unicode-grid','tab-cells','grapheme-backspace','grid-rectangle','scrollbar-does-not-select','viewport-100k']}));
}finally{
  await browser.close();
}
