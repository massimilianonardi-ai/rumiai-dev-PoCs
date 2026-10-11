// Real PoC text stores behind fault-injecting single-range adapters.
// Recovery must preserve exact text + canonical oriented selection order.
// This is a core test, with no DOM, IME or external undo/history involvement.
import assert from 'node:assert/strict';
import {FlatDocument,PieceDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';

const select=at=>({start:at,end:at,forward:true});
let recovered=0,failedClosed=0;
for(const Store of [FlatDocument,PieceDocument,AdaptiveRepackDocument]){
  for(const faultAt of [1,2,3]){
    for(const timing of ['before','after']){
      const source='aa\nbb\ncc\n😀e\u0301漢Z';
      const original=[select(0),select(3),select(6)];
      const real=new Store(source);
      let calls=0;
      const port={
        get length(){return real.length;},
        slice:(start,end)=>real.slice(start,end),
        replace(start,end,insert){
          calls++;
          if(calls===faultAt&&timing==='before')
            throw Error('injected backend failure');
          real.replace(start,end,insert);
          if(calls===faultAt&&timing==='after')
            throw Error('injected backend failure');
        }
      };
      const editor=new TextEditSelections(port);
      editor.setSelections(original);
      assert.throws(()=>editor.replace(['A','B','C']),
        /injected backend failure/);
      assert.equal(real.slice(0,real.length),source,
        Store.name+' '+timing+'/'+faultAt+' must roll back ALL writes');
      assert.deepEqual(editor.getSelections(),original,
        'selection snapshot must survive recovered backend failure');
      assert.ok(calls>=faultAt,'rollback may require compensating writes');
      const change=editor.replace('!');
      assert.equal(change.changes.length,3,
        'editor must remain usable after verified recovery');
      assert.equal(real.slice(0,real.length),'!aa\n!bb\n!cc\n😀e\u0301漢Z');
      recovered++;
    }
  }
  // Fault after writing only PART of the requested string is unknowable via
  // the minimal port: cannot manufacture a guarantee of restored state.
  {
    const real=new Store('aa\nbb\ncc');
    let calls=0;
    const port={
      get length(){return real.length;},
      slice:(a,b)=>real.slice(a,b),
      replace(a,b,s){
        calls++;
        if(calls===2){
          real.replace(a,b,'partial');
          throw Error('injected partial backend mutation');
        }
        return real.replace(a,b,s);
      }
    };
    const editor=new TextEditSelections(port);
    editor.setSelections([select(0),select(3),select(6)]);
    assert.throws(()=>editor.replace(['A','B','C']),error=>
      error instanceof AggregateError &&
      error.errors.some(e=>/partial backend mutation/.test(e.message)) &&
      error.errors.some(e=>/unrecognizable/.test(e.message)));
    assert.throws(()=>editor.replace('x'),/state is uncertain/);
    assert.throws(()=>editor.setSelections([select(0)]),/state is uncertain/);
    failedClosed++;
  }
  // The compensation itself fails: never declare success, never permit edits.
  {
    const real=new Store('aa\nbb\ncc');
    let calls=0;
    const port={
      get length(){return real.length;},
      slice:(a,b)=>real.slice(a,b),
      replace(a,b,s){
        calls++;
        if(calls===2)throw Error('original backend failure');
        if(calls===3)throw Error('compensation failed');
        real.replace(a,b,s);
      }
    };
    const editor=new TextEditSelections(port);
    editor.setSelections([select(0),select(3),select(6)]);
    assert.throws(()=>editor.replace(['A','B','C']),error=>
      error instanceof AggregateError &&
      error.errors.some(e=>/original backend failure/.test(e.message)) &&
      error.errors.some(e=>/compensation failed/.test(e.message)));
    assert.throws(()=>editor.replace('x'),/state is uncertain/);
    failedClosed++;
  }
  // Large and disjoint ranges with a late post-mutation failure. No document
  // snapshot is taken: compensation needs only the original selected spans.
  {
    const source='z'.repeat(1024*1024);
    const real=new Store(source);
    const count=128,offsets=Array.from({length:count},
      (_,i)=>Math.floor((i+1)*source.length/(count+1)));
    let calls=0;
    const port={
      get length(){return real.length;},
      slice:(a,b)=>real.slice(a,b),
      replace(a,b,s){
        calls++;
        real.replace(a,b,s);
        if(calls===60)throw Error('injected later write failure');
      }
    };
    const editor=new TextEditSelections(port);
    const original=offsets.toReversed().map(at=>({
      start:at,end:at+1,forward:true
    }));
    editor.setSelections(original);
    assert.throws(()=>editor.replace('★'),/later write failure/);
    assert.equal(real.slice(0,real.length),source);
    assert.deepEqual(editor.getSelections(),original);
    recovered++;
  }
}
console.log(JSON.stringify({pass:true,backendCount:3,recoveredFaults:recovered,
  failClosedOnUncertainStore:failedClosed,
  exactTextAndSelectionRestored:true,completedAndPostMutationFailure:true,
  longDocumentWithoutFullSnapshot:true,uiIndependent:true}));
