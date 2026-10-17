#!/usr/bin/env node
// Read-only local reviewer; only screenshots, comparison, collage and diagnostics.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const pattern=/^\/(amazon-wishlist|chatgpt-share)\/(comparison\.html|collage\.html|states\/[0-9]{4,6}\/(?:original|reopened)\.png|states\/[0-9]{4,6}\/(?:capture|offline)\.json)$/;
const csp="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src 'none'; connect-src 'none';";
const response=(res,status,body,mime='text/plain; charset=utf-8')=>{
  res.writeHead(status,{'Content-Type':mime,'Cache-Control':'no-store',
    'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'});
  res.end(body);
};

export async function startViewer(run){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(run))
    throw Error('view.invalid-run-name');
  const evidence=path.join(root,'evidence');
  const canonical=await fs.realpath(evidence);
  if(canonical!==path.join(await fs.realpath(root),'evidence'))
    throw Error('view.evidence-outside-poc');
  const base=await fs.realpath(path.join(canonical,run));
  if(path.dirname(base)!==canonical)
    throw Error('view.run-outside-poc');
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='GET')return response(res,405,'view.get-only');
    if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||''))
      return response(res,403,'view.bad-host');
    let route;
    try{route=new URL(req.url,'http://127.0.0.1').pathname;}
    catch{return response(res,400,'view.bad-path');}
    if(route==='/'){
      const body='<!doctype html><html lang="it"><meta charset="utf-8">'+
        '<title>PoC 069</title><h1>PoC 069 — '+run+'</h1>'+
        ['amazon-wishlist','chatgpt-share'].map(site=>
          '<p>'+site+': <a href="/'+site+'/comparison.html">Confronto</a> · '+
          '<a href="/'+site+'/collage.html">Collage</a></p>').join('')+
        '<p>Solo immagini e diagnostica, tutto dentro il PoC.</p></html>';
      return response(res,200,body,'text/html; charset=utf-8');
    }
    if(!pattern.test(route))return response(res,404,'view.not-available');
    try{
      const filename=await fs.realpath(path.join(base,route.slice(1)));
      if(!filename.startsWith(base+path.sep))
        return response(res,403,'view.path-outside-poc');
      const data=await fs.readFile(filename);
      const mime=filename.endsWith('.png')?'image/png':
        filename.endsWith('.json')?'application/json; charset=utf-8':
        'text/html; charset=utf-8';
      response(res,200,data,mime);
    }catch{return response(res,404,'view.not-found');}
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {server,url:'http://127.0.0.1:'+server.address().port+'/'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  startViewer(process.argv[2]).then(({url})=>{
    console.log('[VIEW] '+url);
    for(const site of ['amazon-wishlist','chatgpt-share']){
      console.log('[CONFRONTO] '+url+site+'/comparison.html');
      console.log('[COLLAGE] '+url+site+'/collage.html');
    }
    console.log('[VIEW] Ctrl+C per terminare.');
  }).catch(e=>{console.error('[ERRORE] '+e.message);process.exitCode=1;});
}
