// Real Chromium input events via CDP, not dispatchEvent-created fakes.
// Deliberately independent of the persistence/browser-idb scenario.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,readFileSync,existsSync,accessSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const browser=process.env.CHROMIUM_BIN||['/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].find(p=>{try{accessSync(p);return true;}catch{return false;}});
if(!browser)throw Error('Chromium/Chrome required');
const profile=mkdtempSync(join(tmpdir(),'rumiai-browser-input-'));
const server=createServer((req,res)=>{
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!path.startsWith(root+'/')||!['.mjs','.html'].includes(extname(path))){res.writeHead(404);res.end('bad path');return;}
  try{res.setHeader('Content-Type',extname(path)==='.html'?'text/html':'text/javascript');res.end(readFileSync(path));}
  catch{res.writeHead(404);res.end('missing');}
});
async function connect(url){
  const ws=new WebSocket(url),pending=new Map();
  let next=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{
    const m=JSON.parse(e.data),wait=pending.get(m.id);
    if(wait){pending.delete(m.id);m.error?wait.reject(Error(JSON.stringify(m.error))):wait.resolve(m.result);}
  };
  return {send:(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  }),close:()=>ws.close()};
}
let processHandle,cdp;
try{
  await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
  processHandle=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu',
    '--disable-dev-shm-usage','--no-first-run','--disable-extensions',
    '--remote-debugging-port=0','--remote-allow-origins=*',
    '--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let stderr='';processHandle.stderr.on('data',c=>{stderr=(stderr+c.toString()).slice(-2400);});
  const active=join(profile,'DevToolsActivePort'),deadline=Date.now()+20000;
  while(!existsSync(active)){if(Date.now()>deadline)throw Error('Chrome CDP timeout '+stderr);await delay(60);}
  const port=Number(readFileSync(active,'utf8').split('\n')[0]);
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=targets.find(t=>t.type==='page');if(!page)throw Error('No Chrome page');
  cdp=await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  const origin='http://127.0.0.1:'+server.address().port;
  await cdp.send('Browser.grantPermissions',{
    origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']
  });
  await cdp.send('Page.navigate',{url:origin+'/tests/browser-input.html'});
  async function evaluate(expression){
    const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  let ready=false;
  for(let n=0;n<100;n++){
    ready=await evaluate('Boolean(window.__probe)');
    if(ready)break;
    await delay(50);
  }
  assert.equal(ready,true,'browser module not initialized');
  await evaluate('window.__probe.focus()');
  const snapshot=()=>evaluate('window.__probe.snapshot()');
  await cdp.send('Input.insertText',{text:'X'});
  assert.deepEqual((await snapshot()).text,'abX');
  await cdp.send('Input.insertText',{text:'Y'});
  let state=await snapshot();
  assert.equal(state.text,'abXY');
  assert.equal(state.historyLength,2,'each browser text input is its own action');
  assert.equal(state.historyIndex,2);
  async function chord(shift){
    const data={key:shift?'Z':'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:shift?10:2};
    await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...data});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',...data});
  }
  await chord(false);
  state=await snapshot();assert.equal(state.text,'abX');assert.equal(state.historyIndex,1);
  await chord(true);
  state=await snapshot();assert.equal(state.text,'abXY');assert.equal(state.historyIndex,2);
  const location=await evaluate('window.__probe.rect()');
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',
    x:location.x,y:location.y,clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',
    x:location.x,y:location.y,clickCount:1});
  state=await snapshot();
  assert.equal(state.selection[0].start,0,'native mouse hit test must project caret');
  await cdp.send('Input.insertText',{text:'Q'});
  state=await snapshot();
  assert.equal(state.text,'QabXY');
  assert.equal(state.historyLength,3);
  assert.equal(state.historyIndex,3);
  assert.ok(state.events.filter(e=>e.event==='beforeinput'&&e.type==='insertText').length>=3);
  // Real OS/browser clipboard path, not a synthetic ClipboardEvent.
  await evaluate("navigator.clipboard.writeText('r\\ns')");
  await evaluate("window.__probe.setSelections([{start:5,end:5,forward:true},{start:0,end:0,forward:true}])");
  const pasteKey={key:'v',code:'KeyV',windowsVirtualKeyCode:86,modifiers:2};
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...pasteKey});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',...pasteKey});
  state=await snapshot();
  assert.equal(state.text,'r\nsQabXYr\ns','paste replicated onto two unordered caret selections');
  assert.equal(state.historyLength,4,'one paste is one history action for both caret targets');
  assert.equal(state.historyIndex,4);
  assert.ok(state.events.some(e=>e.event==='paste' && e.text==='r\ns'),
    'Chrome must deliver the real clipboard paste event');
  assert.equal(state.nativeValue,state.text,'native textarea view follows document');
  await chord(false);
  state=await snapshot();
  assert.equal(state.text,'QabXY','single undo removes both pasted regions');
  assert.deepEqual(state.selection,
    [{start:5,end:5,forward:true},{start:0,end:0,forward:true}]);
  await chord(true);
  assert.equal((await snapshot()).text,'r\nsQabXYr\ns');

  // A real Chrome IME preview may mutate DOM, but not the model or history.
  await evaluate("window.__probe.setSelections([{start:0,end:0,forward:true}])");
  const beforeComposition=await snapshot();
  await cdp.send('Input.imeSetComposition',{text:'あ',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.imeSetComposition',{text:'あい',selectionStart:2,selectionEnd:2});
  state=await snapshot();
  assert.equal(state.text,beforeComposition.text,'composition previews do not mutate the model');
  assert.equal(state.historyIndex,beforeComposition.historyIndex,
    'composition previews do not create undo entries');
  await cdp.send('Input.insertText',{text:'愛'});
  state=await snapshot();
  assert.equal(state.text,'愛'+beforeComposition.text,'committed IME changes model once');
  assert.equal(state.historyLength,5,'one composition commit is one undo record');
  assert.equal(state.historyIndex,5);
  assert.ok(state.events.some(e=>e.event==='compositionend'),
    'real IME commit must finish composition');
  await chord(false);
  assert.equal((await snapshot()).text,beforeComposition.text,
    'one undo removes the entire committed composition');
  await chord(true);
  state=await snapshot();
  assert.equal(state.text,'愛'+beforeComposition.text);
  // A new, independent text input identical to the IME commit MUST NOT be
  // mistaken for a browser echo or merged with that committed action.
  await cdp.send('Input.insertText',{text:'愛'});
  state=await snapshot();
  assert.equal(state.text,'愛愛'+beforeComposition.text);
  assert.equal(state.historyLength,6);
  assert.equal(state.historyIndex,6);
  await chord(false);
  assert.equal((await snapshot()).text,'愛'+beforeComposition.text);
  await chord(false);
  assert.equal((await snapshot()).text,beforeComposition.text);
  await chord(true);
  await chord(true);
  assert.equal((await snapshot()).text,'愛愛'+beforeComposition.text);

  // Cancellation only drops the native composition preview. It must not
  // create a journal item or change the canonical document.
  await evaluate("window.__probe.setSelections([{start:0,end:0,forward:true}])");
  const beforeCancel=await snapshot();
  await cdp.send('Input.imeSetComposition',{text:'仮',selectionStart:1,selectionEnd:1});
  assert.equal((await snapshot()).historyLength,beforeCancel.historyLength);
  await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});
  state=await snapshot();
  assert.equal(state.text,beforeCancel.text,'cancelled composition unchanged');
  assert.equal(state.historyLength,beforeCancel.historyLength,'cancelled composition does not create undo');
  assert.equal(state.nativeValue,state.text,'preview cancelled in browser view');
  console.log(JSON.stringify({pass:true,browser:'Chromium',realBeforeInput:true,
    separateTypedActions:3,realPaste:true,pasteTargets:2,
    pasteSingleUndo:true,imePreviews:2,imeCommitSingleUndo:true,
    immediateIdenticalInputIsSeparate:true,imeCancellationNoUndo:true,
    keyboardUndoRedo:true,mouseHitTest:true,
    browserEvents:state.events.filter(e=>e.event==='compositionend'||e.event==='paste'),
    node:process.version}));
}finally{
  cdp?.close();
  if(processHandle){
    const exited=new Promise(resolve=>processHandle.once('exit',resolve));
    processHandle.kill('SIGTERM');
    await Promise.race([exited,delay(3000).then(()=>processHandle.kill('SIGKILL'))]);
  }
  await new Promise(resolve=>server.close(resolve));
  try{rmSync(profile,{recursive:true,force:true,maxRetries:2,retryDelay:100});}
  catch(error){console.warn('Chrome temporary profile cleanup: '+error.code);}
}
