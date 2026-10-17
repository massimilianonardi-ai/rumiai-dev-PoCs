#!/usr/bin/env node
// Read-only localhost preview for evidence under the PoC. Does not copy or
// create artifacts under /run/user, HOME, external directories or portals.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

const mime={
  '.html':'text/html; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.txt':'text/plain; charset=utf-8',
  '.mhtml':'multipart/related',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.webp':'image/webp',
  '.gif':'image/gif',
  '.woff':'font/woff',
  '.woff2':'font/woff2',
  '.ttf':'font/ttf',
  '.otf':'font/otf',
  '.eot':'application/vnd.ms-fontobject'
};

export async function createPreview(folder, port=0) {
  const project=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
  const base=path.join(project,'experiments','evidence');
  const [root,realBase,realProject]=await Promise.all([
    fs.realpath(folder),fs.realpath(base),fs.realpath(project)
  ]);
  if (path.dirname(root)!==realBase ||
      path.relative(realProject,realBase)!==path.join('experiments','evidence'))
    throw new Error('preview.evidence-must-be-in-poc');
  const key=randomBytes(16).toString('hex');
  const prefix='/' + key + '/';
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if (req.method!=='GET' || !url.pathname.startsWith(prefix)) {
        res.writeHead(404);res.end('Not found');return;
      }
      let relative=decodeURIComponent(url.pathname.slice(prefix.length));
      if(!relative || relative.endsWith('/'))relative+='index.html';
      // The old review linked directly to raw page.html (whose stylesheet
      // URLs still point at the original web origin) and to .mhtml, which
      // browsers often download through desktop document portals under
      // /run/user. Route visitors to the derived PoC-local styled preview.
      if (relative.endsWith('/review.html')) {
        const fixed = relative.slice(0, -'review.html'.length) +
          'review-offline.html';
        try {
          await fs.access(path.join(root, fixed));
          res.writeHead(302, {
            'Location': prefix + fixed,
            'Cache-Control': 'no-store'
          });
          res.end();
          return;
        } catch {
          res.writeHead(409, { 'Content-Type':'text/plain; charset=utf-8' });
          res.end('PoC offline view not yet prepared. Run: ' +
            'python3 experiments/prepare-offline-views.py ' +
            './experiments/evidence/<run-name>\n');
          return;
        }
      }
      if (relative.endsWith('/page.html') || relative.endsWith('.mhtml')) {
        res.writeHead(409, { 'Content-Type':'text/plain; charset=utf-8' });
        res.end('Raw HTML/MHTML is immutable evidence in the PoC, ' +
          'not a standalone styled browser preview. ' +
          'Open offline.html through review-offline.html instead.\n');
        return;
      }
      const parts=relative.split('/');
      if(parts.some(p=>p===''||p==='.'||p==='..'||p.startsWith('.'))) {
        res.writeHead(404);res.end('Not found');return;
      }
      const requested=path.join(root,...parts);
      const actual=await fs.realpath(requested);
      if(!actual.startsWith(root+path.sep)) {
        res.writeHead(403);res.end('Forbidden');return;
      }
      const stats=await fs.stat(actual);
      if(!stats.isFile()){res.writeHead(404);res.end('Not found');return;}
      const content=await fs.readFile(actual);
      res.writeHead(200,{
        'Content-Type':mime[path.extname(actual).toLowerCase()]||
          'application/octet-stream',
        'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'none'; " +
          "img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
          "font-src 'self' data:; script-src 'none'; " +
          "connect-src 'none'; form-action 'none'; frame-src 'none';"
      });
      res.end(content);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>server.once('error',reject)
    .listen(port,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port+prefix;
  return {server,origin,root};
}

export async function main(args=process.argv.slice(2)){
  if(args.length!==1){
    process.stderr.write('usage: node experiments/serve-evidence.mjs <PoC-evidence-run-dir>\n');
    return 2;
  }
  let preview;
  try{preview=await createPreview(path.resolve(args[0]));}
  catch(e){process.stderr.write(String(e.message)+'\n');return 1;}
  const lines=[
    ['amazon-wishlist','Amazon Wishlist'],
    ['chatgpt-share','ChatGPT']
  ];
  process.stdout.write('Archivio: '+preview.root+'\n');
  for(const [folder,title] of lines){
    try{
      await fs.access(path.join(preview.root,folder,'review-offline.html'));
      process.stdout.write(title+': '+preview.origin+folder+'/review-offline.html\n');
    }catch{process.stdout.write(title+': review-offline.html non disponibile (prepare-offline-views.py)\n');}
  }
  process.stdout.write('Server locale in sola lettura. CTRL+C per chiudere.\n');
  await new Promise(resolve=>{
    for(const sig of ['SIGINT','SIGTERM'])
      process.once(sig,()=>preview.server.close(resolve));
  });
  return 0;
}

const entry=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===entry)
  process.exitCode=await main();
