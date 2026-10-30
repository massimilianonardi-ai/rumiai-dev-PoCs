'use strict';
// Localize first-party IMG URLs beginning with / on the public ChatGPT share.
// Such URLs may not have a saved network-response body when Chrome used cache.
// Fetch only the exact same-origin URL and require verified image bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const origin='https://chatgpt.com';
const maxImageBytes=12*1024*1024;
const formats={
  'image/png':{ext:'png',check:b=>b.subarray(0,8).equals(
    Buffer.from([137,80,78,71,13,10,26,10]))},
  'image/jpeg':{ext:'jpg',check:b=>b.length>3 &&
    b[0]===255&&b[1]===216&&b[2]===255},
  'image/webp':{ext:'webp',check:b=>b.toString('ascii',0,4)==='RIFF' &&
    b.toString('ascii',8,12)==='WEBP'},
  'image/gif':{ext:'gif',check:b=>['GIF87a','GIF89a']
    .includes(b.toString('ascii',0,6))}
};

function firstPartyUrl(value)
{
  if(!value.startsWith('/') || value.startsWith('//'))return null;
  if(value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value))
    throw Error('Unsafe root-relative image reference');
  const url=new URL(value.replace(/&amp;/gu,'&'),origin);
  if(url.origin!==origin || url.username || url.password || url.hash)
    throw Error('Image reference escaped the original ChatGPT origin');
  return url.href;
}

function sourceImageTags(html)
{
  const images=[];
  for(const match of html.matchAll(/<img(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/giu))
  {
    const tag=match[0];
    const src=/(\s+src\s*=\s*)(["'])([\s\S]*?)\2/iu.exec(tag);
    if(!src)continue;
    const url=firstPartyUrl(src[3]);
    if(url)images.push({start:match.index,end:match.index+tag.length,
      tag,url});
  }
  if(images.length>40)
    throw Error('Too many first-party images to localize safely');
  return images;
}

async function verifiedImage(url,fetcher)
{
  const response=await fetcher(url,{
    redirect:'error',signal:AbortSignal.timeout(20000)
  });
  if(!response.ok || response.redirected ||
     (response.url && response.url!==url))
    throw Error('Exact first-party image URL was not retrievable');
  const mime=(response.headers.get('content-type')||'')
    .split(';',1)[0].trim().toLowerCase();
  const format=formats[mime];
  if(!format)throw Error('First-party image returned unsupported MIME type');
  const length=Number(response.headers.get('content-length'));
  if(length>maxImageBytes)
    throw Error('First-party image exceeds size limit');
  if(!response.body)throw Error('First-party image response has no body');
  const chunks=[];
  let bytes=0;
  const reader=response.body.getReader();
  try
  {
    for(;;)
    {
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value.byteLength;
      if(bytes>maxImageBytes)
        throw Error('First-party image exceeds size limit');
      chunks.push(Buffer.from(part.value));
    }
  }
  catch(error)
  {
    await reader.cancel().catch(()=>{});
    throw error;
  }
  const data=Buffer.concat(chunks);
  if(data.length<12 || !format.check(data))
    throw Error('First-party image signature mismatch');
  const digest=crypto.createHash('sha256').update(data).digest('hex');
  return {data,filename:'poc068-first-party-'+digest+'.'+format.ext};
}

export async function localizeFirstPartyImages(archive,{fetcher=fetch}={})
{
  const file=path.join(archive,'index.html');
  const html=fs.readFileSync(file,'utf8');
  if(!html.includes("script-src 'none'"))
    throw Error('First-party image localization requires inert HTML');
  const images=sourceImageTags(html);
  if(!images.length)return {localized:0,assets:0};
  const byUrl=new Map(),assets=new Map();
  let totalBytes=0;
  for(const item of images)
  {
    if(byUrl.has(item.url))continue;
    const asset=await verifiedImage(item.url,fetcher);
    if(!assets.has(asset.filename))
    {
      totalBytes+=asset.data.length;
      if(totalBytes>32*1024*1024)
        throw Error('First-party images exceed archive size limit');
      assets.set(asset.filename,asset.data);
    }
    byUrl.set(item.url,asset.filename);
  }
  let updated=html;
  for(const item of [...images].reverse())
  {
    let tag=item.tag.replace(/(\s+src\s*=\s*)(["'])([\s\S]*?)\2/iu,
      (_whole,prefix,quote)=>prefix+quote+
        './assets/'+byUrl.get(item.url)+quote);
    // An original responsive URL must not override the verified local body.
    tag=tag.replace(/\s+srcset\s*=\s*(?:["'][\s\S]*?["']|[^\s>]+)/giu,'');
    updated=updated.slice(0,item.start)+tag+updated.slice(item.end);
  }
  const assetDir=path.join(archive,'assets');
  fs.mkdirSync(assetDir,{recursive:true,mode:0o700});
  for(const [name,data] of assets)
    fs.writeFileSync(path.join(assetDir,name),data,{flag:'wx',mode:0o600});
  fs.writeFileSync(file,updated,{mode:0o600});
  return {localized:images.length,assets:assets.size};
}
