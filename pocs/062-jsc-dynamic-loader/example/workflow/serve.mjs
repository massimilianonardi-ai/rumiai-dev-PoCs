// Static localhost preview for the consumer demo, not a runtime supervisor.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('./dist/',import.meta.url));
const port=process.argv[2]===undefined?8787:Number(process.argv[2]);
if(process.argv.length>3||!Number.isInteger(port)||port<0||port>65535){
 console.error('usage: node example/workflow/serve.mjs [port]');
 process.exit(2);
}
const allowed=new Set(['dev.html','release.html','loader.js','initial.js','optional.js',
 'patch.js','bundle-all.js','client.js']);
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const name=pathname==='/'?'dev.html':pathname.slice(1);
 res.setHeader('Cache-Control','no-store'); // development preview, NOT release caching policy
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'");
 if(req.method!=='GET'||!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
 try{
  const bytes=await readFile(join(root,name));
  res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
  res.end(bytes);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500);res.end(e.code==='ENOENT'?'Build the demo first':'Preview failed');}
});
server.listen(port,'127.0.0.1',()=>{
 const address=server.address();
 console.log('jsc workflow preview: http://127.0.0.1:'+address.port+'/dev.html');
 console.log('jsc single-bundle view: http://127.0.0.1:'+address.port+'/release.html');
});
