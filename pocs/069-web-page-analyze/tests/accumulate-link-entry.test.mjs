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
  const initialScript=code.indexOf("source.addInitScript({path:path.join(root,'accumulate-observer.js')})");
  const goto=code.indexOf('await source.goto(url,');
  const firstScan=code.indexOf('await source.evaluate(()=>window.__rumiaiAccumulate.scan())');
  const firstDrain=code.indexOf('await drain();',firstScan);
  const firstWheel=code.indexOf('await source.mouse.wheel(');
  const manualMode=code.indexOf("const manualOnly=process.env.PWC069_SCROLL_MODE==='manual'");
  for(const position of [initialScript,goto,firstScan,firstDrain,firstWheel,manualMode])
    assert.ok(position>=0,'Expected startup step exists');
  assert.ok(initialScript<goto);
  assert.ok(goto<firstScan);
  assert.ok(firstScan<firstDrain);
  assert.ok(firstDrain<firstWheel);
  // Manual-scroll fallback happens only after the initial capture.
  assert.ok(manualMode>firstDrain);
});

test('capture retains all detected message turns, not a manually chosen message',async()=>{
  const observer=await readFile(new URL('../accumulate-observer.js',import.meta.url),'utf8');
  const core=await readFile(new URL('../accumulate-core.mjs',import.meta.url),'utf8');
  assert.match(observer,/MutationObserver/);
  assert.match(observer,/record\.removedNodes/);
  assert.match(core,/this\.nodes\.set\(packet\.key,entry\)/);
  assert.doesNotMatch(observer,/selectedMessage|selectedConversation|chatIdInput/);
});
