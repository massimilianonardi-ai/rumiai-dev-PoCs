// PoC-only evidence: advertised implicit UTF-16 units over the actual
// compiled RawDocument2D, real Chromium input, and Linux process samples.
// This does not validate a shipped contract, peak allocations or ARM64.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/presentation.html';

// Linux-only process-tree RSS, as a contextual indicator: RSS of separate
// Chromium children can double-count shared mapped pages. Not USS/PSS.
function browserTreeRSSKiB()
{
  const entries=execFileSync('ps',['-e','-o','pid=,ppid=,rss='],
    {encoding:'utf8'}).trim().split('\n').map(line=>
  {
    const [pid,ppid,rss]=line.trim().split(/\s+/).map(Number);
    return {pid,ppid,rss};
  }).filter(item=>Number.isFinite(item.pid));
  const descendants=new Set([process.pid]);
  let changed=true;
  while(changed)
  {
    changed=false;
    for(const item of entries)
    {
      if(descendants.has(item.ppid) && !descendants.has(item.pid))
      {
        descendants.add(item.pid);
        changed=true;
      }
    }
  }
  const children=entries.filter(item=>item.pid!==process.pid &&
    descendants.has(item.pid));
  return {
    processes:children.length,
    rssKiB:children.reduce((sum,item)=>sum+item.rss,0)
  };
}

const modes=['aggregate','expanded','packed','direct','implicit'];
const benchmark=[];
for(const mode of modes)
{
  // Restart Chromium itself for each mode to limit RSS contamination.
  const browser=await chromium.launch({
    headless:true,args:['--no-sandbox','--enable-precise-memory-info']
  });
  try
  {
    const page=await browser.newPage({viewport:{width:1100,height:760}});
    const response=await page.goto(url,{waitUntil:'load'});
    assert.equal(response.status(),200);
    await page.waitForFunction(
      ()=>window.__presentationProbe?.snapshot()?.paints>0
    );
    const session=await page.context().newCDPSession(page);
    await session.send('HeapProfiler.collectGarbage');
    const baseline=(await session.send('Runtime.getHeapUsage')).usedSize;
    const rssBefore=browserTreeRSSKiB();
    assert.ok(rssBefore.processes>0,'Chromium process descendants required');

    let rssSampleMax=rssBefore.rssKiB;
    let rssSamples=0;
    const timer=setInterval(()=>
    {
      const sample=browserTreeRSSKiB();
      rssSampleMax=Math.max(rssSampleMax,sample.rssKiB);
      rssSamples++;
    },25);
    let result;
    try
    {
      result=await page.evaluate(
        mode=>window.__presentationProbe.benchmarkDirect(mode,4096,24),
        mode
      );
    }
    finally {clearInterval(timer);}
    const beforeGC=(await session.send('Runtime.getHeapUsage')).usedSize;
    const rssBeforeGC=browserTreeRSSKiB();
    await session.send('HeapProfiler.collectGarbage');
    const afterGC=(await session.send('Runtime.getHeapUsage')).usedSize;
    const rssAfterGC=browserTreeRSSKiB();
    assert.ok(result.sourceUTF16Length>=100000);
    assert.ok(result.payloadUTF8>0);
    if(mode==='expanded') assert.equal(result.outputRegions,4096);
    else assert.equal(result.outputRegions,1);
    benchmark.push({
      mode,width:result.width,retainedWindows:result.repeats,
      payloadUTF8:result.payloadUTF8,
      outputRegions:result.outputRegions,
      heapBeforeBytes:baseline,
      heapUncollectedAfterBytes:beforeGC,
      heapAfterGCBytes:afterGC,
      heapRetainedDeltaBytes:afterGC-baseline,
      rssBeforeKiB:rssBefore.rssKiB,
      rssAfterNoGCKiB:rssBeforeGC.rssKiB,
      rssAfterGCKiB:rssAfterGC.rssKiB,
      rssSampleMaxKiB:rssSampleMax,
      rssSamples,medianMs:Number(result.medianMs.toFixed(4))
    });
    await session.detach();
    await page.close();
  }
  finally {await browser.close();}
}

// All presentation modes use one unchanged GUI consumer. The scrollbar
// gesture changes the bounded source window, not the underlying 100k+
// source or the number of mounted elements.
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try
{
  const page=await browser.newPage({viewport:{width:1100,height:760}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  await page.locator('#backend').selectOption('piece');
  await page.locator('#mode').selectOption('raw');
  await page.locator('#fixture').selectOption('long');
  const modesDOM=['expanded','compact','direct','implicit'];
  const scenarios=[];
  for(const mode of modesDOM)
  {
    await page.locator('#transport').selectOption(mode);
    await page.waitForFunction(
      mode=>window.__presentationProbe?.snapshot()?.transport===mode,
      mode
    );
    const selections=[];
    async function checkpoint(expectedStart)
    {
      await page.waitForFunction(
        expected=>window.__presentationProbe?.snapshot()
          ?.viewportColStart===expected,
        expectedStart
      );
      const snap=await page.evaluate(
        ()=>window.__presentationProbe.snapshot()
      );
      const elements=await page.locator('#rows .unit').count();
      const rows=await page.locator('#rows .row').count();
      assert.ok(snap.sourceText.length>100000);
      assert.equal(elements,100,'bounded 100-column viewport DOM');
      assert.equal(rows,1);
      assert.deepEqual(snap.rendered.filter(r=>r.clipped),[]);
      assert.equal(snap.rendered[0].start,expectedStart);
      assert.equal(snap.rendered.at(-1).end,expectedStart+100);
      selections.push({
        offset:expectedStart,mountedUnits:elements,mountedRows:rows,
        visible:snap.rendered.map(x=>[
          x.start,x.end,x.text,x.kind
        ])
      });
    }
    await checkpoint(0);
    await page.locator('#scroller').hover();
    await page.keyboard.down('Shift');
    try
    {
      for(const [delta,start] of [[100,100],[700,800],[-300,500]])
      {
        await page.mouse.wheel(0,delta);
        await checkpoint(start);
      }
    }
    finally {await page.keyboard.up('Shift');}
    scenarios.push({mode,selections});
  }
  for(const test of scenarios.slice(1))
  {
    assert.deepEqual(
      test.selections,scenarios[0].selections,
      'all formats must render equal units after real wheel paging'
    );
  }

  // Reject malformed or undeclared implicit boundaries instead of
  // silently treating unknown packed data as ordinary text.
  const codecChecks=await page.evaluate(()=>
  {
    const codec=globalThis.__presentationTransport;
    const value={
      kind:'text',text:'😀\u0301',unitEncoding:'utf16',
      start:{row:0,col:5},end:{row:0,col:8},
      glyphs:[[0,'H'],[1,'L'],[2,'◌\u0301']]
    };
    const units=codec.unpackRows([[value]])[0];
    const expected=[
      ['\ud83d',5,6,'H'],
      ['\ude00',6,7,'L'],
      ['\u0301',7,8,'◌\u0301']
    ];
    const actual=units.map(unit=>[
      unit.text,unit.start.col,unit.end.col,
      unit.displayText??unit.text
    ]);
    const negatives=[
      {...value,unitEncoding:'unknown'},
      {...value,end:{row:0,col:9}},
      {...value,kind:'annotation'},
      {...value,glyphs:[[0,'H'],[0,'duplicate']]},
      {...value,glyphs:[[99,'out-of-range']]}
    ];
    const rejected=negatives.map(data=>
    {
      try {codec.unpackRows([[data]]);return false;}
      catch(error) {return error instanceof RangeError;}
    });
    return {actual,expected,rejected};
  });
  assert.deepEqual(codecChecks.actual,codecChecks.expected);
  assert.deepEqual(codecChecks.rejected,[true,true,true,true,true]);

  // Complete the user's normal path: edit after paging in implicit mode.
  await page.locator('.unit').nth(1).click();
  await page.locator('#scroller').focus();
  await page.keyboard.type('Q');
  await page.waitForFunction(
    ()=>window.__presentationProbe.snapshot().sourceRevision===1
  );
  const edited=await page.evaluate(
    ()=>window.__presentationProbe.snapshot()
  );
  assert.equal(edited.lastEvent?.invalidation,true);
  assert.ok(edited.sourceText.includes('Q'));
  assert.deepEqual(errors,[]);

  console.log(JSON.stringify({
    status:'PASS',source:'real pinned Raw/Piece core + PoC declared implicit codec',
    benchmark,
    wheelDOM:scenarios.map(({mode,selections})=>({
      mode,positions:selections.map(x=>x.offset),
      unitCounts:selections.map(x=>x.mountedUnits)
    })),
    negatives:codecChecks.rejected.length,
    caveat:'JS heap sampled immediately after evaluation and after GC; no guaranteed within-call peak. Linux ps child-tree sum RSS double-counts shared pages and 25-ms samples miss shorter peaks. Medians descriptive, Ubuntu hosted x64 only.'
  }));
  await page.close();
}
finally {await browser.close();}
