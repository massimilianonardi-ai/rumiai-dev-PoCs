'use strict';
// Recover only exact missing Google favicon references using independent
// HTTPS responses. Every saved byte is bounded, signature-checked and SHA-256
// verified by captureImageIndex before the original localizer consumes it.
// This is HTTP recovery evidence, not a Chromium CDP capture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {captureImageIndex} from './inspect-offline-control-provenance.mjs';

const maxBytes=2*1024*1024;
const formats={
  'image/png':{ext:'png',valid:b=>b.subarray(0,8).equals(
    Buffer.from([137,80,78,71,13,10,26,10]))},
  'image/jpeg':{ext:'jpg',valid:b=>b.length>=3 &&
    b[0]===255&&b[1]===216&&b[2]===255},
  'image/webp':{ext:'webp',valid:b=>b.toString('ascii',0,4)==='RIFF' &&
    b.toString('ascii',8,12)==='WEBP'},
  'image/gif':{ext:'gif',valid:b=>['GIF87a','GIF89a']
    .includes(b.toString('ascii',0,6))},
  'image/x-icon':{ext:'ico',valid:b=>b.length>=6 &&
    b[0]===0&&b[1]===0&&b[2]===1&&b[3]===0},
  'image/vnd.microsoft.icon':{ext:'ico',valid:b=>b.length>=6 &&
    b[0]===0&&b[1]===0&&b[2]===1&&b[3]===0}
};
function cleanUrl(raw)
{
  if(typeof raw!=='string'||raw.length>4096)return null;
  try
  {
    const url=new URL(raw.replace(/&amp;/gu,'&'));
    if(url.protocol!=='https:'||url.username||url.password)return null;
    url.hash='';
    return url;
  }
  catch{return null;}
}
function isGoogleFavicon(url)
{
  return url.hostname==='www.google.com' &&
    url.pathname==='/s2/favicons';
}
function permittedRedirect(url)
{
  return isGoogleFavicon(url) ||
    (/^t[0-9]\.gstatic\.com$/u.test(url.hostname) &&
     url.pathname==='/faviconV2');
}
async function verifiedGoogleImage(url,fetcher)
{
  let current=url;
  for(let redirect=0;redirect<3;redirect++)
  {
    const response=await fetcher(current.href,{
      redirect:'manual',signal:AbortSignal.timeout(15000),
      headers:{
        'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) '+
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        Accept:'image/png,image/jpeg,image/webp,image/gif,image/x-icon,*/*;q=0.1'
      }
    });
    if([301,302,303,307,308].includes(response.status))
    {
      const location=response.headers.get('location');
      if(!location)throw Error('Google favicon redirect has no target');
      const next=cleanUrl(new URL(location,current).href);
      if(!next||!permittedRedirect(next))
        throw Error('Google favicon redirected outside approved image endpoints');
      current=next;
      continue;
    }
    if(!response.ok)
      throw Error('Exact Google favicon returned HTTP '+response.status);
    if(response.url && response.url!==current.href)
      throw Error('Google favicon response URL changed outside approved redirects');
    const mime=(response.headers.get('content-type')||'')
      .split(';',1)[0].trim().toLowerCase();
    const format=formats[mime];
    if(!format)throw Error('Google favicon returned unsupported image MIME');
    const length=Number(response.headers.get('content-length'));
    if(length>maxBytes||!response.body)
      throw Error('Google favicon body unavailable or too large');
    const reader=response.body.getReader();
    const parts=[];
    let size=0;
    try
    {
      for(;;)
      {
        const part=await reader.read();
        if(part.done)break;
        size+=part.value.byteLength;
        if(size>maxBytes)throw Error('Google favicon exceeds size limit');
        parts.push(Buffer.from(part.value));
      }
    }
    catch(error)
    {
      await reader.cancel().catch(()=>{});
      throw error;
    }
    const bytes=Buffer.concat(parts);
    if(bytes.length<12||!format.valid(bytes))
      throw Error('Google favicon bytes do not match image signature');
    return {bytes,mime,ext:format.ext,finalUrl:current.href,
      httpStatus:response.status};
  }
  throw Error('Google favicon exceeded bounded redirect count');
}

export async function recoverGoogleFavicons(styledDir,captureDirs,outputDir,{fetcher=fetch}={})
{
  if(!Array.isArray(captureDirs)||!captureDirs.length)
    throw Error('Google favicon recovery requires prior browser captures');
  const output=path.resolve(outputDir);
  if(fs.existsSync(output))
    throw Error('Google favicon evidence destination must not exist');
  const html=fs.readFileSync(path.join(styledDir,'index.html'),'utf8');
  if(!html.includes("script-src 'none'"))
    throw Error('Google favicon recovery requires script-blocked HTML');
  const {document}=parseHTML(html);
  const index=captureImageIndex(captureDirs);
  if(index.conflicts)
    throw Error('Conflicting or invalid original image capture evidence');
  const missing=new Set();
  for(const img of document.querySelectorAll('img[src]'))
  {
    const url=cleanUrl(img.getAttribute('src'));
    if(!url||index.byUrl.has(url.href))continue;
    if(!isGoogleFavicon(url))
      throw Error('Unmatched non-Google remote image reference');
    missing.add(url.href);
  }
  if(!missing.size||missing.size>40)
    throw Error('No bounded missing Google favicon set to recover');
  const stage=fs.mkdtempSync(path.join(path.dirname(output),
    '.poc068-google-favicons-'));
  let committed=false;
  try
  {
    fs.mkdirSync(path.join(stage,'images'),{mode:0o700});
    const events=[];
    const bodies=new Map();
    let totalBytes=0,request=0;
    for(const target of missing)
    {
      const url=new URL(target);
      const asset=await verifiedGoogleImage(url,fetcher);
      const digest=crypto.createHash('sha256')
        .update(asset.bytes).digest('hex');
      const filename='images/'+digest+'.'+asset.ext;
      if(!bodies.has(filename))
      {
        totalBytes+=asset.bytes.length;
        if(totalBytes>16*1024*1024)
          throw Error('Recovered Google favicon total exceeds limit');
        fs.writeFileSync(path.join(stage,filename),asset.bytes,
          {flag:'wx',mode:0o600});
        bodies.set(filename,asset.bytes.length);
      }
      const id=String(++request);
      events.push({kind:'network.image-response',
        source:'direct-verified-https',sessionId:'google-favicon-recovery',
        requestId:id,initialUrl:target,requestUrl:target,
        responseUrl:asset.finalUrl,status:asset.httpStatus,
        mimeType:asset.mime});
      events.push({kind:'network.image-body',
        source:'direct-verified-https',sessionId:'google-favicon-recovery',
        requestId:id,status:'saved',file:filename,
        sha256:digest,bytes:asset.bytes.length,mimeType:asset.mime});
    }
    fs.writeFileSync(path.join(stage,'events.jsonl'),
      events.map(JSON.stringify).join('\n')+'\n',{flag:'wx',mode:0o600});
    const verified=captureImageIndex([stage]);
    if(verified.conflicts || verified.verifiedBodies!==missing.size ||
       [...missing].some(url=>!verified.byUrl.has(url)))
      throw Error('Recovered Google icon evidence failed SHA verification');
    fs.renameSync(stage,output);
    committed=true;
    return {status:'verified-google-favicon-recovery',
      recoveredUrls:missing.size,files:bodies.size};
  }
  finally
  {
    if(!committed)fs.rmSync(stage,{recursive:true,force:true});
  }
}
