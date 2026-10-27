'use strict';
// Rebuild a private, script-free linked archive with *only* exact URL-matched,
// SHA-verified image bodies from existing private CDP captures. No networking.
import fs from 'node:fs';
import path from 'node:path';
import {captureImageIndex} from './inspect-offline-control-provenance.mjs';

const types={
  png:{mime:'image/png',signature:data=>data.subarray(0,8).equals(
    Buffer.from([137,80,78,71,13,10,26,10]))},
  jpg:{mime:'image/jpeg',signature:data=>
    data.length>=3 && data[0]===255&&data[1]===216&&data[2]===255},
  webp:{mime:'image/webp',signature:data=>
    data.toString('ascii',0,4)==='RIFF' &&
    data.toString('ascii',8,12)==='WEBP'},
  gif:{mime:'image/gif',signature:data=>
    ['GIF87a','GIF89a'].includes(data.toString('ascii',0,6))}
};
function normalizedHttps(value)
{
  if(typeof value!=='string'||value.length>4096)return null;
  try{
    const url=new URL(value.replace(/&amp;/g,'&'));
    if(url.protocol!=='https:'||url.username||url.password)return null;
    url.hash='';
    return url.href;
  }catch{return null;}
}
function captureHtmlImages(html)
{
  const found=[];
  const re=/<img(?=[\s/>])/gi;
  for(const match of html.matchAll(re))
  {
    const start=match.index;
    let quote=null,end=-1;
    for(let pos=start+4;pos<html.length;pos++)
    {
      const char=html[pos];
      if(quote){if(char===quote)quote=null;}
      else if(char==='"'||char==="'")quote=char;
      else if(char==='>'){end=pos+1;break;}
    }
    if(end<0||quote)throw Error('Malformed IMG markup');
    const source=html.slice(start,end);
    const attr=/\s+src\s*=\s*(["'])([\s\S]*?)\1/i.exec(source);
    if(!attr)continue;
    const url=normalizedHttps(attr[2]);
    if(url)found.push({start,end,source,url});
  }
  return found;
}
function assertPrivateTree(root)
{
  let count=0,bytes=0;
  const scan=(folder)=>{
    for(const entry of fs.readdirSync(folder,{withFileTypes:true}))
    {
      const item=path.join(folder,entry.name);
      const stat=fs.lstatSync(item);
      if(stat.isSymbolicLink())throw Error('Symbolic link in original archive');
      if(stat.isDirectory())scan(item);
      else if(stat.isFile()){
        count++;bytes+=stat.size;
        if(count>30000||bytes>1024*1024*1024)
          throw Error('Offline archive copy exceeds bounded limit');
      }
      else throw Error('Unsupported file in original archive');
    }
  };
  scan(root);
}
function copyPrivateTree(source,target)
{
  fs.mkdirSync(target,{recursive:true,mode:0o700});
  for(const entry of fs.readdirSync(source,{withFileTypes:true}))
  {
    const original=path.join(source,entry.name);
    const copied=path.join(target,entry.name);
    if(entry.isDirectory())copyPrivateTree(original,copied);
    else if(entry.isFile()){
      fs.copyFileSync(original,copied,fs.constants.COPYFILE_EXCL);
      fs.chmodSync(copied,0o600);
    }
    else throw Error('Unsupported original archive entry');
  }
}
function validImageBody(info)
{
  const format=types[info.extension];
  if(!format||format.mime!==info.mimeType)
    throw Error('Captured image file has unsupported format');
  const data=fs.readFileSync(info.file);
  if(data.length<12||data.length>12*1024*1024||
     !format.signature(data))
    throw Error('Captured image signature mismatch');
  return data;
}
export function localizeExactCapturedImages(linkedDir,newDir,captureDirs)
{
  if(!Array.isArray(captureDirs)||!captureDirs.length)
    throw Error('Private capture evidence required');
  const source=path.resolve(linkedDir),output=path.resolve(newDir);
  if(output===source || output.startsWith(source+path.sep) ||
     source.startsWith(output+path.sep) || fs.existsSync(output))
    throw Error('New output must be separate from existing archive');
  if(!fs.existsSync(path.dirname(output)))
    throw Error('New output parent does not exist');
  const inputHtml=fs.readFileSync(path.join(source,'index.html'),'utf8');
  if(!inputHtml.includes("script-src 'none'")||
     !inputHtml.includes('id="cumulative-turns"'))
    throw Error('Expected inert original linked archive');
  if(inputHtml.includes('poc068-exact-image-assets'))
    throw Error('Archive already contains exact image localization marker');
  const index=captureImageIndex(captureDirs);
  const images=captureHtmlImages(inputHtml);
  if(!images.length)throw Error('No remote IMG references in source archive');
  if(index.conflicts)
    throw Error('Conflicting or invalid saved image evidence');
  const prepared=new Map(),replacements=[];
  for(const item of images)
  {
    const digest=index.byUrl.get(item.url);
    if(!digest)throw Error('Unmatched remote image reference in archive');
    const info=index.filesByDigest.get(digest);
    if(!info)throw Error('Missing verified captured image body');
    if(!prepared.has(digest))prepared.set(digest,{
      filename:'poc068-exact-'+digest+'.'+info.extension,
      bytes:validImageBody(info)
    });
    const saved=prepared.get(digest);
    const value='./assets/'+saved.filename;
    let revised=item.source.replace(
      /(\s+src\s*=\s*)(["'])([\s\S]*?)\2/i,
      (_whole,prefix,quote)=>prefix+quote+value+quote);
    // A browser may prefer remote srcset over verified local src. Do not
    // allow unverified remote responsive variants to override the asset.
    revised=revised.replace(/\s+srcset\s*=\s*(?:(["'])[\s\S]*?\1|[^\s>]+)/gi,'');
    replacements.push({start:item.start,end:item.end,next:revised});
  }
  let html=inputHtml;
  for(const item of replacements.reverse())
    html=html.slice(0,item.start)+item.next+html.slice(item.end);
  // The CSP already permits same-origin images; leave it byte-identical.
  const marker='<!-- poc068-exact-image-assets: local-only, verified -->';
  if(!html.includes('</head>'))throw Error('Offline document head unavailable');
  html=html.replace('</head>',marker+'</head>');
  assertPrivateTree(source);
  const stage=fs.mkdtempSync(path.join(path.dirname(output),'.poc068-exact-img-'));
  let published=false;
  try
  {
    copyPrivateTree(source,stage);
    const assetDir=path.join(stage,'assets');
    fs.mkdirSync(assetDir,{recursive:true,mode:0o700});
    for(const asset of prepared.values())
      fs.writeFileSync(path.join(assetDir,asset.filename),asset.bytes,
        {flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(stage,'index.html'),html,{mode:0o600});
    fs.renameSync(stage,output);
    published=true;
  }
  finally{if(!published)fs.rmSync(stage,{recursive:true,force:true});}
  return {status:'exact-private-image-localization',
    imageReferencesLocalized:images.length,
    uniqueVerifiedImageAssets:prepared.size,
    imageEvidenceConflicts:0,
    originalCspPreserved:true,
    originalArchivePreserved:true,
    sourceDisclosuresUnchanged:true,
    limitations:[
      'The 19 newly generated source menu anchors still lack favicon elements',
      'Original standalone Fonti and single-citation controls remain React-only',
      'No external image was downloaded or attributed to unrelated links',
      'Actual icon visibility requires a physical offline Chromium check'
    ]};
}
if(process.argv[1]&&path.resolve(process.argv[1])===
   path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length<5)
  {
    console.error('Usage: node localize-exact-captured-images.mjs <linked-output-dir> <new-private-output-dir> <private-capture-dir>...');
    process.exitCode=2;
  }
  else
  {
    try{
      console.log(JSON.stringify(localizeExactCapturedImages(
        process.argv[2],process.argv[3],process.argv.slice(4)),null,2));
    }
    catch{
      console.error('Exact captured-image localization failed');
      process.exitCode=1;
    }
  }
}
