// PoC 062: actual HTTP intermediary cache, conditional ETag revalidation, delayed invalidation.
// This is a controlled app/deployment fixture; not a CDN, distributed consensus or loader API.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'jsc-cache-edge-'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const builds=new Map();
for(const [version,epoch] of [['v1',1],['v2',2]]){
 await writeFile(join(dir,version+'.js'),'module.exports={version:'+JSON.stringify(version)+',epoch:'+epoch+'};');
 const manifest=join(dir,version+'.json'),out=join(dir,version+'.bundle.js');
 await writeFile(manifest,JSON.stringify({version:1,modules:[{id:'app',file:version+'.js',deps:[]}]}));
 const result=spawnSync(process.execPath,[join(root,'src/assemble.mjs'),manifest,out],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const body=await readFile(out),sha256=hash(body);
 builds.set(version,{version,epoch,sha256,url:'/assets/'+sha256+'.js',body});
}
const v1=builds.get('v1'),v2=builds.get('v2');
const nodes=[
 {version:'v1',assets:new Map([[v1.url,v1.body]])},
 {version:'v1',assets:new Map([[v1.url,v1.body]])}
];
let pointerNode=0,assetNode=0,logicalSecond=0,ttl=30,cache=null;
let originPointer200=0,originPointer304=0,edgeCacheHits=0,edgeRevalidations=0;
const servers=[];
function start(handler){return new Promise(resolve=>{const s=http.createServer(handler);s.listen(0,'127.0.0.1',()=>resolve(s));});}
const release=node=>{
 const b=builds.get(node.version);
 return {version:b.version,epoch:b.epoch,url:b.url,sha256:b.sha256};
};
let accepted=null;
async function accept(base){
 try{
  const pointer=await fetch(base+'/release.json',{cache:'no-store'});
  if(!pointer.ok)throw Error('pointer-http-'+pointer.status);
  const p=await pointer.json();
  if(!Number.isInteger(p.epoch)||p.epoch<1||typeof p.sha256!=='string'||
     !/^[0-9a-f]{64}$/.test(p.sha256)||p.url!=='/assets/'+p.sha256+'.js')throw Error('invalid-pointer');
  if(accepted&&p.epoch<accepted.epoch)throw Error('stale-pointer');
  const asset=await fetch(base+p.url,{cache:'no-store'});
  if(!asset.ok)throw Error('asset-http-'+asset.status);
  const bytes=Buffer.from(await asset.arrayBuffer());
  if(hash(bytes)!==p.sha256)throw Error('integrity');
  const sandbox=vm.createContext({});
  vm.runInContext(bytes.toString('utf8'),sandbox,{timeout:2500});
  const app=sandbox.JscRuntime.require('app');
  if(app.version!==p.version||app.epoch!==p.epoch)throw Error('version-mismatch');
  accepted={version:app.version,epoch:app.epoch};
  return {ok:true,version:accepted.version};
 }catch(e){return {ok:false,error:e.message};}
}
try{
 for(const node of nodes){
  servers.push(await start((req,res)=>{
   const u=new URL(req.url,'http://node.invalid'),p=u.pathname;
   if(p==='/release.json'){
    const meta=release(node),etag='"'+meta.sha256+'"';
    res.setHeader('Cache-Control','no-cache');res.setHeader('ETag',etag);
    if(req.headers['if-none-match']===etag){originPointer304++;res.statusCode=304;res.end();return;}
    originPointer200++;res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(meta));return;
   }
   const asset=node.assets.get(p);
   if(asset){res.setHeader('Cache-Control','public,max-age=31536000,immutable');res.end(asset);return;}
   res.statusCode=404;res.end('not staged');
  }));
 }
 const origins=servers.map(s=>'http://127.0.0.1:'+s.address().port);
 // The intermediary deliberately imposes a stale TTL over a no-cache pointer.
 // Its behaviour is observable, including the subsequent correct ETag revalidation.
 const edge=await start(async(req,res)=>{
  try{
   const path=new URL(req.url,'http://edge.invalid').pathname;
   if(path==='/release.json'){
    if(cache&&logicalSecond<cache.expires){
     edgeCacheHits++;res.setHeader('X-Edge-Status','stale-hit');
     res.setHeader('Content-Type','application/json');res.end(cache.body);return;
    }
    edgeRevalidations++;
    const headers=cache?{'If-None-Match':cache.etag}:{};
    const response=await fetch(origins[pointerNode]+path,{headers,cache:'no-store'});
    if(response.status===304&&cache){
     cache.expires=logicalSecond+ttl;
     res.setHeader('X-Edge-Status','revalidated-304');
     res.setHeader('Content-Type','application/json');res.end(cache.body);return;
    }
    if(!response.ok){res.statusCode=response.status;res.end();return;}
    const body=Buffer.from(await response.arrayBuffer());
    cache={body,etag:response.headers.get('etag'),expires:logicalSecond+ttl};
    res.setHeader('X-Edge-Status','refreshed-200');
    res.setHeader('Content-Type','application/json');res.end(body);return;
   }
   const response=await fetch(origins[assetNode]+req.url,{cache:'no-store'});
   res.statusCode=response.status;
   res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.statusCode=502;res.end(e.message);}
 });
 servers.push(edge);
 const base='http://127.0.0.1:'+edge.address().port;
 assert.deepEqual(await accept(base),{ok:true,version:'v1'});
 // Refresh while version unchanged triggers real HTTP 304 and keeps the cached entity.
 logicalSecond=31;
 assert.deepEqual(await accept(base),{ok:true,version:'v1'});
 assert.equal(originPointer304,1);
 // Publisher updates B. Edge still returns an expired-in-reality v1 pointer for 30 logical seconds.
 nodes[1].version='v2';pointerNode=1;logicalSecond=32;
 assert.deepEqual(await accept(base),{ok:true,version:'v1'});
 assert.equal(accepted.version,'v1');
 assert.ok(edgeCacheHits>=1);
 // After cache TTL, v2 pointer is visible, but a stale asset node remains on v1.
 logicalSecond=62;assetNode=0;
 assert.deepEqual(await accept(base),{ok:false,error:'asset-http-404'});
 assert.equal(accepted.version,'v1');
 // Stage the immutable v2 asset on A. No pointer refresh is needed to retrieve it.
 nodes[0].assets.set(v2.url,v2.body);
 assert.deepEqual(await accept(base),{ok:true,version:'v2'});
 // A stale v1 pointer after a successful v2 confirmation must not silently downgrade.
 pointerNode=0;logicalSecond=93;
 assert.deepEqual(await accept(base),{ok:false,error:'stale-pointer'});
 assert.equal(accepted.version,'v2');
 assert.ok(originPointer200>=3&&originPointer304===1);
 assert.ok(edgeRevalidations>=4);
 console.log('PASS CACHE EDGE: 2 origin HTTP servers, real ETag 304, delayed pointer TTL, missing new asset and stale downgrade fail closed; '+JSON.stringify({originPointer200,originPointer304,edgeCacheHits,edgeRevalidations}));
}finally{
 await Promise.all(servers.reverse().map(s=>new Promise(done=>s.close(done))));
 await rm(dir,{recursive:true,force:true});
}
