'use strict';
// Metadata from the private original Document response of a public ChatGPT share.
// The generated offline HTML intentionally has a generic title; never parse that.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';

const documentFile=/^static\/([a-f0-9]{64})\.html$/;

function flattenedHydration(html)
{
  const chunks=[...html.matchAll(
    /streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/g)]
    .map(match=>JSON.parse(match[1]));
  if(!chunks.length)throw Error('Original share has no serialized conversation');
  const first=chunks.join('').split('\n',1)[0];
  const values=JSON.parse(first);
  if(!Array.isArray(values))throw Error('Invalid original share hydration table');
  return values;
}

function field(values,record,name)
{
  if(!record || typeof record!=='object' || Array.isArray(record))
    return undefined;
  for(const [key,ref] of Object.entries(record))
  {
    if(!/^_\d+$/.test(key))continue;
    if(values[Number(key.slice(1))]===name)
      return values[ref];
  }
  return undefined;
}

export function extractChatMetadata(html,{timeZone='Europe/Rome'}={})
{
  if(typeof html!=='string' || !html.length || html.length>24*1024*1024)
    throw Error('Original share HTML is unavailable or too large');
  const {document}=parseHTML(html);
  const pageTitle=(document.querySelector('title')?.textContent||'').trim();
  // The original share document carries "ChatGPT - <original chat title>".
  // og:title is a generic sharing invitation and must never be used.
  const match=/^ChatGPT\s*[-–]\s*(.+)$/u.exec(pageTitle);
  if(!match)throw Error('Original chat title is absent or unexpected');
  const title=match[1].normalize('NFC').replace(/\s+/gu,' ').trim();
  if(!title || title.length>180 || /^(ChatGPT|OpenAI|Untitled)$/iu.test(title) ||
     /[\u0000-\u001f\u007f]/u.test(title))
    throw Error('Original chat title is not usable');

  const values=flattenedHydration(html);
  const positions=values.flatMap((value,index)=>
    value==='linear_conversation'?[index]:[]);
  if(positions.length!==1 || !Array.isArray(values[positions[0]+1]))
    throw Error('Original message ordering is missing or ambiguous');
  const entries=values[positions[0]+1];
  let firstUser;
  for(const index of entries)
  {
    if(!Number.isInteger(index)||index<0||index>=values.length)
      throw Error('Invalid original message reference');
    const message=field(values,values[index],'message');
    if(!message)continue;
    const role=field(values,field(values,message,'author'),'role');
    if(role!=='user')continue;
    firstUser=field(values,message,'create_time');
    break;
  }
  // ChatGPT uses fractional Unix seconds for original message creation.
  if(typeof firstUser!=='number' || !Number.isFinite(firstUser) ||
     firstUser<1577836800 || firstUser>4102444800)
    throw Error('First user message has no trustworthy creation timestamp');
  const createdAt=new Date(Math.round(firstUser*1000)).toISOString();
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(createdAt));
  const get=type=>parts.find(part=>part.type===type)?.value;
  const date=[get('year'),get('month'),get('day')].join('-');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw Error('Cannot format original message date');
  return {title,createdAt,date};
}

export function readCapturedChatMetadata(directory,expectedUrl)
{
  const base=path.resolve(directory);
  const records=fs.readFileSync(path.join(base,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(JSON.parse)
    .filter(event=>event.kind==='network.static-body' &&
      event.resourceType==='Document' && event.status==='saved' &&
      event.originalUrl===expectedUrl);
  const unique=new Map(records.map(row=>[row.sha256,row]));
  if(unique.size!==1)
    throw Error('Expected one exact original HTML response in private evidence');
  const row=[...unique.values()][0];
  const match=documentFile.exec(row.file||'');
  if(!match || match[1]!==row.sha256 || !Number.isSafeInteger(row.bytes) ||
     row.bytes<=0 || row.bytes>24*1024*1024)
    throw Error('Original HTML evidence metadata is invalid');
  const bytes=fs.readFileSync(path.join(base,row.file));
  const actual=crypto.createHash('sha256').update(bytes).digest('hex');
  if(bytes.length!==row.bytes || actual!==row.sha256)
    throw Error('Original HTML evidence integrity check failed');
  return extractChatMetadata(bytes.toString('utf8'));
}
