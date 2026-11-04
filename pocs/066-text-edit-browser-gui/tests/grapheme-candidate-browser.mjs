// Real compiled Document2D integration, but from an explicitly PATCHED
// disposable experimental copy of the product core, NOT released product.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const candidate=resolve(
  'rumiai-os/lib/sys/js/core/document2d-candidate.generated.js'
);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1100,height:760}});
const errors=[];
let routed=0;
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/document2d-browser.generated.js',async route=>
{
  routed++;
  await route.fulfill({path:candidate,contentType:'application/javascript'});
});

const url='http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/presentation.html';
const result={};
try
{
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>window.__presentationProbe?.snapshot()?.paints>0);
  assert.equal(routed,1,'the browser must load the candidate compiled core');

  // The known actual upstream mismatch is the principal regression target.
  const diagnostic=await page.evaluate(()=>window.__presentationProbe.compareZWJ());
  assert.ok(diagnostic.standard.some(x=>x.text==='👩‍💻'),
    'aggregated Raw still preserves the ZWJ grapheme');
  assert.ok(diagnostic.atomized.some(x=>x.text==='👩‍💻'),
    'candidate compiled Cell must preserve ZWJ over per-unit Raw');
  assert.ok(!diagnostic.atomized.some(x=>x.text==='👩‍'||x.text==='💻'),
    'candidate must not publish incomplete ZWJ graphemes');

  result.core=await page.evaluate(()=>
  {
    const D=window.m.text.document;
    const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
    const cases=[
      'A👩‍💻Z',
      'A👨‍👩‍👧‍👦Z',
      'A👩🏽‍🚀Z',
      'A🇮🇹🇪🇺Z',
      'Ae\u0301Z',
      'Aक्‍षZ',
      'A😀\t👩‍💻Z',
      ...[2045,2046,2047,2048,2049].flatMap(n=>
        ['👩‍💻','🇮🇹','e\u0301','👨‍👩‍👧‍👦'].map(
          cluster=>'a'.repeat(n)+cluster+'Z'
        )
      )
    ];
    const eq=(a,b,message)=>
    {
      if(JSON.stringify(a)!==JSON.stringify(b))
      {
        throw new Error(message+'; actual='+JSON.stringify(a).slice(-170)
          +'; expected='+JSON.stringify(b).slice(-170));
      }
    };
    const ensure=(predicate,message)=>
    {
      if(!predicate) throw new Error(message);
    };
    function atomicRaw(input)
    {
      return new Proxy(input,{
        get(target,key)
        {
          if(key==='getRegions')
          {
            return (...args)=>target.getRegions(...args).map(row=>
              row.flatMap(region=>
              {
                if(region.kind!=='text') return [region];
                return Array.from({length:region.text.length},(_,index)=>
                {
                  const col=region.start.col+index;
                  return {kind:'text',text:region.text[index],
                    start:{row:region.start.row,col},
                    end:{row:region.start.row,col:col+1}};
                });
              })
            );
          }
          const value=Reflect.get(target,key,target);
          return typeof value==='function'?value.bind(target):value;
        },
        set(target,key,value) {return Reflect.set(target,key,value,target);}
      });
    }
    const stats={backends:[],cases:cases.length,comparisons:0,
      annotationAndNested:0,foldAndSubstitution:0,atomicEdits:0,
      selectedInsertions:0};
    for(const [label,Backend] of [
      ['FlatDocument',D.FlatDocument],['PieceDocument',D.PieceDocument]
    ])
    {
      stats.backends.push(label);
      for(const content of cases)
      {
        const physical=new Backend(content+'\nHIDDEN\nTAIL');
        const raw=new D.RawDocument2D(physical);
        const cell=new D.CellDocument2D(atomicRaw(raw),4);
        const annotation=new D.AnnotationDocument2D(cell);
        const nested=new D.CellDocument2D(annotation,4);
        const fold=new D.FoldDocument2D(nested);
        const substitution=new D.SubstitutionDocument2D(nested);
        try
        {
          const expected=Array.from(segmenter.segment(content),x=>x.segment);
          const direct=cell.getRegions(0,0,1,content.length+16)[0];
          const actual=direct.map(x=>x.text);
          eq(actual,expected,label+' first Cell segmentation');
          ensure(direct.length>0 &&
            direct.at(-1).end.col===cell.getRowWidth(0),
            label+' Cell width inconsistent');
          stats.comparisons++;

          annotation.setAnnotations([
            {id:'at-one',text:'meta',at:{row:0,col:1}}
          ]);
          const projected=nested.getRegions(0,0,1,content.length+16)[0];
          eq(projected.filter(x=>x.kind!=='annotation').map(x=>x.text),
            expected,label+' nested/annotated Cell segmentation');
          ensure(projected.some(x=>x.kind==='annotation' &&
            x.id==='at-one' && x.start.col===x.end.col &&
            x.start.col===1),label+' annotation coordinate');
          stats.annotationAndNested++;

          fold.setFolds([{startRow:1,endRow:2}]);
          ensure(fold.getRegions(1,0,2,5)[0].some(x=>x.kind==='fold'),
            label+' fold marker missing');
          ensure(fold.getRegions(0,0,1,content.length+16)[0]
            .some(x=>x.text===expected.at(-2)||x.text===expected.at(-1)),
            label+' fold should leave row 0 visible');
          const beforeFold=physical.toString();
          const beforeFoldRevision=physical.revision;
          let foldDenied=false;
          try
          {
            fold.replace([{start:{row:1,col:0},
              end:{row:1,col:1},text:'X'}],fold.revision);
          }
          catch(error) {foldDenied=error instanceof Error;}
          ensure(foldDenied && physical.toString()===beforeFold &&
            physical.revision===beforeFoldRevision,
            label+' protected fold mutation must be refused');

          substitution.setSubstitutions([
            {id:'protected',text:'LONG',start:{row:0,col:1},
              end:{row:0,col:2}}
          ]);
          const protectedRegion=substitution
            .getRegions(0,0,1,content.length+16)[0]
            .find(x=>x.kind==='substitution' && x.id==='protected');
          ensure(protectedRegion?.text==='LONG',
            label+' substitution missing');
          let substitutionDenied=false;
          try
          {
            substitution.replace([{
              start:protectedRegion.start,
              end:protectedRegion.end,text:'X'
            }],substitution.revision);
          }
          catch(error) {substitutionDenied=error instanceof Error;}
          ensure(substitutionDenied && physical.toString()===beforeFold &&
            physical.revision===beforeFoldRevision,
            label+' protected substitution mutation must be refused');
          stats.foldAndSubstitution++;

          // A selected insertion and explicit atomic edit use only the
          // published Document2D operations, never physical offsets.
          nested.setSelections([{
            start:{row:0,col:0},end:{row:0,col:0},forward:true
          }]);
          const revision=physical.revision;
          nested.insert('Q');
          ensure(physical.revision===revision+1 &&
            physical.toString()==='Q'+beforeFold,
            label+' selected insert should commit exactly once');
          stats.selectedInsertions++;

          const afterInsert=physical.toString();
          const beforeEdit=physical.revision;
          nested.replace([{start:{row:0,col:0},
            end:{row:0,col:1},text:'R'}],nested.revision);
          ensure(physical.revision===beforeEdit+1 &&
            physical.toString()==='R'+afterInsert.slice(1),
            label+' explicit edit should commit exactly once');
          stats.atomicEdits++;
        }
        finally
        {
          substitution.destroy();
          fold.destroy();
          nested.destroy();
          annotation.destroy();
          cell.destroy();
          raw.destroy();
        }
      }
    }
    return stats;
  });

  // Exercise actual DOM rendering and mouse/keyboard interaction using
  // the same unchanged GUI consuming only public Document2D regions.
  result.gui={};
  for(const backend of ['flat','piece'])
  {
    for(const mode of ['cell','nested','annotation','fold','substitution'])
    {
      await page.locator('#backend').selectOption(backend);
      await page.locator('#fixture').selectOption('mixed');
      await page.locator('#mode').selectOption(mode);
      await page.locator('#transport').selectOption('compact');
      await page.locator('#reset').click();
      await page.waitForFunction(
        p=>{
          const s=window.__presentationProbe?.snapshot();
          return s && s.mode===p.mode && s.backend===p.backend &&
            s.transport==='compact' && s.paints>0;
        },{mode,backend}
      );
      const state=await page.evaluate(()=>window.__presentationProbe.snapshot());
      assert.ok(state.regions.some(x=>x.text==='👩‍💻'),
        backend+'/'+mode+' needs one full grapheme region');
      assert.ok(state.rendered.some(x=>x.text==='👩‍💻'),
        backend+'/'+mode+' must show one whole rendered grapheme');
      assert.deepEqual(state.rendered.filter(x=>x.clipped),[],
        backend+'/'+mode+' must not clip');
      assert.equal(state.sourceRevision,0);
      result.gui[backend+'-'+mode]='PASS';

      if(mode==='fold'||mode==='substitution')
      {
        const protectedAttempt=await page.evaluate(
          ()=>window.__presentationProbe.attemptProtected()
        );
        assert.equal(protectedAttempt?.rejected,true);
        assert.equal(protectedAttempt?.unchanged,true);
      }
    }

    await page.locator('#mode').selectOption('cell');
    await page.locator('#reset').click();
    await page.waitForFunction(
      ()=>window.__presentationProbe?.snapshot()?.paints>0
    );
    const initial=await page.evaluate(()=>window.__presentationProbe.snapshot());
    const emoji=page.locator('.unit[data-kind="text"]').filter({
      hasText:'👩‍💻'
    }).first();
    assert.equal(await emoji.count(),1);
    await emoji.click();
    await page.locator('#scroller').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('Q');
    await page.waitForFunction(
      ()=>window.__presentationProbe.snapshot().sourceRevision===1
    );
    const after=await page.evaluate(()=>window.__presentationProbe.snapshot());
    assert.ok(after.sourceText.includes('👩‍💻'));
    assert.ok(after.sourceText.includes('Q'));
    assert.ok(after.paints>=initial.paints);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({
    status:'PASS',source:'disposable patched real compiled CellDocument2D',
    notProduction:true,compilerCoreRouted:routed,
    diagnostic:{aggregatedZWJ:true,atomizedZWJ:true},
    ...result
  }));
}
finally
{
  await browser.close();
}
