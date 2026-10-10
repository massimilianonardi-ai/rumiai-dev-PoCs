import assert from 'node:assert/strict';
import {FlatDocument, AdaptiveRepackDocument} from '../src/documents.mjs';
import {AsyncHistory} from '../src/async-history.mjs';
import {CallbackJournal} from '../adapters/callback-journal.mjs';

// Emulates a remote storage service, not browser/HTTP/IndexedDB validation.
// A fresh adapter instance retains all data through shared external state.
function service() {
  const db = {entries: [], session: null, writes: 0};
  let failAppend = false;
  const connect = () => new CallbackJournal({
    count: async () => db.entries.length,
    read: async i => {
      await Promise.resolve();
      if (i < 0 || i >= db.entries.length) throw new RangeError('index');
      return structuredClone(db.entries[i]);
    },
    appendAt: async (i, entry) => {
      await Promise.resolve();
      if (failAppend) throw new Error('service write unavailable');
      db.entries.length = i;
      db.entries.push(structuredClone(entry));
      db.writes++;
    },
    readSession: async () => structuredClone(db.session),
    writeSession: async s => { await Promise.resolve(); db.session = structuredClone(s); }
  });
  return {db,connect,fail(v) {failAppend=v;}};
}

for (const Doc of [FlatDocument, AdaptiveRepackDocument]) {
  const initialText = 'alpha\nbeta\nhello 😀\n';
  const initialSelection = {primary: 1, ranges: [{anchor: 4, head: 2, virtualColumn: 8}, {anchor: 8, head: 8, virtualColumn: 4}]};
  const store = service();
  const history = await AsyncHistory.open(new Doc(initialText), store.connect(), initialSelection);
  const baseline = new FlatDocument(initialText);
  const afters = [];
  for (let i = 0; i < 160; i++) {
    const pos = (i*73 + 1) % (baseline.length + 1);
    const end = Math.min(baseline.length, pos + (i%5===0 ? 1 : 0));
    const pos2 = Math.min(baseline.length,end + 2);
    const edits = [{start:pos,end,insert:i%11===0?'😀':String(i%10)},{start:pos2,end:pos2,insert:'|'}];
    const after = {primary:i%2,ranges:[{anchor:i,head:160-i,virtualColumn:i%7},{anchor:i+1,head:i,virtualColumn:i%9}]};
    await history.commit(edits, after);
    for(let j=edits.length-1;j>=0;j--)baseline.replace(edits[j].start,edits[j].end,edits[j].insert);
    assert.equal(history.document.toString(),baseline.toString());
    afters.push({text:baseline.toString(),selection:after});
  }
  // Reopen a *new* editor against a fresh base document and a new provider
  // instance. Ordinary session recreation: history entries are retrieved lazily.
  const opened = await AsyncHistory.open(new Doc(initialText), store.connect());
  assert.equal(opened.document.toString(),baseline.toString());
  assert.deepEqual(opened.selection,afters.at(-1).selection);
  for(let i=159;i>=0;i--) {
    assert.equal(await opened.undo(),true);
    assert.equal(opened.document.toString(),i?afters[i-1].text:initialText);
    assert.deepEqual(opened.selection,i?afters[i-1].selection:initialSelection);
  }
  assert.equal(await opened.undo(),false);
  for(let i=0;i<160;i++) {
    assert.equal(await opened.redo(),true);
    assert.equal(opened.document.toString(),afters[i].text);
    assert.deepEqual(opened.selection,afters[i].selection);
  }
  assert.equal(await opened.redo(),false);
  for(let i=0;i<45;i++)await opened.undo();
  // Cursor persists after a clean, normal reopen; undone entries remain redoable.
  const reattached = await AsyncHistory.open(new Doc(initialText),store.connect());
  assert.equal(reattached.document.toString(),afters[114].text);
  assert.equal(await reattached.redo(),true);
  assert.equal(reattached.document.toString(),afters[115].text);
  store.fail(true);
  const preText=reattached.document.toString(),preSelection=structuredClone(reattached.selection);
  await assert.rejects(reattached.commit([{start:0,end:0,insert:'!'}]),/service write unavailable/);
  assert.equal(reattached.document.toString(),preText);
  assert.deepEqual(reattached.selection,preSelection);
  store.fail(false);
  await reattached.commit([{start:0,end:0,insert:'BRANCH'}]);
  assert.equal(await reattached.redo(),false);
  assert.equal(store.db.entries.length,117);
  const freshAgain=await AsyncHistory.open(new Doc(initialText),store.connect());
  assert.equal(freshAgain.document.toString(),reattached.document.toString());
  assert.deepEqual(freshAgain.selection,reattached.selection);
  console.log(JSON.stringify({document:Doc.name,passed:true,storedOperations:store.db.entries.length,adapter:'async callback service simulation',fullUndoRedo:160}));
}
// Deliberate isolation: the asynchronous port never imports Node.js or browser APIs.

// Actual asynchronous Node file adapter through precisely the same core port.
// This is a clean-close/reopen check, deliberately not a crash recovery test.
{
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {NodeAsyncFileJournal}=await import('../adapters/node-async-file-journal.mjs');
  const dir=await mkdtemp(join(tmpdir(),'rumiai-async-journal-'));
  try {
    const prefix=join(dir,'history');
    let backend=await NodeAsyncFileJournal.open(prefix);
    const base='hello\nthere\n';
    const h=await AsyncHistory.open(new AdaptiveRepackDocument(base),backend);
    await h.commit([{start:0,end:0,insert:'HI '},{start:6,end:11,insert:'WORLD'}],{primary:0,ranges:[{anchor:3,head:9,virtualColumn:5}]});
    await h.commit([{start:0,end:3,insert:'Bye'}],{primary:0,ranges:[{anchor:0,head:0,virtualColumn:0}]});
    const expected=h.document.toString(),savedState=structuredClone(h.selection);
    await backend.close();
    backend=await NodeAsyncFileJournal.open(prefix,{create:false});
    const restored=await AsyncHistory.open(new AdaptiveRepackDocument(base),backend);
    assert.equal(restored.document.toString(),expected);
    assert.deepEqual(restored.selection,savedState);
    assert.equal(await restored.undo(),true);
    assert.equal(await restored.redo(),true);
    assert.equal(restored.document.toString(),expected);
    await backend.close();
    console.log(JSON.stringify({adapter:'async Node file',passed:true,cleanReopen:true,undoRedo:true}));
  } finally {await rm(dir,{recursive:true,force:true});}
}
