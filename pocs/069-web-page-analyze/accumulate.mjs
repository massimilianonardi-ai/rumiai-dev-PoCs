#!/usr/bin/env node
// Two actual Chromium tabs: visible shared ChatGPT original and an initially
// invisible DOM-only export replica. No MHTML or screenshot stitching.
// This is an experimental PoC and does not certify complete asset fidelity.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {Accumulator} from './accumulate-core.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL='https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835';
const MAX_STEPS=650,MAX_MESSAGES=5000,MAX_PAYLOAD_BYTES=350*1024*1024;
const MAX_ASSET_BYTES=160*1024*1024,MAX_ASSETS=800;
const wait=t=>new Promise(resolve=>setTimeout(resolve,t));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=e=>String(e?.message||e).slice(0,240);
// Conservative progress evidence. Browser wheel events do not necessarily
// move a virtualized page, and image similarity alone cannot certify the end.
export function navigationProgress(before,after){
  const numeric=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?b-a:0;
  const distinctDelta=numeric(before?.distinct,after?.distinct);
  const mountDelta=numeric(before?.added,after?.added);
  const removalDelta=numeric(before?.removed,after?.removed);
  const revisionDelta=numeric(before?.updated,after?.updated);
  const scrollDelta=numeric(before?.windowY,after?.windowY);
  return {distinctDelta,mountDelta,removalDelta,revisionDelta,scrollDelta,
    anyDomChange:mountDelta>0||removalDelta>0||revisionDelta>0,
    newIdentities:distinctDelta>0,
    // Not a proof of last page. Allows manual takeover after real stasis.
    proofOfCompletion:false};
}
export function validateShareUrl(value){
  if(!/^https:\/\/chatgpt\.com\/share\/[a-zA-Z0-9-]+$/.test(value))
    throw Error('accumulate.share-url-invalid');
  return value;
}
export function runDirectory(name){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name))
    throw Error('accumulate.invalid-name');
  return path.join(root,'evidence','accumulations',name);
}
export function classifyAsset(mime,resourceType=''){
  const t=(mime||'').split(';')[0].trim().toLowerCase();
  const isCSS=t==='text/css'||resourceType==='stylesheet';
  const allowed=isCSS||/^image\//.test(t)||/^font\//.test(t)||
    /^audio\//.test(t)||/^video\//.test(t)||
    t==='application/pdf'||t==='application/octet-stream'||
    resourceType==='font'||resourceType==='image'||resourceType==='media';
  const ext=isCSS?'css':t.includes('svg')?'svg':
    t.includes('png')?'png':t.includes('jpeg')?'jpg':
    t.includes('webp')?'webp':t.includes('gif')?'gif':
    t.includes('woff2')?'woff2':t.includes('woff')?'woff':
    t.includes('pdf')?'pdf':t.includes('avif')?'avif':'bin';
  return {allowed,ext,isCSS,mime:t};
}
export function rewriteCssAssets(css,base,resources,missing){
  return css.replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi,(all,_q,quoted,unquoted)=>{
    const value=(quoted??unquoted??'').trim();
    if(!value||value.startsWith('data:')||value.startsWith('#'))return all;
    let absolute;try{absolute=new URL(value,base).href;}catch{return all;}
    const file=resources.get(absolute);
    if(file)return 'url("'+file.replaceAll('"','%22')+'")';
    missing.add(absolute.replace(/[?#].*$/,'')+' (css-resource-not-captured)');
    return 'url("'+absolute.replaceAll('"','%22')+'")';
  });
}
async function main(name,url=DEFAULT_URL){
  validateShareUrl(url);
  const output=runDirectory(name);
  const parent=path.dirname(output);
  const top=path.join(root,'evidence');
  if(await fs.realpath(top)!==top)throw Error('accumulate.evidence-symlink');
  await fs.mkdir(parent,{recursive:true,mode:0o700});
  if(await fs.realpath(parent)!==parent)
    throw Error('accumulate.destination-symlink');
  if(await fs.lstat(output).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)))
    throw Error('accumulate.evidence-already-exists');
  await fs.mkdir(output,{mode:0o700});
  const exportsDir=path.join(output,'export');
  const assetsDir=path.join(exportsDir,'assets');
  await fs.mkdir(exportsDir,{mode:0o700});
  await fs.mkdir(assetsDir,{mode:0o700});
  const manifest={source:url,status:'started',started:new Date().toISOString(),
    ended:null,steps:0,stopReason:null,sourceStartsAtTop:'operator-observed-in-inspect-01',
    complete:false,notes:[],resources:{seen:0,saved:0,failed:0,skipped:0},
    continuity:null};
  const writeManifest=async()=>fs.writeFile(path.join(output,'manifest.json'),
    JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  const playwrightRoot=path.join(root,'.runtime','pwc','package.json');
  const require=createRequire(playwrightRoot);
  const {chromium}=require('playwright');
  const executable=process.env.PWC069_BROWSER_EXECUTABLE||
    process.env.WEB_CONTROL_BROWSER_EXECUTABLE;
  if(!executable||!path.isAbsolute(executable))
    throw Error('accumulate.chromium-executable-required');
  let context=null,source=null,replica=null;
  const collector=new Accumulator(),assetMap=new Map(),assetJobs=[];
  let assetBytes=0,payloadBytes=0,eventsProcessed=0;
  const assetErrors=[],unresolved=new Set();
  let closed=false,draining=false;
  const assetRecords=[];
  async function saveAsset(response){
    const kind=classifyAsset(response.headers()['content-type']||'',
      response.request().resourceType());
    if(!kind.allowed)return;
    manifest.resources.seen++;
    const fullUrl=response.url();
    if(assetMap.has(fullUrl))return;
    if(manifest.resources.saved+manifest.resources.failed+
       manifest.resources.skipped>=MAX_ASSETS){
      manifest.resources.skipped++;return;
    }
    const job=(async()=>{
      try{
        let timer;
        const bytes=await Promise.race([response.body(),
          new Promise((_,reject)=>{timer=setTimeout(()=>
            reject(Error('asset-read-timeout')),15000);})
        ]).finally(()=>clearTimeout(timer));
        if(bytes.length>12*1024*1024||bytes.length+assetBytes>MAX_ASSET_BYTES){
          manifest.resources.skipped++;return;
        }
        const hex=sha(bytes),relative='assets/'+hex.slice(0,20)+'.'+kind.ext;
        const destination=path.join(exportsDir,relative);
        try{await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});}
        catch(e){if(e.code!=='EEXIST')throw e;}
        assetMap.set(fullUrl,relative);
        assetRecords.push({url:fullUrl.replace(/[?#].*$/,''),
          relative,mime:kind.mime,isCSS:kind.isCSS,bytes:bytes.length,sha256:hex});
        assetBytes+=bytes.length;manifest.resources.saved++;
      }catch(e){manifest.resources.failed++;
        assetErrors.push({url:fullUrl.replace(/[?#].*$/,''),error:fail(e)});}
    })();
    assetJobs.push(job);
  }
  async function renderBatch(items){
    if(!items.length)return;
    const frames=items.filter(x=>x.kind==='frame');
    const turns=items.filter(x=>x.kind!=='frame');
    const order=collector.order().keys;
    const rec=turns.map(x=>({key:x.key,html:x.html,ancestors:x.ancestors,
      role:x.role,stable:x.stable}));
    await replica.evaluate(({rec,order,frame})=>{
      let root=document.getElementById('rumiai-transcript');
      if(!root)return;
      if(frame){
        if(typeof frame.htmlClass==='string')
          document.documentElement.className=frame.htmlClass;
        if(typeof frame.bodyClass==='string')
          document.body.className=frame.bodyClass;
      }
      // Rebuild the common CSS ancestry of the original message container,
      // not merely a flat list of innerHTML blocks. Keep one accumulating
      // holder: changing virtualizer spacers are intentionally excluded.
      const first=rec.find(x=>Array.isArray(x.ancestors)&&x.ancestors.length);
      if(first&&!root.dataset.rumiaiAncestryInitialized){
        let parent=root;
        for(const item of first.ancestors){
          if(item.tag==='main'){
            root.className=item.className||'';
            continue;
          }
          if(!/^(?:div|section|article|ul|ol|li)$/.test(item.tag))continue;
          const shell=document.createElement(item.tag);
          shell.className=item.className||'';
          if(item.role)shell.setAttribute('role',item.role);
          shell.dataset.rumiaiCopiedAncestor='true';
          parent.appendChild(shell);parent=shell;
        }
        parent.dataset.rumiaiTurnHolder='true';
        // First copy may have arrived from an already detached node with
        // no ancestry. Relocate it into the newly discovered wrapper.
        if(parent!==root)
          for(const old of [...root.children])
            if(old.classList.contains('rumiai-accumulated-turn'))
              parent.appendChild(old);
        root.dataset.rumiaiAncestryInitialized='true';
      }
      const holder=root.querySelector('[data-rumiai-turn-holder="true"]')||root;
      for(const item of rec){
        const current=[...holder.children].find(x=>x.dataset.rumiaiKey===item.key);
        const template=document.createElement('template');
        template.innerHTML=item.html;
        const element=template.content.firstElementChild;
        if(!element)continue;
        // This page never executes the original application JavaScript.
        for(const x of element.querySelectorAll('script,iframe,object,embed,form'))
          x.remove();
        for(const x of [element,...element.querySelectorAll('*')])
          for(const attr of [...x.attributes])
            if(/^on/i.test(attr.name))x.removeAttribute(attr.name);
        element.classList.add('rumiai-accumulated-turn');
        element.dataset.rumiaiKey=item.key;
        if(current)current.replaceWith(element);
        else holder.append(element);
      }
      const byId=new Map([...holder.children].map(x=>[x.dataset.rumiaiKey,x]));
      for(const id of order){
        const node=byId.get(id);
        if(node)holder.appendChild(node); // reorders without deleting the turn
      }
    },{rec,order,frame:frames.at(-1)||null});
  }
  async function drain(){
    if(draining||closed||!source||source.isClosed())return;
    draining=true;
    try{
      for(let pass=0;pass<20;pass++){
        const result=await source.evaluate(()=>window.__rumiaiAccumulate?.drain(45));
        if(!result)throw Error('accumulate.observer-missing');
        if(result.overflow||result.dropped)manifest.notes.push(
          'Original observer lost '+result.dropped+' DOM packets');
        const items=result.items||[];
        if(!items.length)break;
        for(const p of items){
          collector.ingest(p);eventsProcessed++;
          if(p.html)payloadBytes+=Buffer.byteLength(p.html);
          if(collector.nodes.size>MAX_MESSAGES||payloadBytes>MAX_PAYLOAD_BYTES)
            throw Error('accumulate.byte-or-message-budget-exhausted');
          await fs.appendFile(path.join(output,'stream.jsonl'),
            JSON.stringify(p)+'\n',{mode:0o600});
        }
        await renderBatch(items);
        if(!result.remaining)break;
      }
    }finally{draining=false;}
  }
  async function sourceProbe(){
    return source.evaluate(()=>{
      const observer=window.__rumiaiAccumulate;
      if(!observer)throw Error('accumulate.observer-missing');
      const main=document.querySelector('main')||document.body;
      const bounds=main?.getBoundingClientRect();
      const width=innerWidth,height=innerHeight;
      const x=Math.max(15,Math.min(width-15,Math.round(
        bounds&&bounds.width>150?
          Math.max(bounds.left+20,Math.min(bounds.right-20,
            bounds.left+bounds.width*0.55)):width*0.55)));
      const y=Math.max(15,Math.min(height-15,Math.round(
        bounds&&bounds.height>150?
          Math.max(bounds.top+20,Math.min(bounds.bottom-20,
            bounds.top+Math.min(bounds.height*.6,height*.55))):
          height*.55)));
      const chain=[];
      let pointer=document.elementFromPoint(x,y);
      for(let i=0;pointer&&i<9;i++,pointer=pointer.parentElement){
        const css=getComputedStyle(pointer);
        chain.push({tag:pointer.localName,
          testId:pointer.getAttribute('data-testid')?.slice(0,100)||null,
          overflowY:css.overflowY,
          top:Math.round(pointer.scrollTop||0),
          max:Math.max(0,Math.round(pointer.scrollHeight-pointer.clientHeight))});
      }
      const root=document.scrollingElement||document.documentElement;
      return {...observer.status(),windowY:Math.round(window.scrollY),
        rootY:Math.round(root?.scrollTop||0),
        rootMax:Math.round((root?.scrollHeight||0)-(root?.clientHeight||0)),
        pointer:{x,y,chain},at:Math.round(performance.now())};
    });
  }
  async function humanScrollWhileCapturing(){
    if(!process.stdin.isTTY){
      manifest.notes.push('Manual scroll unavailable: no interactive terminal');
      return {used:false,status:'no-interactive-terminal'};
    }
    console.log('[MANUALE] Lo scroll automatico non ha raggiunto nuovi segmenti.');
    console.log('[MANUALE] Scorri TU nella finestra ChatGPT originale, fino agli ultimi messaggi.');
    console.log('[MANUALE] Continuo a copiare ogni nodo creato/rimosso nella replica.');
    console.log('[MANUALE] Premi INVIO nel terminale SOLO quando hai raggiunto la fine.');
    await source.bringToFront();
    const input=createInterface({input:process.stdin,output:process.stdout});
    let busy=false,failure=null,ticks=0;
    const tick=async()=>{
      if(busy||closed||source.isClosed())return;
      busy=true;
      try{
        await source.evaluate(()=>window.__rumiaiAccumulate?.scan());
        await drain();
        ticks++;
        if(ticks%24===0){
          const probe=await sourceProbe();
          await fs.appendFile(path.join(output,'navigation.jsonl'),
            JSON.stringify({phase:'manual',turns:collector.nodes.size,
              probe})+'\n',{mode:0o600});
          console.log('[MANUALE] Nodi conservati='+collector.nodes.size+
            ' componenti='+collector.order().components);
          await writeManifest();
        }
      }catch(e){failure=e;}
      finally{busy=false;}
    };
    const interval=setInterval(()=>{void tick();},250);
    let confirmed=false;
    try{
      await input.question('[MANUALE] Fine realmente visibile? INVIO per concludere: ');
      confirmed=true;
    }finally{
      clearInterval(interval);
      input.close();
      while(busy)await wait(80);
      await tick();
    }
    if(failure)throw failure;
    return {used:true,confirmed,ticks};
  }
  async function captureStyles(){
    return source.evaluate(()=>{
      const entries=[...document.querySelectorAll('style,link[rel~="stylesheet"]')]
        .slice(0,240).map(x=>x.localName==='style'?
          {kind:'inline',text:(x.textContent||'').slice(0,1500000)}:
          {kind:'link',href:x.href}).filter(x=>
            x.kind==='inline'?Boolean(x.text):Boolean(x.href));
      let inaccessible=0;
      for(const sheet of document.styleSheets){
        try{void sheet.cssRules.length;}catch{inaccessible++;}
      }
      return {entries,stylesheets:document.styleSheets.length,inaccessible};
    });
  }
  async function finishHTML(styleData){
    await Promise.allSettled(assetJobs);
    const cssFiles=assetRecords.filter(x=>x.isCSS);
    const rules=[];
    // Maintain browser stylesheet precedence: original link/style order.
    // Dynamic CSS imported or loaded late is additionally included.
    const used=new Set();
    for(const entry of styleData.entries||[]){
      if(entry.kind==='inline'){
        rules.push(rewriteCssAssets(entry.text,url,assetMap,unresolved));
      }else if(entry.kind==='link'){
        const file=assetMap.get(entry.href);
        if(!file){unresolved.add(entry.href.replace(/[?#].*$/,'')+
          ' (stylesheet-not-captured)');continue;}
        used.add(file);
        const raw=await fs.readFile(path.join(exportsDir,file),'utf8');
        rules.push(rewriteCssAssets(raw,entry.href,assetMap,unresolved));
      }
    }
    for(const file of cssFiles){
      if(used.has(file.relative))continue;
      const raw=await fs.readFile(path.join(exportsDir,file.relative),'utf8');
      const original=[...assetMap].find(([,relative])=>
        relative===file.relative)?.[0];
      rules.push(rewriteCssAssets(raw,original||url,assetMap,unresolved));
    }
    const snapshot=collector.report();
    const exported=await replica.evaluate(({styles,assets,sourceUrl})=>{
      const resources=new Map(assets);
      let unresolvedMedia=0,missingAttachments=0,unresolvedSrcset=0;
      const head=document.head;
      const css=document.createElement('style');
      css.id='rumiai-original-styles';
      css.textContent=styles;
      head.appendChild(css);
      // Original virtualizer's spacer/absolute placement rules are NOT
      // meaningful in the accumulated static DOM. Neutralize only the
      // copied turn containers; leave rich inner content CSS untouched.
      const flow=document.createElement('style');
      flow.id='rumiai-static-flow';
      flow.textContent=
        '#rumiai-transcript,#rumiai-transcript [data-rumiai-copied-ancestor] {'+
        'position:static!important;transform:none!important;'+
        'overflow:visible!important;height:auto!important;'+
        'max-height:none!important;contain:none!important;}'+
        '#rumiai-transcript .rumiai-accumulated-turn {'+
        'position:relative!important;transform:none!important;'+
        'inset:auto!important;visibility:visible!important;'+
        'contain:none!important;}';
      head.appendChild(flow);
      const root=document.getElementById('rumiai-transcript');
      for(const el of root.querySelectorAll('img,source,video,audio,a,link')){
        for(const prop of ['src','poster','href']){
          const original=el.getAttribute(prop);
          if(!original)continue;
          let resolved;try{resolved=new URL(original,sourceUrl).href;}
          catch{continue;}
          const file=resources.get(resolved);
          if(file)el.setAttribute(prop,file);
          else if(original.startsWith('blob:')){
            unresolvedMedia++;
            el.setAttribute('data-rumiai-unresolved-blob','true');
            el.removeAttribute(prop);
          }else if(prop==='src'||prop==='poster'){
            unresolvedMedia++;
            el.setAttribute('data-rumiai-resource-missing','true');
          }else if(prop==='href'&&
            (el.hasAttribute('download')||
             /(?:attachment|file|download)/i.test(el.outerHTML.slice(0,320)))){
            missingAttachments++;
            el.setAttribute('data-rumiai-attachment-missing','true');
          }
        }
        // Browser srcset parsers contain commas and escape rules:
        // fail closed instead of shipping remote references as offline assets.
        if(el.hasAttribute('srcset')){
          unresolvedSrcset++;
          el.setAttribute('data-rumiai-unresolved-srcset','true');
          el.removeAttribute('srcset');
        }
      }
      // SVG image nodes can refer to raster assets through href/xlink:href.
      for(const element of root.querySelectorAll('image')){
        for(const prop of ['href','xlink:href']){
          const value=element.getAttribute(prop);if(!value)continue;
          let absolute;try{absolute=new URL(value,sourceUrl).href;}catch{continue;}
          if(resources.has(absolute))element.setAttribute(prop,
            resources.get(absolute));
          else if(!value.startsWith('#'))unresolvedMedia++;
        }
      }
      document.getElementById('rumiai-hidden-until-export').remove();
      document.getElementById('rumiai-temporary-base')?.remove();
      const csp=document.createElement('meta');
      csp.httpEquiv='Content-Security-Policy';
      csp.content="default-src 'none'; img-src 'self' data: blob:; "+
        "media-src 'self' data:; font-src 'self' data:; "+
        "style-src 'self' 'unsafe-inline'; script-src 'none'; "+
        "connect-src 'none'; frame-src 'none'; object-src 'none'";
      head.prepend(csp);
      document.title='ChatGPT shared conversation — accumulated DOM PoC';
      return {html:'<!doctype html>\n'+document.documentElement.outerHTML,
        unresolvedMedia,missingAttachments,unresolvedSrcset};
    },{styles:rules.join('\n\n'),assets:[...assetMap],sourceUrl:url});
    await fs.writeFile(path.join(exportsDir,'index.html'),
      exported.html,{mode:0o600});
    manifest.unresolvedMedia=exported.unresolvedMedia;
    manifest.unresolvedAttachments=exported.missingAttachments;
    manifest.unresolvedSrcset=exported.unresolvedSrcset;
    return snapshot;
  }
  try{
    context=await chromium.launchPersistentContext(
      path.join(output,'browser-profile'),{headless:false,
        executablePath:executable,chromiumSandbox:true,
        viewport:{width:1440,height:1000},ignoreHTTPSErrors:true});
    source=await context.newPage();
    await source.addInitScript({path:path.join(root,'accumulate-observer.js')});
    source.on('response',res=>{void saveAsset(res);});
    replica=await context.newPage();
    replica.on('response',res=>{void saveAsset(res);});
    await replica.setContent('<!doctype html><html lang="it"><head>'+
      '<meta charset="utf-8"><base id="rumiai-temporary-base" href="'+url+'">'+
      '<style id="rumiai-hidden-until-export">'+
      '#rumiai-transcript{opacity:0!important}body{background:white}'+
      '</style></head><body><main id="rumiai-transcript"></main></body></html>');
    await source.bringToFront();
    console.log('[ACCUMULA] Sorgente visibile + replica DOM invisibile aperte.');
    await source.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
    await source.waitForFunction(()=>window.__rumiaiAccumulate?.status()
      .distinct>0,null,{timeout:60000});
    await wait(800);
    await source.evaluate(()=>window.__rumiaiAccumulate.scan());
    await drain();
    console.log('[ACCUMULA] Inizio osservato: '+collector.nodes.size+
      ' identità. Procedo con wheel, non con scrollTop.');
    let styles=await captureStyles();
    await source.mouse.move(900,520);
    let stagnant=0,lastVisual=null,lastIdentityAt=Date.now();
    let reason='step-budget-exhausted';
    for(let step=0;step<MAX_STEPS;step++){
      const old=collector.nodes.size;
      await source.mouse.wheel(0,580);
      await wait(180);
      await source.evaluate(()=>window.__rumiaiAccumulate?.scan());
      await drain();
      if(collector.nodes.size!==old)lastIdentityAt=Date.now();
      manifest.steps=step+1;
      if(step%4===3){
        const shot=await source.screenshot({type:'jpeg',quality:48});
        const visual=sha(shot);
        stagnant=visual===lastVisual&&collector.nodes.size===old?
          stagnant+1:0;
        lastVisual=visual;
        if(stagnant>=6&&Date.now()-lastIdentityAt>=12000){
          reason='visual-stasis-after-wheel';break;
        }
      }
      if(step%25===24){
        await writeManifest();
        console.log('[ACCUMULA] wheel='+manifest.steps+
          ' nodiConservati='+collector.nodes.size+
          ' componenti='+collector.order().components);
      }
    }
    await source.evaluate(()=>window.__rumiaiAccumulate?.scan());
    await drain();
    const status=await source.evaluate(()=>
      window.__rumiaiAccumulate?.status());
    if(status?.overflow||status?.dropped)manifest.notes.push(
      'Observer packets dropped: '+(status?.dropped||0));
    if(status?.missingIdentity)manifest.notes.push(
      'Unidentified nodes during capture: '+status.missingIdentity);
    if(status?.shadowRootsUnsupported)manifest.notes.push(
      'Shadow DOM subtrees were not captured');
    manifest.stopReason=reason;
    const finalStyles=await captureStyles();
    // Final list includes late-loaded styles that were not present at start.
    styles=finalStyles.entries?.length>=styles.entries.length?finalStyles:styles;
    const report=await finishHTML(styles);
    manifest.continuity=report;
    manifest.complete=false;
    if(report.orderComponents>1)manifest.notes.push(
      'Disconnected turn sequences: '+report.orderComponents);
    if(report.orderCycle)manifest.notes.push('Conflicting adjacency cycle');
    if(report.unstableIdentities)manifest.notes.push(
      'Fallback message identities: '+report.unstableIdentities);
    if(styles.inaccessible)manifest.notes.push(
      'Inaccessible CSSOM stylesheets: '+styles.inaccessible);
    if(manifest.resources.failed||manifest.resources.skipped)
      manifest.notes.push('Uncaptured browser resources');
    manifest.status='export-produced-not-certified';
    console.log('[EXPORT] '+path.join(exportsDir,'index.html'));
    console.log('[REPORT] '+JSON.stringify({steps:manifest.steps,
      turns:report.distinct,components:report.orderComponents,
      remounts:report.remounts,resources:manifest.resources,
      stop:reason,complete:false}));
  }catch(e){
    manifest.status='failed';manifest.notes.push(fail(e));
    console.error('[ERRORE] '+fail(e));process.exitCode=1;
  }finally{
    closed=true;
    await Promise.allSettled(assetJobs);
    manifest.ended=new Date().toISOString();
    manifest.resourcesErrors=assetErrors.slice(0,80);
    manifest.unresolvedCss=[...unresolved].slice(0,120);
    if(manifest.status!=='failed'){
      await fs.writeFile(path.join(output,'accumulated.json'),
        JSON.stringify(collector.serializable())+'\n',{mode:0o600});
      await fs.writeFile(path.join(output,'resources.json'),
        JSON.stringify(assetRecords,null,2)+'\n',{mode:0o600});
    }
    await writeManifest();
    if(context)await context.close().catch(()=>{});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv[2],process.argv[3]||DEFAULT_URL).catch(e=>{
    console.error('[ERRORE] '+fail(e));process.exitCode=1;
  });
}