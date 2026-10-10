// Real-browser smoke/integration test; Node built-ins + installed Chromium only.
// No emulated IndexedDB, and no editor/framework/npm runtime dependency.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,readFileSync,accessSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const allowed=new Map([['.mjs','text/javascript'],['.html','text/html']]);
const browser=process.env.CHROMIUM_BIN||['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].find(x=>{try{accessSync(x);return true;}catch{return false;}});
if(!browser)throw Error('Chromium/Chrome executable missing; set CHROMIUM_BIN');
const server=createServer((req,res)=>{
 const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+'/')||!allowed.has(extname(file))){res.writeHead(404);res.end('not found');return;}
 try{res.setHeader('Content-Type',allowed.get(extname(file)));res.end(readFileSync(file));}
 catch{res.writeHead(404);res.end('not found');}
});
const profile=mkdtempSync(join(tmpdir(),'rumiai-chromium-idb-'));
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();const base='http://127.0.0.1:'+address.port+'/tests/browser-idb.html';
 for(const stage of ['write','reopen','branch','verify']){
  const {stdout}=await exec(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--disable-extensions','--user-data-dir='+profile,'--virtual-time-budget=20000','--dump-dom',base+'?stage='+stage],{maxBuffer:4*1048576,timeout:45000});
  const match=stdout.match(/<pre id="result">([^<]*)<\/pre>/);
  if(!match)throw Error(stage+': no result element: '+stdout.slice(-1000));
  const result=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  assert.equal(result.pass,true,JSON.stringify(result));
  console.log(JSON.stringify(result));
 }
 console.log(JSON.stringify({pass:true,engine:'actual Chromium IndexedDB',stages:4,cleanReopens:3}));
} finally{await new Promise(resolve=>server.close(resolve));rmSync(profile,{recursive:true,force:true});}
