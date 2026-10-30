'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {recoverGoogleFavicons} from '../recover-google-favicons.mjs';
import {captureImageIndex} from '../inspect-offline-control-provenance.mjs';
import {localizeExactCapturedImages}
  from '../localize-exact-captured-images.mjs';

const google='https://www.google.com/s2/favicons?domain=example.com&sz=32';
const png=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9r3FEAAAAASUVORK5CYII=',
  'base64');
async function fixture(html,work)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-google-test-'));
  const styled=path.join(root,'styled'),capture=path.join(root,'capture');
  const recovered=path.join(root,'recovered'),output=path.join(root,'output');
  fs.mkdirSync(styled);fs.mkdirSync(capture);
  fs.writeFileSync(path.join(capture,'events.jsonl'),'');
  fs.writeFileSync(path.join(styled,'index.html'),
    '<html><head><meta content="script-src \u0027none\u0027"></head>'+
    '<body><div id="cumulative-turns">'+html+'</div></body></html>');
  try{return await work({root,styled,capture,recovered,output});}
  finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('real exact Google favicon bytes become SHA-verified archive evidence',async()=>
 fixture('<img src="'+google.replace('&','&amp;')+'">',async ctx=>{
   const requests=[];
   const fetched=async(url,options)=>{
     requests.push({url,redirect:options.redirect});
     return new Response(png,{headers:{'content-type':'image/png'}});
   };
   const result=await recoverGoogleFavicons(ctx.styled,[ctx.capture],
     ctx.recovered,{fetcher:fetched});
   assert.equal(result.recoveredUrls,1);
   assert.deepEqual(requests,[{url:google,redirect:'manual'}]);
   const index=captureImageIndex([ctx.recovered]);
   assert.equal(index.byUrl.has(google),true);
   assert.equal(index.verifiedBodies,1);
   const report=localizeExactCapturedImages(ctx.styled,ctx.output,
     [ctx.capture,ctx.recovered]);
   assert.equal(report.imageReferencesLocalized,1);
   const built=fs.readFileSync(path.join(ctx.output,'index.html'),'utf8');
   assert.doesNotMatch(built,/src="https:/);
   assert.match(built,/poc068-exact-/);
 }));
test('allowed Google redirect records the actual response URL as evidence',async()=>
 fixture('<img src="'+google+'">',async ctx=>{
   const target='https://t1.gstatic.com/faviconV2?url=example.com&size=32';
   const visited=[];
   await recoverGoogleFavicons(ctx.styled,[ctx.capture],ctx.recovered,{
     fetcher:async url=>{
       visited.push(url);
       if(url===google)
         return new Response(null,{status:302,headers:{location:target}});
       return new Response(png,{headers:{'content-type':'image/png'}});
     }
   });
   assert.deepEqual(visited,[google,target]);
   const index=captureImageIndex([ctx.recovered]);
   assert.equal(index.byUrl.has(google),true);
   assert.equal(index.byUrl.has(target),true);
   const events=fs.readFileSync(path.join(ctx.recovered,'events.jsonl'),'utf8')
     .split('\n').filter(Boolean).map(JSON.parse);
   assert.equal(events[0].responseUrl,target);
   assert.equal(events[0].source,'direct-verified-https');
 }));

test('Google favicon redirect may reach only known Google favicon endpoint',async()=>
 fixture('<img src="'+google+'">',async ctx=>{
   await assert.rejects(recoverGoogleFavicons(ctx.styled,[ctx.capture],
     ctx.recovered,{fetcher:async()=>new Response(null,{status:302,
       headers:{location:'https://untrusted.example/favicon.png'}})}),
     /outside approved image endpoints/);
   assert.equal(fs.existsSync(ctx.recovered),false);
 }));
test('untrusted external image never triggers network recovery',async()=>
 fixture('<img src="https://untrusted.example/image.png">',async ctx=>{
   await assert.rejects(recoverGoogleFavicons(ctx.styled,[ctx.capture],
     ctx.recovered,{fetcher:async()=>{throw Error('network must not run');}}),
     /non-Google/);
   assert.equal(fs.existsSync(ctx.recovered),false);
 }));
test('bad image body or unsuccessful response cannot publish evidence',async()=>
 fixture('<img src="'+google+'">',async ctx=>{
   await assert.rejects(recoverGoogleFavicons(ctx.styled,[ctx.capture],
     ctx.recovered,{fetcher:async()=>new Response('invalid',{
       headers:{'content-type':'image/png'}})}),/signature/);
   assert.equal(fs.existsSync(ctx.recovered),false);
   await assert.rejects(recoverGoogleFavicons(ctx.styled,[ctx.capture],
     ctx.recovered,{fetcher:async()=>new Response('missing',{status:404})}),
     /returned HTTP 404/);
   assert.equal(fs.existsSync(ctx.recovered),false);
 }));
