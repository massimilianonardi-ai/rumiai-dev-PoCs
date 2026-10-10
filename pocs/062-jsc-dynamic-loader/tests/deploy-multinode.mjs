// PoC 062: independent HTTP backends and an intermediary. This is an application fixture,
// not a public compiler/loader protocol, global atomic deploy, or distributed consensus.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const tmp=await mkdtemp(join(tmpdir(),'jsc-two-origins-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const bundles=new Map();
for(const [version,epoch] of [['v1',1],['v2',2]]){
 await writeFile(join(tmp,version+'.js'),'module.exports={version:'+JSON.stringify(version)+',epoch:'+epoch+'};');
 const manifest=join(tmp,version+'.json'),output=join(tmp,version+'.bundle.js');
 await writeFile(manifest,JSON.stringify({version:1,modules:[{id:'app',deps:[],file:version+'.js'}]}));
 const built=spawnSync(process.execPath,[join(root,'src/assemble.mjs'),manifest,output],{encoding:'utf8'});
 assert.equal(built.status,0,built.stderr);
 const body=await readFile(output),hash=sha(body);
 bundles.set(version,{version,epoch,url:'/assets/'+hash+'.js',hash,body});
}
const old=bundles.get('v1'),next=bundles.get('v2');
const nodes=[
 {name:'A',version:'v1',assets:new Map([[old.url,old.body]])},
 {name:'B',version:'v1',assets:new Map([[old.url,old.body]])}
];
const services=[];
const start=handler=>new Promise(resolve=>{const s=http.createServer(handler);s.listen(0,'127.0.0.1',()=>resolve(s));});
let pointerNode=0,assetNode=0,edgeRequests=0,stalePointers=0,installed=null;
const clientPins=new Set(['v1']);
async function retrieve(base){
 try{
  const pointer=await fetch(base+'/release.json',{cache:'no-store'});
  if(!pointer.ok)throw Error('pointer-http-'+pointer.status);
  const p=await pointer.json();
  if(!Number.isSafeInteger(p.epoch)||!['v1','v2'].includes(p.version)||typeof p.hash!=='string'||
     !/^[a-f0-9]{64}$/.test(p.hash)||p.url!=='/assets/'+p.hash+'.js')throw Error('pointer-invalid');
  if(installed&&p.epoch<installed.epoch){stalePointers++;throw Error('pointer-stale');}
  const asset=await fetch(base+p.url,{cache:'no-store'});
  if(!asset.ok)throw Error('asset-http-'+asset.status);
  const bytes=Buffer.from(await asset.arrayBuffer());
  if(sha(bytes)!==p.hash)throw Error('asset-integrity');
  const sandbox=vm.createContext({});
  vm.runInContext(bytes.toString('utf8'),sandbox,{timeout:2500});
  const instance=sandbox.JscRuntime.require('app');
  if(instance.version!==p.version||instance.epoch!==p.epoch)throw Error('version-mismatch');
  installed={epoch:p.epoch,version:p.version,hash:p.hash};
  clientPins.add(p.version);
  return {ok:true,version:p.version};
 }catch(e){return {ok:false,error:e.message};}
}
try{
 for(const node of nodes){
  const server=await start((req,res)=>{
   const path=new URL(req.url,'http://node.invalid').pathname;
   res.setHeader('X-Origin',node.name);
   if(path==='/release.json'){
    const b=bundles.get(node.version);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({version:b.version,epoch:b.epoch,url:b.url,hash:b.hash}));return;
   }
   if(node.assets.has(path)){
    res.setHeader('Content-Type','text/javascript');
    res.setHeader('Cache-Control','public,max-age=31536000,immutable');
    res.end(node.assets.get(path));return;
   }
   res.statusCode=404;res.end('missing asset');
  });services.push(server);
 }
 const origins=services.map(s=>'http://127.0.0.1:'+s.address().port);
 const proxy=await start(async(req,res)=>{
  edgeRequests++;
  try{
   const path=new URL(req.url,'http://edge.invalid').pathname;
   const destination=path==='/release.json'?pointerNode:assetNode;
   const response=await fetch(origins[destination]+req.url,{cache:'no-store'});
   res.statusCode=response.status;
   res.setHeader('X-Routed-To',nodes[destination].name);
   res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.statusCode=502;res.end(e.message);}
 });
 services.push(proxy);
 const edge='http://127.0.0.1:'+proxy.address().port;
 assert.deepEqual(await retrieve(edge),{ok:true,version:'v1'});
 // B wrongly makes a new pointer visible without its asset.
 nodes[1].version='v2';pointerNode=1;assetNode=1;
 assert.deepEqual(await retrieve(edge),{ok:false,error:'asset-http-404'});
 assert.equal(installed.version,'v1');
 // B's incomplete asset has the right immutable URL but the wrong checksum.
 nodes[1].assets.set(next.url,next.body.subarray(0,50));
 assert.deepEqual(await retrieve(edge),{ok:false,error:'asset-integrity'});
 assert.equal(installed.version,'v1');
 nodes[1].assets.set(next.url,next.body);
 // Proxy pairs B's new pointer with A's old asset collection.
 assetNode=0;
 assert.deepEqual(await retrieve(edge),{ok:false,error:'asset-http-404'});
 assert.equal(installed.version,'v1');
 // Stage the full new generation on A too; the same mixed-origin route is now safe.
 nodes[0].assets.set(next.url,next.body);
 assert.deepEqual(await retrieve(edge),{ok:true,version:'v2'});
 assert.equal(installed.epoch,2);
 // Stale pointer from A cannot roll the already verified app back to v1.
 pointerNode=0;
 assert.deepEqual(await retrieve(edge),{ok:false,error:'pointer-stale'});
 assert.equal(installed.version,'v2');
 assert.equal(stalePointers,1);
 function prune(version){
  if(clientPins.has(version))return false;
  for(const node of nodes)node.assets.delete(bundles.get(version).url);
  return true;
 }
 // Unknown, disconnected, or suspended clients are still pinned unless explicitly released.
 assert.equal(prune('v1'),false);
 for(const node of nodes)assert.ok(node.assets.has(old.url));
 clientPins.delete('v1'); // Test-owned explicit acknowledgement, never inferred from timeout.
 assert.equal(prune('v1'),true);
 for(const node of nodes){assert.ok(!node.assets.has(old.url));assert.ok(node.assets.has(next.url));}
 pointerNode=1;
 assert.deepEqual(await retrieve(edge),{ok:true,version:'v2'});
 assert.ok(edgeRequests>=13,'actual intermediary HTTP calls required');
 console.log('PASS MULTINODE: two HTTP origins plus intermediary, absent/corrupt/mismatched bundles refused, stale pointers rejected and known client pins preserved until explicit release');
}finally{
 await Promise.all(services.reverse().map(server=>new Promise(resolve=>server.close(resolve))));
 await rm(tmp,{recursive:true,force:true});
}
