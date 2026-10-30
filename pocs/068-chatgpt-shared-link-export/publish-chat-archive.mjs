#!/usr/bin/env node
'use strict';
// GitHub publication adapter for the accepted PoC 068 offline export.
// It never edits the exported HTML or uses the generic offline page title.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';
import {exportOfflineShare,validatedShareUrl} from './export-offline.mjs';
import {readCapturedChatMetadata} from './share-metadata.mjs';

const file=fileURLToPath(import.meta.url);

export function safeTopic(input)
{
  if(typeof input!=='string' || !input || input!==input.trim() ||
     input.length>80 || input==='.' || input==='..' ||
     input.startsWith('.') || /[/\\\u0000-\u001f\u007f]/u.test(input))
    throw Error('Topic must be a safe single directory name');
  return input;
}

export function chatDirectoryName(metadata)
{
  if(!metadata || !/^\d{4}-\d{2}-\d{2}$/u.test(metadata.date))
    throw Error('Verified original chat date is required');
  if(typeof metadata.title!=='string')
    throw Error('Verified original chat title is required');
  const title=metadata.title.normalize('NFC')
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/gu,'-')
    .replace(/\s+/gu,' ').replace(/[. ]+$/gu,'').trim();
  if(!title || title==='.' || title==='..' || title.length>140 ||
     title.startsWith('.'))
    throw Error('Original chat title cannot be a safe directory name');
  return metadata.date+' '+title;
}

function verifyLocalResources(archive)
{
  const home=path.resolve(archive);
  const htmlFile=path.join(home,'index.html');
  if(!fs.statSync(htmlFile).isFile())
    throw Error('Offline export does not have an index.html');
  const html=fs.readFileSync(htmlFile,'utf8');
  if(!html.includes("script-src 'none'"))
    throw Error('Offline archive does not disable scripts');

  const visited=[];
  let bytes=0;
  function checkTree(directory)
  {
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}))
    {
      const filename=path.join(directory,entry.name);
      const stat=fs.lstatSync(filename);
      if(stat.isSymbolicLink() || !(stat.isFile()||stat.isDirectory()))
        throw Error('Archive contains an unsupported filesystem entry');
      if(stat.isDirectory())checkTree(filename);
      else
      {
        if(stat.size>32*1024*1024)throw Error('Archive file exceeds size limit');
        bytes+=stat.size;
        if(bytes>100*1024*1024)throw Error('Archive exceeds size limit');
        visited.push(filename);
      }
    }
  }
  checkTree(home);
  function localReference(base,reference)
  {
    if(!reference || reference.startsWith('#') || reference.startsWith('data:') ||
       reference.startsWith('about:blank'))return;
    if(/^[a-z][a-z0-9+.-]*:/iu.test(reference) || reference.startsWith('//'))
      throw Error('Archived resource unexpectedly has a remote reference');
    const clean=decodeURIComponent(reference.split(/[?#]/u,1)[0]);
    const target=path.resolve(base,clean);
    if(!target.startsWith(home+path.sep) || !fs.existsSync(target) ||
       !fs.statSync(target).isFile())
      throw Error('Offline archive refers to a missing/outside local resource');
  }
  const {document}=parseHTML(html);
  for(const element of document.querySelectorAll(
    'img[src],source[src],video[poster],link[rel="stylesheet"][href]'))
  {
    const value=element.getAttribute('src') ||
      element.getAttribute('poster') || element.getAttribute('href');
    localReference(home,value);
  }
  for(const filename of visited.filter(name=>name.endsWith('.css')))
  {
    const css=fs.readFileSync(filename,'utf8');
    for(const match of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/giu))
      localReference(path.dirname(filename),match[2]);
  }
  return visited.length;
}

function copyTree(from,to)
{
  for(const entry of fs.readdirSync(from,{withFileTypes:true}))
  {
    const source=path.join(from,entry.name);
    const target=path.join(to,entry.name);
    if(entry.isDirectory())
    {
      fs.mkdirSync(target,{mode:0o700});
      copyTree(source,target);
    }
    else if(entry.isFile())
      fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
    else throw Error('Unsupported archive entry');
  }
}

export async function publishChatArchive(request,repoRoot,
  {exporter=exportOfflineShare,readMetadata=readCapturedChatMetadata}={})
{
  if(!request || typeof request!=='object' || Array.isArray(request) ||
     Object.keys(request).sort().join(',')!=='topic,url')
    throw Error('Expected only url and topic');
  const url=validatedShareUrl(request.url);
  const topic=safeTopic(request.topic);
  const destination=path.resolve(repoRoot);
  if(!fs.statSync(path.join(destination,'.git')).isDirectory())
    throw Error('Target is not a Git checkout');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-publication-'));
  fs.chmodSync(scratch,0o700);
  let stage;
  try
  {
    const exported=path.join(scratch,'archive');
    const result=await exporter(url,exported,{keepEvidence:true});
    if(result.status!=='private-offline-export-created' ||
       !result.originalScriptsDisabled || result.remoteImages!==0 ||
       !result.evidenceDirectory)
      throw Error('Original offline export did not pass provenance checks');
    const metadata=readMetadata(path.join(result.evidenceDirectory,'original'),url);
    const dirname=chatDirectoryName(metadata);
    const parent=path.join(destination,'chats',topic);
    const target=path.join(parent,dirname);
    if(fs.existsSync(target))
      throw Error('This title/date archive already exists; refusing overwrite');
    const count=verifyLocalResources(exported);
    fs.mkdirSync(parent,{recursive:true});
    stage=fs.mkdtempSync(path.join(parent,'.poc068-publication-'));
    copyTree(exported,stage);
    verifyLocalResources(stage);
    // Same-filesystem atomic visibility; Git only sees the final directory.
    fs.renameSync(stage,target);
    stage=null;
    return {status:'ready-to-commit',
      archivePath:path.relative(destination,target).split(path.sep).join('/'),
      date:metadata.date,title:metadata.title,files:count};
  }
  finally
  {
    if(stage)fs.rmSync(stage,{recursive:true,force:true});
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===path.resolve(file))
{
  const [requestFile,repoRoot]=process.argv.slice(2);
  if(!requestFile || !repoRoot || process.argv.length!==4)
  {
    console.error('Usage: publish-chat-archive.mjs <private-request-json> <repository-checkout>');
    process.exitCode=2;
  }
  else
  {
    try
    {
      const request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
      const result=await publishChatArchive(request,repoRoot);
      const out=process.env.POC068_RESULT_FILE;
      if(out)fs.writeFileSync(out,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
      console.log(JSON.stringify({status:result.status,files:result.files}));
    }
    catch(error)
    {
      console.error('Chat publication refused: '+error.message);
      process.exitCode=1;
    }
  }
}
