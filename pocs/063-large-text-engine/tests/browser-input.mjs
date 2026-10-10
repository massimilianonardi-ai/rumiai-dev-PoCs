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

  // A genuine OS clipboard Ctrl+V is now routed through the independent
  // column planner. The rectangle is supplied explicitly by the test;
  // native drag geometry for column selection is NOT being asserted here.
  await evaluate("window.__probe.resetFixture('aa\\nb')");
  await evaluate("window.__probe.armColumn({lineFrom:0,lineTo:1,columnFrom:2,columnTo:2})");
  await evaluate("navigator.clipboard.writeText('X\\nY\\nZ\\nW')");
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...pasteKey});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',...pasteKey});
  state=await snapshot();
  assert.equal(state.text,'aaX\nb Y\n  Z\n  W');
  assert.deepEqual(state.lastColumnPlan,{
    sourceRows:4,targetRows:4,materializedRows:2,primitiveSelections:2
  });
  assert.equal(state.historyLength,1,'one native column paste is one undo action');
  assert.equal(state.historyIndex,1);
  assert.equal(state.nativeValue,state.text);
  await chord(false);
  state=await snapshot();
  assert.equal(state.text,'aa\nb');
  assert.deepEqual(state.selection,[
    {start:2,end:2,forward:true},{start:4,end:4,forward:true}
  ]);
  await chord(true);
  assert.equal((await snapshot()).text,'aaX\nb Y\n  Z\n  W');

  console.log(JSON.stringify({pass:true,browser:'Chromium',realBeforeInput:true,
    separateTypedActions:3,realPaste:true,pasteTargets:2,
    pasteSingleUndo:true,realColumnPasteBeyondEof:true,
    columnPasteSingleUndo:true,imePreviews:2,imeCommitSingleUndo:true,
    immediateIdenticalInputIsSeparate:true,imeCancellationNoUndo:true,
    keyboardUndoRedo:true,mouseHitTest:true,
    browserEvents:state.events.filter(e=>e.event==='compositionend'||e.event==='paste'),
    node:process.version}));

  // Exercise the new human-facing HTML page through real Chrome events and
  // pointer clicks, not just the original test-only textarea bridge.
  await cdp.send('Page.navigate',{url:origin+'/demo/index.html'});
  let demoReady=false;
  for(let n=0;n<100;n++){
    demoReady=await evaluate(
      "document.documentElement.dataset.demoReady === 'true'");
    if(demoReady)break;
    await delay(50);
  }
  assert.equal(demoReady,true,'interactive demo failed to load its real modules');
  const demoText=()=>evaluate("document.getElementById('editor').value");
  async function clickDemo(id){
    const pt=await evaluate("(() => {const element=document.getElementById("+
      JSON.stringify(id)+");element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',
      button:'left',x:pt.x,y:pt.y,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',
      button:'left',x:pt.x,y:pt.y,clickCount:1});
  }
  assert.equal(await demoText(),'aa\nb');
  await evaluate("document.getElementById('editor').focus()");
  await cdp.send('Input.insertText',{text:'Q'});
  assert.equal(await demoText(),'Qaa\nb');
  await chord(false);
  assert.equal(await demoText(),'aa\nb');
  await chord(true);
  assert.equal(await demoText(),'Qaa\nb');
  await clickDemo('sample');
  assert.equal(await demoText(),'aa\nb');
  await clickDemo('column-apply');
  assert.equal(await demoText(),'aaX\nb Y\n  Z\n  W');
  await clickDemo('undo');
  assert.equal(await demoText(),'aa\nb','one UI undo must restore all four pasted rows');
  await clickDemo('redo');
  assert.equal(await demoText(),'aaX\nb Y\n  Z\n  W');
  await clickDemo('sample');
  await clickDemo('add-cursor');
  await cdp.send('Input.insertText',{text:'Q'});
  assert.equal(await demoText(),'Qaa\nQb','two actual editor selections must edit together');
  await clickDemo('undo');
  assert.equal(await demoText(),'aa\nb','one UI undo removes both inserted carets');

  await clickDemo('sample');
  await clickDemo('column-arm');
  await evaluate("navigator.clipboard.writeText('X\\nY\\nZ\\nW')");
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...pasteKey});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',...pasteKey});
  assert.equal(await demoText(),'aaX\nb Y\n  Z\n  W',
    'real Ctrl+V clipboard must work on user-facing demo');
  await chord(false);
  assert.equal(await demoText(),'aa\nb');
  // A user may position the caret with a real mouse click after arming
  // column clipboard paste. That click must not silently disarm it.
  await clickDemo('sample');
  await clickDemo('column-arm');
  await clickDemo('editor');
  await evaluate("navigator.clipboard.writeText('X\\nY\\nZ\\nW')");
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...pasteKey});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',...pasteKey});
  assert.equal(await demoText(),'aaX\nb Y\n  Z\n  W');
  await clickDemo('undo');
  assert.equal(await demoText(),'aa\nb');

  // Real drag gestures over the SAME user-facing textarea, in browser pixel
  // coordinates. No synthetic PointerEvent or test-supplied rectangle state.
  async function dragRect(startLine,startColumn,endLine,endColumn,modifiers=0){
    const geometry=await evaluate(`(() => {
      const f=document.getElementById('editor');
      f.scrollIntoView({block:'center'});
      const s=getComputedStyle(f),r=f.getBoundingClientRect();
      const c=document.createElement('canvas').getContext('2d');
      c.font=s.fontSize+' '+s.fontFamily;
      return {x:r.left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft)-f.scrollLeft,
        y:r.top+parseFloat(s.borderTopWidth)+parseFloat(s.paddingTop)-f.scrollTop,
        cell:c.measureText('0').width,lineHeight:parseFloat(s.lineHeight)};
    })()`);
    const point=(line,col)=>({x:geometry.x+col*geometry.cell,
      y:geometry.y+(line+0.5)*geometry.lineHeight});
    const a=point(startLine,startColumn),b=point(endLine,endColumn);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...a,modifiers});
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',
      button:'left',...a,modifiers,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',
      button:'left',...b,modifiers});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',
      button:'left',...b,modifiers,clickCount:1});
  }
  const fields=()=>evaluate("(() => {const ids=['row-from','row-to','col-from','col-to'];return ids.map(id=>document.getElementById(id).value);})()");
  const overlayCount=()=>evaluate("document.querySelectorAll('#rect-overlay .rect-band').length");
  await clickDemo('sample');
  await clickDemo('rect-mode');
  await dragRect(0,2,1,2);
  assert.deepEqual(await fields(),['1','2','2','2'],
    'real pointer drag must project to existing rectangle planner controls');
  assert.equal(await overlayCount(),2,'two actual overlay bands drawn');
  assert.equal(await demoText(),'aa\nb','mouse-only selection never edits text');
  await clickDemo('column-apply');
  assert.equal(await demoText(),'aaX\nb Y\n  Z\n  W',
    'native drag geometry must reach the real column planner');
  await clickDemo('undo');
  assert.equal(await demoText(),'aa\nb','native drag paste remains one undo action');
  await clickDemo('sample');
  await dragRect(1,2,0,0);
  assert.deepEqual(await fields(),['2','1','2','0'],
    'reverse row and column orientation must survive real pointer drag');
  assert.equal(await overlayCount(),2);
  await clickDemo('rect-mode'); // turn off explicit mode
  await clickDemo('sample');
  await dragRect(0,2,1,2,1); // physical Alt/Option-modified mouse drag
  assert.deepEqual(await fields(),['1','2','2','2'],
    'Alt + native pointer drag must work without mode toggle');
  assert.equal(await overlayCount(),2);
  await clickDemo('column-arm');
  await evaluate("navigator.clipboard.writeText('X\\nY\\nZ\\nW')");
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...pasteKey});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',...pasteKey});
  assert.equal(await demoText(),'aaX\nb Y\n  Z\n  W',
    'Alt pointer selection must feed real OS clipboard paste');
  await chord(false);
  assert.equal(await demoText(),'aa\nb');
  console.log(JSON.stringify({pass:true,browser:'Chromium',
    physicalRectangleDrag:true,reverseDrag:true,altDrag:true,
    rectangleOverlay:true,dragFeedsColumnPlanner:true,
    realClipboardAfterDrag:true,oneUndoAfterDrag:true}));

  // A tab cell must not be silently split by pixel hit testing.
  await clickDemo('sample');
  await evaluate("document.getElementById('editor').focus()");
  await cdp.send('Input.insertText',{text:'a\tc'});
  await dragRect(0,2,1,2,1);
  assert.equal(await overlayCount(),0,'intra-tab column selection rejected');
  assert.equal(await evaluate("document.getElementById('message').textContent.includes('tab')"),true);
  // The prototype intentionally rejects Unicode pixel columns rather than
  // asserting inaccurate glyph metrics. Numeric column inputs remain usable.
  await clickDemo('sample');
  await evaluate("document.getElementById('editor').focus()");
  await cdp.send('Input.insertText',{text:'漢'});
  await dragRect(0,0,1,0,1);
  assert.equal(await overlayCount(),0,'Unicode pointer gesture rejected');
  assert.equal(await evaluate("document.getElementById('message').textContent.includes('Unicode')"),true);
  // Scroll is part of the geometry; do not mistake on-screen row zero for
  // physical document row zero once the textarea viewport moves.
  await clickDemo('sample');
  await evaluate("document.getElementById('editor').focus()");
  await cdp.send('Input.insertText',{
    text:Array.from({length:65},(_,i)=>'line-'+String(i).padStart(2,'0')).join('\n')+'\n'
  });
  await evaluate("(() => {const f=document.getElementById('editor');const s=getComputedStyle(f);f.scrollTop=24*parseFloat(s.lineHeight);})()");
  assert.ok(await evaluate("document.getElementById('editor').scrollTop")>0);
  await dragRect(25,2,26,2,1);
  assert.deepEqual(await fields(),['26','27','2','2'],
    'pointer rectangle must use actual scrollTop for row mapping');
  assert.equal(await overlayCount(),2);
  await clickDemo('sample');
  console.log(JSON.stringify({pass:true,browser:'Chromium',
    rejectedTabInterior:true,rejectedUnverifiedUnicodePixels:true,
    scrollAwareRectangleDrag:true}));

  // A second REAL browser page: only visible lines in DOM, actual browser
  // Range layout for Unicode boundaries, real PieceDocument editing/undo.
  await cdp.send('Page.navigate',{url:origin+'/demo/viewport.html'});
  let viewportReady=false;
  for(let n=0;n<100;n++){
    viewportReady=await evaluate(
      "document.documentElement.dataset.viewportReady === 'true'");
    if(viewportReady)break;
    await delay(50);
  }
  assert.equal(viewportReady,true,'viewport experiment failed to initialize');
  const viewport=()=>evaluate("window.__viewportProbe.snapshot()");
  async function clickBoundary(row,left,right=left){
    const expression="(() => {"+
      "const rowEl=document.querySelector('.v-row[data-row=\""+
        String(row)+"\"]');"+
      "if(!rowEl)throw Error('target line is not mounted');"+
      "const node=rowEl.querySelector('.v-text').firstChild;"+
      "const range=document.createRange();"+
      "range.setStart(node,"+left+");range.collapse(true);"+
      "const xa=range.getBoundingClientRect().left;"+
      "range.setStart(node,"+right+");range.collapse(true);"+
      "const xb=range.getBoundingClientRect().left;"+
      "const r=rowEl.getBoundingClientRect();"+
      "return {x:(xa+xb)/2,y:r.top+r.height/2};})()";
    const point=await evaluate(expression);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',
      button:'left',...point,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',
      button:'left',...point,clickCount:1});
  }
  let projected=await viewport();
  assert.equal(projected.documentRows,6);
  assert.ok(projected.mounted<=30);
  assert.equal(projected.visible[0].content,'a\t😀é漢Z');
  await clickBoundary(0,4); // after emoji, before combining grapheme e+mark
  projected=await viewport();
  assert.equal(projected.lastHit.offset,4,'real browser measured UTF-16 emoji boundary');
  assert.ok(projected.lastHit.graphemeBoundaries.includes(4));
  assert.ok(!projected.lastHit.graphemeBoundaries.includes(3));
  await clickDemo('insert');
  projected=await viewport();
  assert.equal(projected.visible[0].content,'a\t😀★é漢Z');
  assert.equal(projected.historyIndex,1);
  await clickDemo('undo');
  assert.equal((await viewport()).visible[0].content,'a\t😀é漢Z');
  await clickDemo('redo');
  assert.equal((await viewport()).visible[0].content,'a\t😀★é漢Z');
  await clickDemo('small');
  await clickBoundary(0,4,6); // between combining grapheme boundaries
  projected=await viewport();
  assert.ok([4,6].includes(projected.lastHit.local),
    'grapheme internal offset 5 must never be returned');
  assert.ok(!projected.lastHit.graphemeBoundaries.includes(5));
  await clickBoundary(1,0,11); // ZWJ family is one grapheme
  projected=await viewport();
  assert.ok([0,11].includes(projected.lastHit.local));
  assert.ok(!projected.lastHit.graphemeBoundaries.includes(2));

  await clickDemo('large');
  projected=await viewport();
  assert.equal(projected.documentRows,200000);
  assert.ok(projected.mounted<=32,'large document mounts only near-screen lines');
  assert.ok(projected.projectedReadUnits<20000);
  await evaluate("document.getElementById('jump-row').value='150001'");
  await clickDemo('jump');
  projected=await viewport();
  assert.ok(projected.first<=150000&&projected.last>150000,
    'jump should navigate to a far-away indexed line');
  assert.ok(projected.mounted<=32);
  assert.ok(projected.projectedReadUnits<20000);
  await clickBoundary(150000,0);
  projected=await viewport();
  assert.equal(projected.selectedRow,150000);
  await clickDemo('insert');
  projected=await viewport();
  assert.ok(projected.visible.find(x=>x.row===150000).content.startsWith('★'));
  assert.equal(projected.documentRows,200000);
  assert.ok(projected.mounted<=32);
  await clickDemo('undo');
  assert.ok((await viewport()).visible.find(x=>x.row===150000).content.startsWith('line-'));
  console.log(JSON.stringify({pass:true,browser:'Chromium',
    viewportRows:200000,boundedDOM:true,farJump:true,
    realGraphemePointer:true,combiningBoundary:true,zwjBoundary:true,
    modelEditing:true,undoRedo:true,visibleRows:projected.mounted,
    projectionReadUnits:projected.projectedReadUnits}));

  await clickDemo('giant');
  projected=await viewport();
  assert.equal(projected.documentRows,3);
  assert.ok(projected.documentUnits>2*1024*1024);
  assert.equal(projected.visible[1].content.length,512);
  assert.equal(projected.visible[1].truncated,true);
  assert.ok(projected.projectedReadUnits<600,
    'actual DOM model must not copy the 2 MiB giant line');
  await clickBoundary(1,20);
  projected=await viewport();
  assert.equal(projected.selectedRow,null,
    'clipped giant line is deliberately not pointer-editable');
  assert.equal(await evaluate(
    "document.getElementById('message').textContent.includes('troncata')"),true);
  console.log(JSON.stringify({pass:true,browser:'Chromium',
    selectedGiantLineBytes:2*1024*1024,boundedVisibleUnits:512,
    clippedLinePointerEditRejected:true}));

  console.log(JSON.stringify({pass:true,browser:'Chromium',
    handsOnDemo:true,realTyping:true,realPointerToolbar:true,
    groupedColumnPaste:true,multipleCaretModel:true,
    realClipboardColumnPaste:true,caretClickKeepsArmedPaste:true,
    oneActionUndoRedo:true}));
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
