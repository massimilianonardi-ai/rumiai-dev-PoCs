/* Browser-level experiment; all physical selections are real TextEdit 0.8.1.
 * The independent 2D selection geometry is NOT a product API.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1180,height:900}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

try
{
  const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/regions.html';
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>!!window.__regionsProbe);
  const call=(fn,...args)=>page.evaluate(
    ({fn,args})=>window.__regionsProbe[fn](...args),{fn,args});
  const state=()=>call('snapshot');
  const selection=(a,b)=>call('select',a,b);
  const box=(row,col)=>({row,col});
  const source='A\tB\nfold alpha\nfold beta\nfold gamma\n0123456789\nuvwxyzABCD';

  let s=await state();
  assert.equal(s.version,'0.8.1');
  assert.equal(s.text,source);
  assert.equal(s.sourceRows,6);
  assert.equal(s.visualRows,4);
  assert.deepEqual(s.replacements.map(r=>r.text),['[3 folded rows]']);
  assert.deepEqual(s.annotations.map(a=>a.id),['info']);
  assert.equal(s.physical.length,0);

  const tab=s.regions.find(r=>r.kind==='tab');
  const folding=s.regions.find(r=>r.kind==='fold');
  const note=s.regions.find(r=>r.kind==='annotation');
  assert.deepEqual([tab.row,tab.col,tab.width,tab.height],[0,1,3,1]);
  assert.deepEqual([folding.row,folding.col,folding.width,folding.height],[1,0,6,1]);
  assert.deepEqual([note.row,note.col,note.width,note.height],[2,12,4,2]);
  assert.equal(note.source,null);

  // One-cell high-level request selects entire multi-cell tab by intersection.
  s=await selection(box(0,2),box(0,2));
  assert.deepEqual(s.selected,[tab.id]);
  assert.equal(s.requested.width,1);
  assert.deepEqual(s.physical,[{
    start:{row:0,col:1},end:{row:0,col:2},forward:true
  }]);
  assert.equal(s.text,source);
  assert.equal(s.revision,0);
  assert.equal(await page.locator('.region.tab.selected').count(),1);

  // Whole-coverage rule rejects partial requested rectangles.
  await call('setPolicy','tab','full');
  s=await selection(box(0,2),box(0,2));
  assert.deepEqual(s.selected,[]);
  assert.deepEqual(s.physical,[]);
  s=await selection(box(0,1),box(0,3));
  assert.deepEqual(s.selected,[tab.id]);
  assert.equal(s.physical.length,1);
  // Reverse-direction high-level rectangle has the same resolved coverage.
  s=await selection(box(0,3),box(0,1));
  assert.deepEqual(s.selected,[tab.id]);

  await call('setPolicy','tab','none');
  s=await selection(box(0,1),box(0,3));
  assert.ok(!s.selected.includes(tab.id));
  assert.equal(s.physical.length,0);

  // A source-range folding placeholder represents three hidden source rows.
  s=await selection(box(1,2),box(1,2));
  assert.deepEqual(s.selected,['fold']);
  assert.equal(s.physical.length,1);
  assert.deepEqual(s.physical[0].start,{row:1,col:0});
  assert.deepEqual(s.physical[0].end,{row:4,col:0});
  assert.equal(await page.locator('.region.fold.selected').count(),1);

  await call('setPolicy','fold','full');
  s=await selection(box(1,2),box(1,2));
  assert.deepEqual(s.selected,[]);
  s=await selection(box(1,0),box(1,5));
  assert.deepEqual(s.selected,['fold']);
  await call('setPolicy','fold','none');
  s=await selection(box(1,0),box(1,5));
  assert.deepEqual(s.selected,[]);

  // Visual-only annotation can be selected and highlighted without producing
  // a fictitious source selection or a hidden physical insertion target.
  s=await selection(box(2,13),box(2,13));
  assert.deepEqual(s.selected,['annotation']);
  assert.deepEqual(s.physical,[]);
  assert.equal(await page.locator('.region.annotation.selected').count(),1);
  const noSourceEdit=await call('replace','X');
  assert.deepEqual(noSourceEdit,{changed:false,revision:0});
  assert.equal((await state()).text,source);

  await call('setPolicy','annotation','full');
  s=await selection(box(2,12),box(2,15));
  assert.deepEqual(s.selected,[],'only one of two annotation rows is not full coverage');
  s=await selection(box(3,15),box(2,12));
  assert.deepEqual(s.selected,['annotation']);
  assert.deepEqual(s.physical,[]);
  await call('setPolicy','annotation','none');
  s=await selection(box(2,12),box(3,15));
  assert.deepEqual(s.selected,[]);

  // Same conceptual rule as existing AdvancedSelections clipped EOL:
  // requested cells beyond source EOL do not become effective source ranges.
  s=await selection(box(2,9),box(2,16));
  assert.equal(s.requested.width,8);
  assert.deepEqual(s.selected,['source:4:9']);
  assert.deepEqual(s.physical,[{
    start:{row:4,col:9},end:{row:4,col:10},forward:true
  }]);
  const nativeClipped=await page.evaluate(()=>
  {
    const native=new TextEdit.TextEdit('0123456789');
    native.advancedSelections.setPolicy('clipped');
    native.advancedSelections.rectangularSelection(
      {row:0,col:9},{row:0,col:16});
    const selection=native.selections.getSelections();
    native.dispose();
    return selection;
  });
  assert.deepEqual(nativeClipped,[{
    start:{row:0,col:9},end:{row:0,col:10},forward:true
  }],'requested vs effective semantics agree with existing clipped baseline');

  // Mixed tab+fold selection must deduplicate physical intervals and commit
  // a single atomic user replacement through the real TextEdit facade.
  await call('setPolicy','tab','touch');
  await call('setPolicy','fold','touch');
  s=await selection(box(0,2),box(1,2));
  assert.ok(s.selected.includes('fold'));
  assert.ok(s.selected.includes('source:0:1'));
  assert.equal(s.physical.length,2);
  assert.equal(s.revision,0);
  const write=await call('replace','X');
  assert.equal(write.changed,true);
  assert.equal(write.revision,1);
  s=await state();
  assert.equal(s.text,'AXB\nX0123456789\nuvwxyzABCD');
  assert.equal(s.revision,1);
  assert.equal(s.replacements.length,0,'source editing invalidates the fold overlay');
  assert.equal(s.sourceRows,3);
  assert.equal(s.visualRows,3);
  assert.equal(s.selected.length,0);

  // Real browser pointer drag and DOM highlight are coupled to one resolved
  // selection; plain source characters remain separate from virtual cells.
  await call('reset');
  const first=await call('cellPoint',2,0);
  const last=await call('cellPoint',2,2);
  await page.mouse.move(first.x,first.y);
  await page.mouse.down();
  await page.mouse.move(last.x,last.y,{steps:5});
  await page.mouse.up();
  s=await state();
  assert.deepEqual(s.selected,['source:4:0','source:4:1','source:4:2']);
  assert.equal(s.physical.length,1);
  assert.deepEqual(s.physical[0].start,{row:4,col:0});
  assert.deepEqual(s.physical[0].end,{row:4,col:3});
  assert.equal(await page.locator('.region.text.selected').count(),3);

  assert.deepEqual(errors,[],'no browser errors');
  console.log(JSON.stringify({
    pass:true,version:s.version,
    tests:['source-mapped-tab','fold-multiline','visual-only-annotation',
      'none-touch-full','reverse-geometry','clipped-eol-equivalence',
      'physical-union','atomic-source-replace','real-pointer-highlight']
  }));
}
finally
{
  await browser.close();
}
