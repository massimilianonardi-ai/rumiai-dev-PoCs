#!/usr/bin/env node
// Interactive, research-only ChatGPT shared-page probe. This is NOT an exporter.
// Direct Playwright/CDP access is intentionally confined to this throwaway PoC
// because the released web-control event buffer cannot retain large script bursts.
// No browser extension, site bundle, network request or page DOM is rewritten.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';

const root=path.dirname(fileURLToPath(import.meta.url));
const pageUrl='https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835';
const maxScripts=1000,maxSourceBytes=200*1024*1024,maxSingleSource=12*1024*1024;
const maxResponses=120,maxResponseBytes=40*1024*1024;
const maxSamples=12000,maxChanges=100000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const errorText=e=>String(e?.message||e).slice(0,250);
export function safeResourceUrl(value){
  try{
    const u=new URL(value);
    if(!/^https?:$/.test(u.protocol))return u.protocol;
    return u.origin+u.pathname; // no queries, fragments, tokens or cookies
  }catch{return '[non-url-script]';}
}
// Structural JSON shape only; response values and user prompts stay private.
export function responseSchema(value,depth=0){
  if(depth>=5)return {type:'depth-limit'};
  if(Array.isArray(value))return {type:'array',length:value.length,
    item:value.length?responseSchema(value[0],depth+1):null};
  if(value===null)return {type:'null'};
  if(typeof value==='object'){
    const keys=Object.keys(value);
    return {type:'object',keys:keys.slice(0,45),
      additionalKeys:Math.max(0,keys.length-45),
      members:Object.fromEntries(keys.slice(0,45).map(k=>[
        k,responseSchema(value[k],depth+1)]))};
  }
  if(typeof value==='string')return {type:'string',length:value.length};
  return {type:typeof value};
}
export function investigationPaths(run){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(run))
    throw Error('investigation.invalid-name');
  return path.join(root,'evidence','investigations',run);
}
async function run(name){
  const directory=investigationPaths(name);
  if(await fs.lstat(directory).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)))
    throw Error('investigation.evidence-already-exists');
  const evidence=path.join(root,'evidence');
  if(await fs.realpath(evidence)!==evidence)throw Error('investigation.evidence-root-symlink');
  const investigations=path.join(evidence,'investigations');
  await fs.mkdir(investigations,{recursive:true,mode:0o700});
  if(await fs.realpath(investigations)!==investigations)
    throw Error('investigation.output-root-symlink');
  await fs.mkdir(directory,{mode:0o700});
  for(const sub of ['scripts','responses','screenshots','render-assets'])
    await fs.mkdir(path.join(directory,sub),{mode:0o700});
  for(const log of ['network.jsonl','response-schema.jsonl',
    'dom-samples.jsonl','dom-mutations.jsonl','checkpoints.jsonl'])
    await fs.writeFile(path.join(directory,log),'',
      {flag:'wx',mode:0o600});
  const provider=path.join(root,'.runtime','pwc');
  const require=createRequire(path.join(provider,'package.json'));
  const {chromium}=require('playwright');
  const executable=process.env.WEB_CONTROL_BROWSER_EXECUTABLE||
    process.env.PWC069_BROWSER_EXECUTABLE;
  if(!executable||!path.isAbsolute(executable))
    throw Error('investigation.browser-executable-required');
  const jsObserver=await fs.readFile(path.join(root,'investigate-observer.js'),'utf8');
  const stdin=createInterface({input:process.stdin,output:process.stdout});
  const runState={status:'started',pageUrl:pageUrl,
    startedAt:new Date().toISOString(),endedAt:null,checkpoints:[],
    scripts:{parsed:0,saved:0,totalBytes:0,skipped:0,failures:0},
    responses:{seen:0,saved:0,totalBytes:0,skipped:0,failures:0},
    renderAssets:{seen:0,saved:0,totalBytes:0,skipped:0,failures:0},
    samples:0,mutationEvents:0,mutationDropped:0,workerUrls:[],
    warnings:[],incomplete:false};
  async function persistManifest(){
    const temporary=path.join(directory,'manifest.json.tmp');
    await fs.writeFile(temporary,JSON.stringify(runState,null,2)+'\n',
      {mode:0o600});
    await fs.rename(temporary,path.join(directory,'manifest.json'));
  }
  const output=(filename,obj)=>fs.appendFile(path.join(directory,filename),
    JSON.stringify(obj)+'\n',{mode:0o600});
  let browser=null,cdp=null,page=null;
  let timer=null,readBusy=false,closed=false,sampleLast='',drainPromise=Promise.resolve();
  let pendingScripts=[],sourceWorkers=0,sourceBusy=0,sourceSequence=0;
  let scriptMetadata=[],scriptJobs=[],responseJobs=[],assetJobs=[],pendingResponses=0;
  let assetCount=0,assetBytes=0;
  const maxAssetCount=360,maxAssetBytes=100*1024*1024;
  const assetMimes=[/^text\/css\b/,/^image\//,/^(?:font\/|application\/(?:font|pdf|octet-stream))/,/^audio\//,/^video\//];
  const seenScriptIds=new Set();
  const asyncErrors=[];
  let capturedSourceBytes=0,responseBytes=0,savedResponses=0;
  function scheduleScript(){
    while(sourceBusy<4&&pendingScripts.length){
      const desc=pendingScripts.shift();
      sourceBusy++;
      const task=(async()=>{
        try{
          const data=await cdp.send('Debugger.getScriptSource',
            {scriptId:desc.scriptId});
          const source=typeof data.scriptSource==='string'?data.scriptSource:'';
          const size=Buffer.byteLength(source);
          if(!size||size>maxSingleSource||
             capturedSourceBytes+size>maxSourceBytes){
            runState.scripts.skipped++;
            desc.status=size?'size-budget':'empty-or-unavailable';
            desc.bytes=size;return;
          }
          capturedSourceBytes+=size;
          const file='scripts/'+desc.file+'.js';
          await fs.writeFile(path.join(directory,file),source,
            {flag:'wx',mode:0o600});
          runState.scripts.saved++;
          runState.scripts.totalBytes+=size;
          desc.status='saved';desc.bytes=size;desc.sha256=sha(source);
          desc.sourceFile=file;
        }catch(e){
          desc.status='error';desc.reason=errorText(e);
          runState.scripts.failures++;
        }
      })().finally(()=>{sourceBusy--;scheduleScript();});
      scriptJobs.push(task);
    }
  }
  function trackScript(event){
    if(seenScriptIds.has(event.scriptId))return;
    seenScriptIds.add(event.scriptId);
    runState.scripts.parsed++;
    const desc={scriptId:event.scriptId,
      url:safeResourceUrl(event.url),
      sourceMapUrl:safeResourceUrl(event.sourceMapURL||''),
      startLine:event.startLine,scriptLanguage:event.scriptLanguage||'JavaScript',
      file:String(++sourceSequence).padStart(5,'0'),status:'queued'};
    scriptMetadata.push(desc);
    if(sourceSequence>maxScripts){
      desc.status='script-budget';runState.scripts.skipped++;return;
    }
    pendingScripts.push(desc);scheduleScript();
  }
  function boundedResponseBody(response,timeoutMs=12000){
    let timer;
    return Promise.race([
      response.body(),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error('investigation.body-timeout')),timeoutMs);
      })
    ]).finally(()=>clearTimeout(timer));
  }
  function captureResponse(response){
    const req=response.request();
    const mime=(response.headers()['content-type']||'').toLowerCase();
    const url=response.url();
    const allowed=(()=>{try{
      const h=new URL(url).hostname;
      return h==='chatgpt.com'||h.endsWith('.chatgpt.com')||
        h==='openai.com'||h.endsWith('.openai.com');
    }catch{return false}})();
    runState.responses.seen++;
    // ChatGPT shared pages may hydrate state via HTML or streamed
    // React/server-component frames, not just application/json. Preserve
    // selected actual first-party responses as *private forensic evidence*.
    // Event streams never finish, so do not block on their response bodies.
    if(!allowed||/event-stream/.test(mime)||
       !/(?:json|text\/html|text\/x-component|x-ndjson)/.test(mime))
      return;
    if(savedResponses>=maxResponses){
      runState.responses.skipped++;
      return;
    }
    pendingResponses++;
    const n=savedResponses++;
    const job=(async()=>{
      try{
        const body=await boundedResponseBody(response);
        if(body.length>6*1024*1024||
           responseBytes+body.length>maxResponseBytes){
          runState.responses.skipped++;return;
        }
        responseBytes+=body.length;
        const filename='responses/'+String(n).padStart(5,'0')+'.body';
        // These files CAN contain full conversation data and stay gitignored.
        await fs.writeFile(path.join(directory,filename),body,
          {flag:'wx',mode:0o600});
        runState.responses.saved++;runState.responses.totalBytes+=body.length;
        await output('network.jsonl',{kind:'response-body',
          file:filename,bytes:body.length,sha256:sha(body),
          url:safeResourceUrl(url),type:req.resourceType(),mime});
        try{
          const decoded=JSON.parse(body.toString('utf8'));
          await output('response-schema.jsonl',{url:safeResourceUrl(url),
            sha256:sha(body),structure:responseSchema(decoded)});
        }catch(e){
          await output('response-schema.jsonl',{url:safeResourceUrl(url),
            sha256:sha(body),structure:{type:'not-json'}});
        }
      }catch(e){
        runState.responses.failures++;
        await output('network.jsonl',{kind:'body-unavailable',
          url:safeResourceUrl(url),reason:errorText(e)});
      }finally{pendingResponses--;}
    })();
    responseJobs.push(job);
  }
  function captureRenderedAsset(response){
    const request=response.request(),mime=(response.headers()['content-type']||'')
      .split(';')[0].trim().toLowerCase();
    const rt=request.resourceType();
    // Only resources the real browser has already requested. The exporter
    // must separately resolve message attachment pointers not loaded here.
    if(!['stylesheet','image','font','media'].includes(rt)&&
       !assetMimes.some(re=>re.test(mime)))return;
    runState.renderAssets.seen++;
    if(assetCount>=maxAssetCount){
      runState.renderAssets.skipped++;return;
    }
    const n=assetCount++;
    const task=(async()=>{
      try{
        const body=await boundedResponseBody(response);
        if(body.length>12*1024*1024||
           assetBytes+body.length>maxAssetBytes){
          runState.renderAssets.skipped++;return;
        }
        assetBytes+=body.length;
        const extension=/css/.test(mime)?'css':
          /svg/.test(mime)?'svg':/png/.test(mime)?'png':
          /jpe?g/.test(mime)?'jpg':/webp/.test(mime)?'webp':
          /gif/.test(mime)?'gif':/woff2/.test(mime)?'woff2':
          /woff/.test(mime)?'woff':/pdf/.test(mime)?'pdf':'bin';
        const file='render-assets/'+String(n).padStart(5,'0')+'.'+extension;
        await fs.writeFile(path.join(directory,file),body,{flag:'wx',mode:0o600});
        runState.renderAssets.saved++;runState.renderAssets.totalBytes+=body.length;
        await output('render-assets.jsonl',{file,url:safeResourceUrl(response.url()),
          mime,resourceType:rt,sha256:sha(body),bytes:body.length,
          originalStatus:response.status()});
      }catch(e){
        runState.renderAssets.failures++;
        await output('render-assets.jsonl',{url:safeResourceUrl(response.url()),
          resourceType:rt,error:errorText(e)});
      }
    })();
    assetJobs.push(task);
  }
  async function inspectEventListeners(label){
    const results=[];
    for(const [name,expression] of [
      ['window','window'],['document','document'],
      ['main',"document.querySelector('main')"]
    ]){
      try{
        const object=await cdp.send('Runtime.evaluate',{
          expression,returnByValue:false});
        const id=object?.result?.objectId;
        if(!id){results.push({target:name,status:'not-found'});continue;}
        const response=await cdp.send('DOMDebugger.getEventListeners',
          {objectId:id,depth:0,pierce:false});
        results.push({target:name,status:'ok',
          listeners:(response.listeners||[]).map(item=>({
            type:item.type,scriptId:item.location?.scriptId,
            line:item.location?.lineNumber,column:item.location?.columnNumber,
            useCapture:item.useCapture,passive:item.passive
          }))});
        await cdp.send('Runtime.releaseObject',{objectId:id}).catch(()=>{});
      }catch(e){results.push({target:name,status:'unavailable',
        reason:errorText(e)});}
    }
    await fs.writeFile(path.join(directory,'listeners-'+label+'.json'),
      JSON.stringify(results,null,2)+'\n',{mode:0o600});
    return results;
  }
  async function takePhase(label){
    const obs=await page.evaluate(()=>
      window.__rumiaiInvestigate?.snapshot()||null).catch(()=>null);
    const listeners=await inspectEventListeners(label);
    try{
      // Preserve DOM fragments for rich rendered content such as tables,
      // SVG charts, canvas metadata and attachment wrappers. Never publish
      // this page HTML to Git: it can include signed asset references.
      const render=await page.evaluate(()=>{
        const scope=document.querySelector('main')||document.body;
        const rich=scope?[...scope.querySelectorAll(
          'table,svg,canvas,picture,img,video,audio,[data-message-author-role]')]:[];
        const limit=420,htmlMax=2800000;
        let used=0;
        const fragments=[];
        for(const node of rich){
          if(fragments.length>=limit)break;
          const html=node.outerHTML||'';
          if(used+html.length>htmlMax)break;
          used+=html.length;
          const style=getComputedStyle(node);
          const computed={};
          for(const key of ['display','position','font-family','font-size',
            'font-weight','line-height','color','background-color','white-space',
            'text-align','direction','width','height','min-width','max-width',
            'margin-top','margin-bottom','padding-left','padding-right',
            'border-top','border-bottom','overflow-x','overflow-y',
            'grid-template-columns','flex-direction','align-items']){
            computed[key]=style.getPropertyValue(key);
          }
          fragments.push({tag:node.localName,
            id:node.id||null,
            role:node.getAttribute('data-message-author-role'),
            html,computed});
        }
        const canvases=[];
        for(const [index,node] of [...scope.querySelectorAll('canvas')]
          .slice(0,32).entries()){
          try{
            const encoded=node.toDataURL('image/png');
            canvases.push({index,width:node.width,height:node.height,
              image:encoded.length<=7*1024*1024?encoded:null,
              status:encoded.length<=7*1024*1024?'captured':'oversize'});
          }catch(e){canvases.push({index,width:node.width,height:node.height,
            image:null,status:'tainted-or-inaccessible'});}
        }
        const sheets=[...document.styleSheets].slice(0,150).map(sheet=>{
          let rules=[],inaccessible=false;
          try{
            rules=[...sheet.cssRules].slice(0,25000)
              .map(r=>r.cssText).join('\n').slice(0,1000000);
          }catch{inaccessible=true;}
          return {href:sheet.href||null,inline:!sheet.href,
            inaccessible,cssText:rules};
        });
        return {fragments,totalElements:rich.length,
          fragmentTruncated:fragments.length<rich.length,
          canvases,canvasTruncated:scope.querySelectorAll('canvas').length>32,
          styleSheets:sheets,styleSheetTruncated:document.styleSheets.length>150,
          viewport:{width:innerWidth,height:innerHeight}};
      });
      for(const canvas of render.canvases||[]){
        if(!canvas.image)continue;
        const file='canvas-'+label+'-'+String(canvas.index).padStart(3,'0')+'.png';
        await fs.writeFile(path.join(directory,file),
          Buffer.from(canvas.image.split(',')[1],'base64'),
          {flag:'wx',mode:0o600});
        canvas.file=file;
        delete canvas.image;
      }
      await fs.writeFile(path.join(directory,'render-'+label+'.json'),
        JSON.stringify(render),{mode:0o600});
      if(render.fragmentTruncated||render.styleSheetTruncated||
         render.canvasTruncated||
         render.styleSheets?.some(x=>x.inaccessible)||
         render.canvases?.some(x=>x.status!=='captured')){
        runState.incomplete=true;
        runState.warnings.push('render-limits-or-inaccessible-'+label);
      }
    }catch(e){
      runState.warnings.push('render-structure-'+label+':'+errorText(e));
      runState.incomplete=true;
    }
    try{
      const documentSnapshot=await cdp.send('DOMSnapshot.captureSnapshot',{
        computedStyles:['display','position','overflow-y','transform'],
        includeDOMRects:true});
      await fs.writeFile(path.join(directory,'dom-'+label+'.json'),
        JSON.stringify(documentSnapshot),{mode:0o600});
    }catch(e){
      runState.warnings.push('dom-snapshot-'+label+':'+errorText(e));
      runState.incomplete=true;
    }
    const coverage=await cdp.send('Profiler.takePreciseCoverage')
      .then(x=>x.result||[],e=>({error:errorText(e)}));
    const shot=path.join(directory,'screenshots',label+'.png');
    await page.screenshot({path:shot,fullPage:false}).catch(e=>
      runState.warnings.push('screenshot-'+label+':'+errorText(e)));
    await output('checkpoints.jsonl',{label,at:new Date().toISOString(),
      snapshot:obs,coverageCount:Array.isArray(coverage)?coverage.length:null});
    await fs.writeFile(path.join(directory,'coverage-'+label+'.json'),
      JSON.stringify(coverage),{mode:0o600});
    // Persist the current code index at every manual phase. A closed
    // terminal must not discard all script identities collected so far.
    await fs.writeFile(path.join(directory,'scripts.json'),
      JSON.stringify(scriptMetadata,null,2)+'\n',{mode:0o600});
    runState.checkpoints.push({label,
      listenerTargets:listeners.filter(x=>x.status==='ok').length,
      messages:obs?.messages?.length||0,
      windowY:obs?.scroll?.windowY??null,
      rootY:obs?.scroll?.rootY??null,
      actualScrollers:obs?.boxes?.filter(x=>x.actualScroller).length||0,
      scriptCoverage:Array.isArray(coverage)?coverage.length:null});
    await persistManifest();
    process.stdout.write('[FASE] '+label+' messaggiDOM='+
      (obs?.messages?.length??'?')+' scrollY='+
      String(obs?.scroll?.windowY??'?')+' containerInterni='+
      String(obs?.boxes?.filter(x=>x.actualScroller).length??'?')+'\n');
  }
  async function sample(){
    if(readBusy||closed||!page)return;
    readBusy=true;
    try{
      const result=await page.evaluate(()=>
        ({snapshot:window.__rumiaiInvestigate?.snapshot()||null,
          mutations:window.__rumiaiInvestigate?.drain(1800)||null}));
      const snap=result.snapshot,changes=result.mutations;
      if(snap&&runState.samples<maxSamples){
        const key=sha(JSON.stringify({
          y:snap.scroll?.windowY,root:snap.scroll?.rootY,
          keys:snap.messages?.map(m=>[m.key,m.top,m.bottom,m.contentHash]),
          stats:snap.stats,boxes:snap.boxes?.filter(x=>x.actualScroller)
        }));
        if(key!==sampleLast||runState.samples%25===0){
          await output('dom-samples.jsonl',snap);
          runState.samples++;
          sampleLast=key;
        }
      }else if(runState.samples>=maxSamples){
        runState.incomplete=true;
        if(!runState.warnings.includes('sample-budget'))
          runState.warnings.push('sample-budget');
      }
      if(changes?.events?.length){
        for(const item of changes.events){
          if(runState.mutationEvents>=maxChanges){
            runState.incomplete=true;
            if(!runState.warnings.includes('mutation-budget'))
              runState.warnings.push('mutation-budget');
            break;
          }
          await output('dom-mutations.jsonl',item);
          runState.mutationEvents++;
        }
      }
      if(changes?.stats?.dropped>runState.mutationDropped){
        runState.mutationDropped=changes.stats.dropped;
        runState.incomplete=true;
        if(!runState.warnings.includes('mutation-observer-overflow'))
          runState.warnings.push('mutation-observer-overflow');
      }
    }catch(e){
      runState.incomplete=true;
      if(runState.warnings.length<25)
        runState.warnings.push('sampling:'+errorText(e));
    }finally{readBusy=false;}
  }
  for(const signal of ['SIGHUP','SIGINT','SIGTERM']){
    process.once(signal,()=>{
      runState.incomplete=true;
      runState.warnings.push('operator-session-interrupted:'+signal);
      stdin.close(); // reject any pending phase question and enter finally
    });
  }
  try{
    browser=await chromium.launchPersistentContext(
      path.join(directory,'browser-profile'),{
        headless:false,executablePath:executable,chromiumSandbox:true,
        viewport:{width:1440,height:1000},ignoreHTTPSErrors:true
      });
    browser.on('serviceworker',worker=>
      runState.workerUrls.push(safeResourceUrl(worker.url())));
    page=await browser.newPage();
    page.on('worker',worker=>
      runState.workerUrls.push(safeResourceUrl(worker.url())));
    page.on('request',request=>{
      void output('network.jsonl',{kind:'request',at:new Date().toISOString(),
        url:safeResourceUrl(request.url()),method:request.method(),
        resourceType:request.resourceType()}).catch(e=>asyncErrors.push(errorText(e)));
    });
    page.on('response',response=>{
      captureResponse(response);
      captureRenderedAsset(response);
    });
    page.on('pageerror',e=>{
      if(runState.warnings.length<25)
        runState.warnings.push('page-exception:'+errorText(e));
    });
    cdp=await browser.newCDPSession(page);
    cdp.on('Debugger.scriptParsed',trackScript);
    await Promise.all([cdp.send('Page.enable'),cdp.send('Debugger.enable'),
      cdp.send('Profiler.enable'),cdp.send('Network.enable')]);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:jsObserver});
    await cdp.send('Profiler.startPreciseCoverage',
      {callCount:true,detailed:true});
    timer=setInterval(()=>{void sample();},300);
    process.stdout.write('[INVESTIGA] Avvio ChatGPT condiviso, solo osservazione.\n');
    await page.goto(pageUrl,{waitUntil:'domcontentloaded',timeout:90000});
    await new Promise(resolve=>setTimeout(resolve,1200));
    await sample();
    await takePhase('initial');
    for(const [name,question] of [
      ['top','Vai manualmente all’inizio della chat; INVIO quando vedi i primi messaggi: '],
      ['bottom','Scorri manualmente fino al fondo; INVIO quando vedi gli ultimi messaggi: '],
      ['top-again','Risali manualmente all’inizio; INVIO quando vedi i primi messaggi: ']
    ]){
      await stdin.question(question);
      await sample();
      await takePhase(name);
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
    runState.status='captured';
  }catch(e){
    runState.incomplete=true;
    runState.status='failed';
    runState.warnings.push('investigation-exception:'+errorText(e));
    process.stderr.write('[ERRORE] '+errorText(e)+'\n');
  }finally{
    if(timer)clearInterval(timer);
    if(page&&!page.isClosed())await sample();
    closed=true;
    if(cdp)await cdp.send('Profiler.stopPreciseCoverage').catch(()=>{});
    // Dynamic script parsing can enqueue new retrieval jobs while draining.
    while(pendingScripts.length||sourceBusy)
      await new Promise(resolve=>setTimeout(resolve,150));
    await Promise.allSettled(scriptJobs);
    await Promise.allSettled(responseJobs);
    await Promise.allSettled(assetJobs);
    await fs.writeFile(path.join(directory,'scripts.json'),
        JSON.stringify(scriptMetadata,null,2)+'\n',{mode:0o600});
    runState.endedAt=new Date().toISOString();
    if(runState.scripts.parsed===0||runState.samples===0||
       runState.checkpoints.length<4){
      runState.incomplete=true;
      runState.warnings.push('runtime-source-or-manual-phases-missing');
    }
    if(runState.scripts.skipped||runState.scripts.failures||
       runState.responses.skipped||runState.responses.failures||
       runState.renderAssets.skipped||runState.renderAssets.failures||
       runState.mutationDropped||asyncErrors.length||
       runState.workerUrls.length){
      runState.incomplete=true;
      runState.warnings.push(...asyncErrors.slice(0,10));
      if(runState.workerUrls.length)
        runState.warnings.push('worker-scripts-not-in-main-page-cdp-session');
    }
    await persistManifest();
    if(browser)await browser.close().catch(()=>{});
    stdin.close();
  }
  process.stdout.write('[INVESTIGA] '+directory+'\n');
  process.stdout.write('[SOMMARIO] '+JSON.stringify({
    status:runState.status,scripts:runState.scripts,checkpoints:runState.checkpoints,
    responses:runState.responses,renderAssets:runState.renderAssets,samples:runState.samples,
    mutations:runState.mutationEvents,incomplete:runState.incomplete,
    warnings:runState.warnings.slice(0,8)})+'\n');
  if(runState.status!=='captured')process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  run(process.argv[2]).catch(e=>{
    process.stderr.write('[ERRORE] '+errorText(e)+'\n');
    process.exitCode=1;
  });
}
