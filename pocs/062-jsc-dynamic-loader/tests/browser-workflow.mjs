// A developer-facing live page, not an artificial in-page registry-only fixture.
// The same sources are built into separate dev scripts and an assembled bundle.
// Real headless Chromium proves physical network laziness and v1 -> v2 cleanup.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(import.meta.dirname,'..');
const work=join(root,'example/workflow');
const dest=await mkdtemp(join(tmpdir(),'jsc-browser-workflow-'));
let server=null;
const requests=new Map();
async function chrome(url,profile){
 const exe=process.env.CHROMIUM||'/usr/bin/chromium';
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,['--headless','--no-sandbox','--disable-gpu','--no-first-run',
   '--disable-dev-shm-usage','--virtual-time-budget=12000',
   '--user-data-dir='+join(dest,profile),'--dump-dom',url],{stdio:['ignore','pipe','pipe']});
  let output='',errors='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('browser workflow timeout: '+errors.slice(-1500)));},45000);
  child.stdout.on('data',buf=>output+=buf.toString());
  child.stderr.on('data',buf=>errors+=buf.toString());
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);resolve({code,output,errors});});
 });
}
try{
 const build=spawnSync(process.execPath,[join(work,'build.mjs'),dest],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr);
 const allowed=new Set(['dev.html','release.html','loader.js','initial.js',
  'optional.js','patch.js','bundle-all.js','client.js']);
 server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://example.invalid').pathname.slice(1);
  requests.set(file,(requests.get(file)||0)+1);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'");
  if(!allowed.has(file)){res.writeHead(404);res.end('Not found');return;}
  try{
   const bytes=await readFile(join(dest,file));
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
   res.end(bytes);
  }catch(error){res.writeHead(500);res.end(String(error));}
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+server.address().port;
 for(const mode of ['dev','release']){
  const priorOptional=requests.get('optional.js')||0;
  const priorPatch=requests.get('patch.js')||0;
  const result=await chrome(origin+'/'+mode+'.html?selftest=1','profile-'+mode);
  assert.equal(result.code,0,result.errors.slice(-1100));
  const text=result.output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1]||'';
  assert.ok(text.startsWith('PASS WORKFLOW '),text||result.output.slice(-1500));
  const state=JSON.parse(text.slice('PASS WORKFLOW '.length).replaceAll('&quot;','"'));
  assert.equal(state.version,'v2');
  assert.equal(state.taps,2);
  assert.equal(state.disposals,1);
  assert.equal(state.active,3);
  assert.equal(state.registered,3);
  assert.equal(state.mode,mode==='dev'?'network':'embedded');
  assert.equal((requests.get('optional.js')||0)-priorOptional,mode==='dev'?1:0,
   mode+': optional physically downloaded when it should be embedded/remote');
  assert.equal((requests.get('patch.js')||0)-priorPatch,1,
   mode+': compiled patch not fetched exactly once');
 }
 console.log('PASS REAL CHROME WORKFLOW: generated developer page fetched optional only on demand, release page embedded it without download, both fetched compiled v2 patch and disposed old listener');
}finally{
 if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 await rm(dest,{recursive:true,force:true});
}
