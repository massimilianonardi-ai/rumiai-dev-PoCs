import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateShareUrl} from '../accumulate.mjs';

// Guard the user's verified URL-first, top-first capture sequence.
// This is a source-level invariant test; physical browser verification
// remains necessary for actual top-of-conversation content.
test('shared URL directly identifies the conversation, without a catalog or selection UI',async()=>{
  const share='https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835';
  assert.equal(validateShareUrl(share),share);
  const code=await readFile(new URL('../accumulate.mjs',import.meta.url),'utf8');
  assert.match(code,/source\.goto\(url,/);
  assert.match(code,/main\(process\.argv\[2\],process\.argv\[3\]\)/);
  assert.doesNotMatch(code,/chooseConversation|loadConversations|node:sqlite|local_thread_catalog/);
  assert.doesNotMatch(code,/Page\.navigate\(\{url:.*initialRoute/);
});

test('source observer starts before navigation; initial turns are saved before any scrolling',async()=>{
  const code=await readFile(new URL('../accumulate.mjs',import.meta.url),'utf8');
  // Original inspect-01 opened ONE tab, installed its observer with CDP,
  // navigated once and photographed the initial DOM before any other tab.
  const inspect=await readFile(new URL('../investigate.mjs',import.meta.url),'utf8');
  assert.match(inspect,/Page\.addScriptToEvaluateOnNewDocument/);
  assert.match(inspect,/Profiler\.startPreciseCoverage/);
  const source=code.indexOf('source=await context.newPage()');
  const debuggerSession=code.indexOf('context.newCDPSession(source)');
  const initialScript=code.indexOf("path.join(root,'investigate-observer.js')");
  const exportScript=code.indexOf("path.join(root,'accumulate-observer.js')");
  const hook=code.indexOf("cdp.send('Page.addScriptToEvaluateOnNewDocument'");
  const goto=code.indexOf('await source.goto(url,');
  const initialSnapshot=code.indexOf('window.__rumiaiInvestigate?.snapshot()');
  const screenshot=code.indexOf("'startup-initial.png'");
  const replica=code.indexOf('replica=await context.newPage()');
  const firstScan=code.indexOf('await source.evaluate(()=>window.__rumiaiAccumulate.scan())');
  const firstDrain=code.indexOf('await drain();',firstScan);
  const automatic=code.indexOf('const run=await traverseAutomatically');
  const manualMode=code.indexOf("const manualOnly=process.env.PWC069_SCROLL_MODE==='manual'");
  const sequence=[source,debuggerSession,initialScript,exportScript,
    goto,initialSnapshot,screenshot,replica,firstScan,firstDrain,automatic];
  assert.ok(sequence.every(position=>position>=0),'Expected startup step exists');
  assert.deepEqual([...sequence].sort((a,b)=>a-b),sequence);
  assert.ok(hook<goto);
  assert.ok(firstDrain<manualMode);
  assert.doesNotMatch(code.slice(source,replica),
    /mouse\.wheel|keyboard\.press|scrollIntoView|scrollTo\(/);
  // Automatic navigation is the normal path. The manual path is opt-in.
  assert.match(code,/else\s*\{\s*const run=await traverseAutomatically/);
});

test('capture retains all detected message turns, not a manually chosen message',async()=>{
  const observer=await readFile(new URL('../accumulate-observer.js',import.meta.url),'utf8');
  const core=await readFile(new URL('../accumulate-core.mjs',import.meta.url),'utf8');
  assert.match(observer,/MutationObserver/);
  assert.match(observer,/record\.removedNodes/);
  assert.match(core,/this\.nodes\.set\(packet\.key,entry\)/);
  assert.doesNotMatch(observer,/selectedMessage|selectedConversation|chatIdInput/);
});
