// Experimental Chrome network workload, not a production performance benchmark.
// Same 25 classic modules: independently loaded runtime + lazy features vs one assembled file.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'jsc-chrome-workload-'));
const used=[0,7,19],optionalCount=24;
function generatedData(index){
 let x=(index+1)*0x9e3779b1>>>0,s='';
 const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
 for(let j=0;j<16384;j++){
  x^=x<<13;x^=x>>>17;x^=x<<5;
  s+=alphabet[(x>>>0)%alphabet.length];
 }
 return s;
}
const definitions=[];
for(let i=0;i<optionalCount;i++){
 const id='feature'+i,body=generatedData(i);
 const code='const payload='+JSON.stringify(body)+';let node=null;'+
 'module.exports.mount=()=>{if(node)throw Error("double mount");'+
 'node=document.createElement("div");node.dataset.pocModule='+JSON.stringify(id)+';'+
 'node.textContent=payload.slice(0,80);document.body.append(node);'+
 'const listener=()=>{};window.addEventListener("poc-probe",listener);window.__pocListeners++;'+
 'module.onDispose(()=>{node.remove();window.removeEventListener("poc-probe",listener);window.__pocListeners--;node=null;});'+
 'return payload.length;};';
 await writeFile(join(dir,id+'.js'),code);
 definitions.push({id,file:id+'.js',deps:[]});
}
await writeFile(join(dir,'entry.js'),'module.exports.name="entry";');
const entry={id:'entry',file:'entry.js',deps:[]};
async function compile(name,items,assemble=false){
 const manifest=join(dir,name+'.manifest.json'),target=join(dir,name+'.compiled.js');
 await writeFile(manifest,JSON.stringify({version:1,modules:items}));
 const run=spawnSync(process.execPath,[join(root,'src',assemble?'assemble.mjs':'jsc.mjs'),manifest,target],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 return readFile(target);
}
const runtime=await readFile(join(root,'src/loader.js'));
const entryCode=await compile('entry',[entry]);
const features=new Map();
for(const i of used)features.set(i,await compile('feature-'+i,[definitions[i]]));
const combined=await compile('combined',[entry,...definitions],true);
assert.ok(combined.includes(runtime),'optional assembled file must contain unchanged loader');
assert.ok(!entryCode.includes(runtime),'compiler output must not embed loader');
const scripts=new Map([['/loader.js',runtime],['/entry.js',entryCode],['/combined.js',combined]]);
for(const [index,bytes] of features)scripts.set('/feature/'+index+'.js',bytes);
const compressed=new Map([...scripts].map(([path,bytes])=>[path,gzipSync(bytes)]));
const observations=new Map();
let totalScriptGets=0;
const page=(mode,run)=>'<!doctype html><meta charset="utf-8"><title>PoC 062 Chrome workload</title>'+
 (mode==='split'
  ?'<script src="/loader.js?run='+run+'"></script><script src="/entry.js?run='+run+'"></script>'
  :'<script src="/combined.js?run='+run+'"></script>')+
 '<main id="app"></main><script>'+
 'window.__pocListeners=0;const serial='+JSON.stringify(run)+';const mode='+JSON.stringify(mode)+';'+
 'const start=performance.now();if(JscRuntime.require("entry").name!=="entry")throw Error("missing entry");'+
 'window.bench={serial,mode,startupMs:start,async use(){const t=performance.now();'+
 'for(const i of '+JSON.stringify(used)+'){'+
 'if(mode==="split")await JscRuntime.loadScript("/feature/"+i+".js?run="+serial,{expect:"feature"+i});'+
 'if(JscRuntime.require("feature"+i).mount()!==16384)throw Error("invalid mount");}'+
 'const elapsed=performance.now()-t;'+
 'if(document.querySelectorAll("[data-poc-module]").length!==3||window.__pocListeners!==3)throw Error("component mount mismatch");'+
 'return elapsed;},cleanup(){for(const i of '+JSON.stringify(used)+')JscRuntime.invalidate("feature"+i);'+
 'return {nodes:document.querySelectorAll("[data-poc-module]").length,listeners:window.__pocListeners,active:JscRuntime.state().active};}};'+
 '</script>';
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost.invalid'),path=u.pathname,run=u.searchParams.get('run');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline';connect-src 'self'");
 if(path==='/split'||path==='/combined'){
  res.setHeader('Content-Type','text/html');res.end(page(path.slice(1),run));return;
 }
 if(compressed.has(path)){
  const bytes=compressed.get(path);
  totalScriptGets++;
  if(!observations.has(run))observations.set(run,[]);
  observations.get(run).push({path,encodedBytes:bytes.length,uncompressedBytes:scripts.get(path).length});
  res.setHeader('Content-Type','text/javascript');
  res.setHeader('Content-Encoding','gzip');
  res.setHeader('Vary','Accept-Encoding');res.end(bytes);return;
 }
 res.statusCode=404;res.end('not found');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port,sleep=ms=>new Promise(done=>setTimeout(done,ms));
const profile=join(dir,'profile');let chrome,socket;
try{
 chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',[
  '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
  '--user-data-dir='+profile,'--remote-debugging-port=0','--remote-allow-origins=*','about:blank'
 ],{stdio:['ignore','pipe','pipe']});
 let diagnostic='';chrome.stderr.on('data',d=>diagnostic+=d.toString());
 let port=0;
 for(let n=0;n<160;n++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await sleep(100);}
 assert.ok(port>0,'Chrome CDP endpoint absent: '+diagnostic.slice(-700));
 let target;
 for(let n=0;n<120;n++){
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=pages.find(p=>p.type==='page');if(target)break;await sleep(100);
 }
 assert.ok(target?.webSocketDebuggerUrl,'Chrome tab absent');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
 let commandId=0;const requests=new Map();
 socket.addEventListener('message',e=>{
  const msg=JSON.parse(String(e.data)),pending=requests.get(msg.id);
  if(!pending)return;requests.delete(msg.id);
  if(msg.error)pending.fail(Error(JSON.stringify(msg.error)));else pending.ok(msg.result);
 });
 const call=(method,params={})=>new Promise((ok,fail)=>{
  const id=++commandId;requests.set(id,{ok,fail});socket.send(JSON.stringify({id,method,params}));
 });
 const js=async expression=>{
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error('Chrome evaluation failed: '+JSON.stringify(result.exceptionDetails));
  return result.result.value;
 };
 async function ready(mode,serial){
  for(let attempt=0;attempt<200;attempt++){
   try{if(await js('window.bench?.serial==='+JSON.stringify(serial)+'&&window.bench.mode==='+JSON.stringify(mode)))return;}catch{}
   await sleep(50);
  }
  throw Error('Chrome benchmark did not initialize '+serial+' '+mode+' '+diagnostic.slice(-600));
 }
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
 await call('Network.setCacheDisabled',{cacheDisabled:true});
 const latency=90,download=192*1024;
 await call('Network.emulateNetworkConditions',{offline:false,latency,downloadThroughput:download,uploadThroughput:download});
 const samples=[];
 // Interleave modes to lessen renderer warming and scheduling drift.
 for(const [index,mode] of ['split','combined','combined','split','split','combined'].entries()){
  const serial='sample-'+index+'-'+mode;
  await call('Page.navigate',{url:origin+'/'+mode+'?run='+serial});
  await ready(mode,serial);
  const boot=await js('window.bench.startupMs');
  await call('HeapProfiler.collectGarbage');
  const before=await call('Runtime.getHeapUsage');
  const firstUse=await js('window.bench.use()');
  await call('HeapProfiler.collectGarbage');
  const after=await call('Runtime.getHeapUsage');
  const cleanup=await js('window.bench.cleanup()');
  assert.deepEqual(cleanup,{nodes:0,listeners:0,active:1},
   'cleanup must release all optional UI components, listeners and instances');
  await call('HeapProfiler.collectGarbage');
  const disposed=await call('Runtime.getHeapUsage');
  const resources=observations.get(serial)||[];
  const counts={};
  for(const item of resources)counts[item.path]=(counts[item.path]||0)+1;
  if(mode==='split'){
   assert.equal(counts['/loader.js'],1);assert.equal(counts['/entry.js'],1);
   for(const i of used)assert.equal(counts['/feature/'+i+'.js'],1);
   assert.equal(counts['/combined.js'],undefined);
  }else assert.deepEqual(counts,{'/combined.js':1});
  samples.push({mode,bootMs:Math.round(boot),firstUseMs:Math.round(firstUse),
   scriptGets:resources.length,encodedScriptBytes:resources.reduce((n,r)=>n+r.encodedBytes,0),
   heapBefore:before.usedSize,heapMounted:after.usedSize,heapDisposed:disposed.usedSize});
 }
 const median=arr=>{const a=arr.slice().sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
 const summary={latencyMs:latency,downloadBytesPerSecond:download,usedOptionalCount:used.length,optionalTotal:optionalCount};
 for(const mode of ['split','combined']){
  const ss=samples.filter(s=>s.mode===mode);
  summary[mode]={sampleCount:ss.length,medianBootMs:median(ss.map(x=>x.bootMs)),
   medianFirstUseMs:median(ss.map(x=>x.firstUseMs)),scriptGets:ss[0].scriptGets,
   gzipScriptBytes:ss[0].encodedScriptBytes,
   medianMountedHeapBytes:median(ss.map(x=>x.heapMounted)),
   medianDisposedHeapBytes:median(ss.map(x=>x.heapDisposed))};
  assert.equal(new Set(ss.map(x=>x.scriptGets)).size,1);
 }
 assert.equal(totalScriptGets,18,'expected 3*(five split + one combined) actual script requests');
 assert.ok(summary.split.gzipScriptBytes<summary.combined.gzipScriptBytes);
 console.log('PASS CHROME WORKLOAD: real gzip HTTP responses, CDP latency/bandwidth, DOM listeners disposed, 3 runs per mode; '+JSON.stringify(summary));
}finally{
 socket?.close();
 if(chrome){chrome.kill('SIGKILL');await new Promise(ok=>{if(chrome.exitCode!==null||chrome.signalCode!==null)ok();else chrome.once('close',ok);});}
 await new Promise(ok=>server.close(ok));
 await rm(dir,{recursive:true,force:true});
}
