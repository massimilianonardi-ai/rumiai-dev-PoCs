// Real Chrome diamond dependency graph: several failing onDispose callbacks,
// external retained exports and a required full-document reload. Loader unchanged.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'jsc-graph-disposal-'));
const loader=await readFile(join(root,'src/loader.js'));
const html=String.raw`<!doctype html><meta charset="utf-8"><script src="/loader.js"></script>
<pre id="status">BOOT</pre><script>
(()=>{
 try{
  const saved=sessionStorage.getItem('graph-count');
  const state=saved?JSON.parse(saved):{schema:1,count:7};
  if(state.schema!==1||state.count!==7)throw Error('incompatible state');
  const metrics={order:[],failures:[],staleEvents:0,oldCalls:0,activeListeners:0};
  const note=x=>metrics.order.push(x);
  const definitions=[
   {id:'screen',deps:['left','right'],factory(require,module){
    const left=require('left'),right=require('right');
    const node=document.createElement('button');node.id='old-screen';
    node.textContent='Screen '+left.version+'/'+right.version;document.body.append(node);
    module.exports={version:'v1',text:node.textContent};
    module.onDispose(()=>{note('screen-first');node.remove();});
    module.onDispose(()=>{note('screen-second');throw Error('screen-cleanup-failed');});
   }},
   {id:'left',deps:['data'],factory(require,module){
    require('data');
    const listener=()=>metrics.staleEvents++;
    window.addEventListener('external-notification',listener);metrics.activeListeners++;
    const retained=()=>{metrics.oldCalls++;return 'stale-left-export';};
    module.exports={version:'v1',retained};
    module.onDispose(()=>{note('left-first');metrics.activeListeners--;});
    module.onDispose(()=>{note('left-second');throw Error('left-disconnect-failed');});
   }},
   {id:'right',deps:['data'],factory(require,module){
    require('data');
    module.exports={version:'v1'};
    module.onDispose(()=>note('right-first'));
    module.onDispose(()=>{note('right-second');throw Error('right-cleanup-failed');});
   }},
   {id:'data',deps:[],factory(_require,module){
    module.exports={version:'v1'};
    module.onDispose(()=>note('data-first'));
   }}
  ];
  JscRuntime.installBatch(definitions);
  JscRuntime.require('screen');
  window.retained=JscRuntime.require('left').retained;
  window.demo={
   session:crypto.randomUUID(),metrics,
   get revisions(){return Object.fromEntries(['screen','left','right','data'].map(id=>[id,JscRuntime.revision(id)]));},
   get state(){return JscRuntime.state();},
   preflight(){
    const before=JSON.stringify(this.state),revisions=JSON.stringify(this.revisions);
    const failures=[];
    for(const changes of [
     [{id:'data',deps:['unavailable'],factory(){}}],
     [{id:'data',deps:['screen'],factory(){}}]
    ]){try{JscRuntime.installBatch(changes);}catch(e){failures.push(e.message);}}
    try{JscRuntime.installBatch([{id:'data',deps:[],factory(){}}],{expectedRevisions:{data:0}});}
    catch(e){failures.push(e.message);}
    return {failures,untouched:before===JSON.stringify(this.state)&&revisions===JSON.stringify(this.revisions),
     callbacks:metrics.order.length};
   },
   unsafeBatch(){
    // Application stages a recovery point BEFORE attempting irreversible disposal.
    sessionStorage.setItem('graph-count',JSON.stringify(state));
    sessionStorage.setItem('graph-reload-required','1');
    let result;
    try{
     JscRuntime.installBatch([
      {id:'data',deps:[],factory(_r,m){m.exports.version='v2';}},
      {id:'right',deps:['data'],factory(r,m){m.exports.version='v2:'+r('data').version;}}
     ],{expectedRevisions:{data:1,right:1}});
     result={unexpectedSuccess:true};
    }catch(e){
     result={name:e.name,message:e.message,errors:e.errors?.map(x=>x.message)||[]};
    }
    window.dispatchEvent(new Event('external-notification'));
    const stale=window.retained();
    document.getElementById('status').textContent='RELOAD_REQUIRED';
    return {...result,stale,metrics:{...metrics,order:[...metrics.order]},state:this.state,revisions:this.revisions,
     screenStillPresent:!!document.getElementById('old-screen')};
   }
  };
  document.getElementById('status').textContent=
   sessionStorage.getItem('graph-reload-required')?'RELOADED_NEEDS_APP_CONFIRMATION':'READY';
 }catch(e){document.getElementById('status').textContent='ERROR '+e.stack;}
})();
</script>`;
const server=http.createServer((req,res)=>{
 const path=new URL(req.url,'http://app.invalid').pathname;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline'");
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);}
 else if(path==='/loader.js'){res.setHeader('Content-Type','text/javascript');res.end(loader);}
 else{res.statusCode=404;res.end('missing');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const url='http://127.0.0.1:'+server.address().port+'/',delay=ms=>new Promise(ok=>setTimeout(ok,ms));
let chrome,socket;
try{
 const profile=join(dir,'profile');
 chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',[
  '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
  '--user-data-dir='+profile,'--remote-debugging-port=0','--remote-allow-origins=*',url
 ],{stdio:['ignore','pipe','pipe']});
 let stderr='';chrome.stderr.on('data',x=>stderr+=x.toString());
 let port=0;
 for(let i=0;i<160;i++){
  try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
  await delay(100);
 }
 assert.ok(port>0,'Chrome CDP unavailable '+stderr.slice(-650));
 let target;
 for(let i=0;i<130;i++){
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=pages.find(p=>p.type==='page'&&p.url.startsWith(url));
  if(target)break;await delay(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome app not found');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
 let seq=0;const waiting=new Map();
 socket.addEventListener('message',event=>{
  const data=JSON.parse(String(event.data)),p=waiting.get(data.id);
  if(!p)return;waiting.delete(data.id);
  if(data.error)p.fail(Error(JSON.stringify(data.error)));else p.ok(data.result);
 });
 const call=(method,params={})=>new Promise((ok,fail)=>{
  const id=++seq;waiting.set(id,{ok,fail});socket.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error('Chrome evaluation '+expression+' '+JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 const until=async(expression,label)=>{
  for(let i=0;i<150;i++){try{if(await evaluate(expression))return;}catch{}await delay(100);}
  throw Error('Timeout '+label+' '+await evaluate('document.getElementById("status")?.textContent'));
 };
 await call('Runtime.enable');await call('Page.enable');
 await until('window.demo?.session&&document.getElementById("status")?.textContent==="READY"','first graph');
 const first=await evaluate('demo.session');
 assert.deepEqual(await evaluate('demo.revisions'),{screen:1,left:1,right:1,data:1});
 assert.deepEqual(await evaluate('demo.state'),{registered:4,active:4,names:['screen','left','data','right']});
 const preflight=await evaluate('demo.preflight()');
 assert.equal(preflight.untouched,true);
 assert.equal(preflight.callbacks,0);
 assert.equal(preflight.failures.length,3);
 assert.match(preflight.failures[0],/unavailable dependency/);
 assert.match(preflight.failures[1],/circular module dependencies/);
 assert.match(preflight.failures[2],/stale module revision/);
 const failed=await evaluate('demo.unsafeBatch()');
 assert.equal(failed.name,'AggregateError');
 assert.match(failed.message,/batch definitions committed; full reload may be necessary/);
 assert.deepEqual(failed.errors,['screen-cleanup-failed','left-disconnect-failed','right-cleanup-failed']);
 assert.deepEqual(failed.metrics.order,[
  'screen-second','screen-first','left-second','left-first','right-second','right-first','data-first'
 ]);
 assert.deepEqual(failed.revisions,{screen:1,left:1,right:2,data:2});
 assert.deepEqual(failed.state,{registered:4,active:0,names:[]});
 assert.equal(failed.stale,'stale-left-export');
 assert.equal(failed.metrics.oldCalls,1);
 assert.equal(failed.metrics.staleEvents,1);
 assert.equal(failed.metrics.activeListeners,0,'counter cannot prove missing listener after throw');
 assert.equal(failed.screenStillPresent,false);
 assert.equal(await evaluate('sessionStorage.getItem("graph-reload-required")'),'1');
 // Leaked listener and exported function remain live in the old document.
 assert.equal(await evaluate('(()=>{dispatchEvent(new Event("external-notification"));return demo.metrics.staleEvents;})()'),2);
 await call('Page.reload',{ignoreCache:true});
 await until('window.demo?.session!=='+JSON.stringify(first)+'&&document.getElementById("status")?.textContent==="RELOADED_NEEDS_APP_CONFIRMATION"','new realm after failure');
 assert.equal(await evaluate('demo.metrics.staleEvents'),0);
 assert.equal(await evaluate('demo.metrics.oldCalls'),0);
 assert.equal(await evaluate('sessionStorage.getItem("graph-count")'),JSON.stringify({schema:1,count:7}));
 assert.equal(await evaluate('JscRuntime.revision("data")'),1,'new document resets module registry');
 assert.equal(await evaluate('document.querySelectorAll("#old-screen").length'),1,'fresh document contains only freshly mounted screen');
 // Explicit test application confirmation is separate from the runtime.
 await evaluate('sessionStorage.removeItem("graph-reload-required")');
 await call('Page.reload',{ignoreCache:true});
 await until('document.getElementById("status")?.textContent==="READY"','explicit confirmation');
 assert.equal(await evaluate('JscRuntime.state().active'),4);
 console.log('PASS DIAMOND GRAPH DISPOSAL: invalid/stale preflight untouched; '+JSON.stringify(failed.errors)+
  '; consumer-first reverse callback traversal, committed revisions, retained callback/listener and full Chrome reload recovery');
}finally{
 socket?.close();
 if(chrome){chrome.kill('SIGKILL');await new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)ok();else chrome.once('close',ok);});}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));
 await rm(dir,{recursive:true,force:true});
}
