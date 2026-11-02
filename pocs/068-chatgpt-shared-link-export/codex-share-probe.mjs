#!/usr/bin/env node
'use strict';
// Read-only, privacy-safe structural probe for a public Codex thread snapshot.
// Does not publish HTML, infer missing messages, or change the ChatGPT exporter.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';

export function validatedCodexShareUrl(value)
{
  if(typeof value!=='string' || value.length>2048)
    throw Error('A Codex shared snapshot URL is required');
  let url;
  try {url=new URL(value);}
  catch {throw Error('Invalid Codex shared snapshot URL');}
  if(url.protocol!=='https:' || url.hostname!=='chatgpt.com' ||
     url.port || url.username || url.password || url.search || url.hash ||
     !/^\/s\/cx_[a-f0-9]{32}$/iu.test(url.pathname))
    throw Error('Expected https://chatgpt.com/s/cx_<32-hex-id>');
  return url.href;
}

export function inspectCodexShareHtml(html)
{
  if(typeof html!=='string' || html.length>32*1024*1024)
    throw Error('Captured HTML must be text under 32 MiB');
  const {document}=parseHTML(html);
  const text=(document.querySelector('title')?.textContent||'').trim();
  const heading=(document.querySelector('h1')?.textContent||'').trim();
  const guardText=(text+' '+heading).toLowerCase();
  const challenge=html.includes('cf-chl') ||
    html.includes('challenges.cloudflare.com') ||
    /just a moment/i.test(guardText);
  const accessDenied=/access denied|403 forbidden/i.test(guardText);
  const signIn=/^(sign in|log in)(?:\s|$)/i.test(guardText);
  const browserError=html.includes('chrome-error://') ||
    html.includes('chromewebdata');
  const main=document.querySelector('main');
  const count=selector=>document.querySelectorAll(selector).length;
  const contentLength=(main?.textContent||'').trim().length;
  const attrs=new Map();
  for(const node of document.querySelectorAll('main *,article *'))
  {
    for(const attribute of node.getAttributeNames?.()||[])
    {
      if(/^data-[a-z0-9-]{1,56}$/u.test(attribute))
        attrs.set(attribute,(attrs.get(attribute)||0)+1);
    }
  }
  const reasons=[];
  if(challenge)reasons.push('cloudflare-challenge');
  if(accessDenied)reasons.push('access-denied');
  if(signIn)reasons.push('sign-in-required');
  if(browserError)reasons.push('browser-navigation-error');
  if(!main)reasons.push('no-main-element');
  if(contentLength<200)reasons.push('no-substantial-visible-content');
  const metaKeys=[...new Set([...document.querySelectorAll(
    'meta[name],meta[property]')].map(m=>
    m.getAttribute('name')||m.getAttribute('property')).filter(
    key=>key&&/^[a-z0-9:._-]{1,65}$/iu.test(key)))].sort();
  return {
    status:reasons.length?'not-captured':'rendered-candidate-unverified',
    reasons,
    // Counts and attribute names only. Never output content, IDs or links.
    titlePresent:text.length>0,
    titleLength:text.length,
    originalTitleVerified:false,
    firstMessageDateVerified:false,
    completenessVerified:false,
    counts:{main:count('main'),article:count('article'),
      heading:count('h1,h2,h3'),paragraph:count('p'),
      code:count('code'),pre:count('pre'),time:count('time'),
      datetime:count('[datetime]'),turn:count('[data-turn-id-container]'),
      message:count('[data-message-id]'),testid:count('[data-testid]'),
      image:count('img'),stylesheet:count('link[rel="stylesheet"]')},
    visibleMainCharacters:contentLength,
    metadataKeys:metaKeys.slice(0,40),
    dataAttributes:[...attrs.entries()]
      .sort((a,b)=>b[1]-a[1]).slice(0,32)
  };
}

function browserExecutable()
{
  if(process.env.CODEX_CHROME_BIN)return process.env.CODEX_CHROME_BIN;
  for(const candidate of ['chromium','google-chrome','chromium-browser'])
  {
    const result=spawnSync('which',[candidate],{encoding:'utf8'});
    if(result.status===0 && result.stdout.trim())
      return result.stdout.trim();
  }
  throw Error('Chromium/Chrome not found; set CODEX_CHROME_BIN');
}

export function probeCodexShare(urlInput,{browser=browserExecutable()}={})
{
  const url=validatedCodexShareUrl(urlInput);
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-codex-profile-'));
  fs.chmodSync(profile,0o700);
  try
  {
    const result=spawnSync(browser,[
      '--headless=new','--no-sandbox','--disable-dev-shm-usage',
      '--disable-extensions','--disable-gpu',
      '--user-data-dir='+profile,'--virtual-time-budget=18000',
      '--dump-dom',url],{
      encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024
    });
    if(result.error || result.status!==0)
      throw Error('Chromium navigation failed; status='+
        (result.status??'unknown')+
        (result.error?.code?' '+result.error.code:''));
    return inspectCodexShareHtml(result.stdout);
  }
  finally {fs.rmSync(profile,{recursive:true,force:true});}
}

const invoked=process.argv[1]&&
  path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(invoked)
{
  if(process.argv.length!==3 || ['--help','-h'].includes(process.argv[2]))
  {
    console.error('Usage: node codex-share-probe.mjs https://chatgpt.com/s/cx_<32-hex-id>');
    process.exitCode=process.argv[2]==='--help'?0:2;
  }
  else
  {
    try
    {
      const report=probeCodexShare(process.argv[2]);
      console.log(JSON.stringify(report,null,2));
      if(report.status==='not-captured')process.exitCode=3;
    }
    catch(error){console.error('Codex structural probe: '+error.message);process.exitCode=1;}
  }
}
