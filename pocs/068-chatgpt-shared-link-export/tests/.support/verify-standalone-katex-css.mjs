'use strict';
// Verify the unmodified full standalone export, CSP and fonts in Chromium CDP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import katex from 'katex';
import {renderSameSessionOffline} from '../../render-same-session-offline.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-actual-output-katex-'));
const capture=path.join(dir,'capture'),reading=path.join(dir,'reading');
const profile=path.join(dir,'profile');
let chrome,ws;
const pending=new Map();
let id=0;
try
{
  fs.mkdirSync(path.join(capture,'turns'),{recursive:true,mode:0o700});
  const markup=katex.renderToString(
    '\\sum_{i=1}^{n}\\frac{x_i^2}{1+y_{j+1}}',
    {output:'html',displayMode:true,throwOnError:true});
  const bytes=Buffer.from(
    '<section data-turn-id-container="fixture-1">'+
    '<div data-testid="conversation-turn-1">'+
    '<div data-message-id="fixture-message"><p>Formula</p>'+
    markup+'</div></div></section>');
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(capture,'turns',hash+'.html'),bytes);
  fs.writeFileSync(path.join(capture,'events.jsonl'),JSON.stringify({
    kind:'turn.snapshot',sequence:1,turnId:'fixture-1',
    sessionId:'fixture-session',messageIds:['fixture-message'],
    bytes:bytes.length,sha256:hash,file:'turns/'+hash+'.html',
    imageSelections:[]
  })+'\n');
  const summary=renderSameSessionOffline(capture,reading);
  assert.equal(summary.visualKatexFormulas,1);

  chrome=spawn('chromium',[
    '--headless=new','--no-sandbox','--disable-gpu',
    '--disable-dev-shm-usage','--no-first-run',
    '--no-default-browser-check','--user-data-dir='+profile,
    '--remote-debugging-port=0','about:blank'
  ],{stdio:['ignore','ignore','ignore']});
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let tries=0;tries<200 && !fs.existsSync(portFile);tries++)await pause(100);
  assert(fs.existsSync(portFile),'Chromium CDP port unavailable');
  const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
  ws=new WebSocket('ws://127.0.0.1:'+port+endpoint);
  await new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  ws.addEventListener('message',ev=>{
    const msg=JSON.parse(String(ev.data));
    if(!msg.id || !pending.has(msg.id))return;
    const next=pending.get(msg.id);
    pending.delete(msg.id);
    if(msg.error)next.reject(Error('CDP '+msg.error.message));
    else next.resolve(msg.result||{});
  });
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const current=++id;
    const timer=setTimeout(()=>{
      pending.delete(current);reject(Error('Timed out CDP '+method));
    },15000);
    pending.set(current,{
      resolve:v=>{clearTimeout(timer);resolve(v);},
      reject:e=>{clearTimeout(timer);reject(e);}
    });
    ws.send(JSON.stringify({id:current,method,params,
      ...(sessionId?{sessionId}:{})}));
  });
  const {targetId}=await send('Target.createTarget',{
    url:pathToFileURL(path.join(reading,'index.html')).href
  });
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Runtime.enable',{},sessionId);
  const expression=[
    '(async()=>{await document.fonts.ready;',
    'const rules=Array.from(document.styleSheets).flatMap(sheet=>{',
    'try{return Array.from(sheet.cssRules)}catch{return []}});',
    'const fonts=Array.from(document.fonts)',
    '.filter(face=>(face.family||"").includes("KaTeX"));',
    'const root=document.querySelector(".katex");',
    'const vlist=root?.querySelector(".vlist");',
    'return {ready:document.readyState,',
    'styleSheets:document.styleSheets.length,ruleCount:rules.length,',
    'katexRuleCount:rules.filter(r=>r.cssText?.includes(".katex")).length,',
    'fontRuleCount:rules.filter(r=>r.type===CSSRule.FONT_FACE_RULE).length,',
    'fontFaces:fonts.length,loadedFonts:fonts.filter(f=>f.status==="loaded").length,',
    'formulaPresent:!!root,rootFontFamily:root?getComputedStyle(root).fontFamily:null,',
    'rootFontSize:root?getComputedStyle(root).fontSize:null,',
    'vlistPosition:vlist?getComputedStyle(vlist).position:null};})()'
  ].join('');
  let observed;
  for(let tries=0;tries<50;tries++)
  {
    await pause(150);
    const evaluated=await send('Runtime.evaluate',{
      expression,awaitPromise:true,returnByValue:true
    },sessionId);
    if(evaluated.exceptionDetails)throw Error('Chromium DOM evaluation exception');
    if(evaluated.result?.value?.formulaPresent){
      observed=evaluated.result.value;
      if(observed.ready==='complete')break;
    }
  }
  assert(observed,'Offline KaTeX DOM not loaded in Chromium');
  assert(observed.fontRuleCount>=8,
    'Embedded CSS failed to register @font-face in actual output: '+
    JSON.stringify(observed));
  assert(observed.fontFaces>=8,
    'KaTeX fonts missing from FontFaceSet: '+JSON.stringify(observed));
  assert(observed.loadedFonts>=1,
    'Embedded KaTeX WOFF2 fonts not loaded: '+JSON.stringify(observed));
  assert(observed.rootFontFamily.includes('KaTeX'),
    'CSS .katex was not applied: '+JSON.stringify(observed));
  console.log('PASS: standalone HTML applies KaTeX fonts, WOFF2 and CSS under its actual CSP in Chromium');
}
finally
{
  if(ws){try{ws.close();}catch{}}
  if(chrome){try{chrome.kill('SIGKILL');}catch{}}
  fs.rmSync(dir,{recursive:true,force:true});
}
