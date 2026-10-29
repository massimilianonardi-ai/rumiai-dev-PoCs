'use strict';
// Private script-free singleton-citation restoration. Strictly follows
// witnessed second-click HTTPS intents, without reserializing accepted HTML.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {capturedElementRanges} from './offline-source-controls.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const normalize=value=>String(value||'').normalize('NFKC')
  .replace(/\s+/g,' ').trim();

function safeHttps(value)
{
  if(typeof value!=='string'||value.length>4096)
    throw Error('Invalid private singleton HTTPS evidence');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password)
    throw Error('Invalid private singleton HTTPS evidence');
  return url.href;
}
function readEvents(dir)
{
  return fs.readFileSync(path.join(path.resolve(dir),'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
}
function citationShape(node)
{
  // URL-bearing IMG.src and React-generated classes/IDs are deliberately
  // excluded: original images were SHA-localized in the accepted archive.
  const walk=element=>({
    tag:element.localName,
    label:normalize(element.getAttribute('aria-label')),
    alt:normalize(element.getAttribute('alt')),
    title:normalize(element.getAttribute('title')),
    text:normalize([...element.childNodes].filter(n=>n.nodeType===3)
      .map(n=>n.textContent).join(' ')),
    children:[...element.children].map(walk)
  });
  return hash(JSON.stringify(walk(node)));
}
function parseControl(html)
{
  if(typeof html!=='string'||!html||html.length>65536)
    throw Error('Missing or oversized original singleton control');
  const {document}=parseHTML('<div data-poc068-singleton-root="1">'+
    html+'</div>');
  const wrapper=document.querySelector('[data-poc068-singleton-root]');
  if(!wrapper||wrapper.children.length!==1)throw Error('Invalid original singleton structure');
  return wrapper.firstElementChild;
}
function isSingleton(node)
{
  if(node.localName!=='span'||!node.hasAttribute('aria-haspopup')||
     node.querySelector('[aria-haspopup]')||!node.querySelector('img')||
     node.closest('a,button,details'))return false;
  return ![...node.querySelectorAll('span')].some(el=>
    !el.children.length && /^\+\d+$/.test(normalize(el.textContent)));
}
function ordinalOf(node)
{
  const turn=node.closest('[data-turn-id-container]');
  const marker=turn?.querySelector('[data-testid^="conversation-turn-"]')||
    (turn?.matches('[data-testid^="conversation-turn-"]')?turn:null);
  const value=/^conversation-turn-(\d+)$/.exec(
    marker?.getAttribute('data-testid')||'');
  return value?Number(value[1]):null;
}
function controlsInOrder(document)
{
  const counts=new Map();
  return [...document.querySelectorAll('[aria-haspopup]')]
    .filter(isSingleton).map(node=>{
      const ordinal=ordinalOf(node);
      if(!Number.isSafeInteger(ordinal))
        throw Error('Original singleton lacks verified turn identity');
      const index=counts.get(ordinal)||0;
      counts.set(ordinal,index+1);
      return {ordinal,index,key:ordinal+':'+index,node,
        fingerprint:citationShape(node)};
    });
}
function verifiedIntents(previousDir,currentDir)
{
  const previous=readEvents(previousDir).filter(
    x=>x.kind==='interaction.remaining-control-intent'&&
      x.controlKind==='singleton'&&x.status==='dispatched');
  const current=readEvents(currentDir).filter(
    x=>x.kind==='interaction.remaining-control-intent'&&
      x.controlKind==='singleton'&&x.status==='dispatched');
  if(current.length!==8||previous.length!==8)
    throw Error('Incomplete eight singleton captures');
  const oldMap=new Map();
  for(const row of previous)
  {
    const key=row.ordinal+':'+row.index;
    if(oldMap.has(key))throw Error('Ambiguous earlier singleton capture');
    oldMap.set(key,citationShape(parseControl(row.controlHtml)));
  }
  const seen=new Map(),perTurn=new Map();
  for(const row of current)
  {
    const key=row.ordinal+':'+row.index;
    if(seen.has(key)||!oldMap.has(key)||
       row.panelObserved!==true||row.panelButtons!==1||
       row.panelAnchors!==0||row.popupCardStatus!=='dispatched'||
       row.panelTruncated||row.contextTruncated||row.turnTruncated||
       (row.opened||[]).length||(row.anchors||[]).length)
      throw Error('Unverified singleton popup-button intent');
    const destinations=[
      ...(row.popupCardOpened||[]),...(row.popupCardAnchors||[])];
    if(destinations.length!==1)throw Error('Singleton target is missing or ambiguous');
    const fingerprint=citationShape(parseControl(row.controlHtml));
    if(fingerprint!==oldMap.get(key))
      throw Error('Singleton control identity changed across captures');
    seen.set(key,{key,ordinal:row.ordinal,index:row.index,
      fingerprint,url:safeHttps(destinations[0])});
    perTurn.set(row.ordinal,(perTurn.get(row.ordinal)||0)+1);
  }
  if([...perTurn.values()].reduce((a,b)=>a+b,0)!==8 ||
     perTurn.size!==4 || [2,4,6,8].some(o=>
       perTurn.get(o)!==({2:1,4:2,6:3,8:2})[o]))
    throw Error('Unexpected singleton turn/cardinality evidence');
  return seen;
}
function rawSingletonRanges(html)
{
  const matches=[];
  for(const range of capturedElementRanges(html))
  {
    const snippet=html.slice(range.start,range.end);
    const {document}=parseHTML('<div data-poc068-range="1">'+snippet+'</div>');
    const wrapper=document.querySelector('[data-poc068-range]');
    if(wrapper?.children.length!==1)continue;
    const node=wrapper.firstElementChild;
    if(node.localName==='span' && node.hasAttribute('aria-haspopup') &&
       !node.querySelector('[aria-haspopup]')&&node.querySelector('img') &&
       ![...node.querySelectorAll('span')].some(el=>
         !el.children.length&&/^\+\d+$/.test(normalize(el.textContent))))
      matches.push({...range,fingerprint:citationShape(node),
        canonical:node.outerHTML});
  }
  return matches;
}
function escapeAttribute(value)
{
  return String(value).replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}
export function restoreSingletonCitationHtml(html,previousEvents,currentEvents)
{
  if(typeof html!=='string'||!html.includes("script-src 'none'")||
     !html.includes('id="cumulative-turns"'))
    throw Error('Expected accepted inert offline source HTML');
  if(html.includes('poc068-singleton-restored'))
    throw Error('Singleton citations already restored');
  const intents=verifiedIntents(previousEvents,currentEvents);
  const {document}=parseHTML(html);
  const controls=controlsInOrder(document),ranges=rawSingletonRanges(html);
  if(controls.length!==8||ranges.length!==8)
    throw Error('Offline singleton count differs from trusted capture');
  const edits=[];
  for(let i=0;i<controls.length;i++)
  {
    const c=controls[i],r=ranges[i],target=intents.get(c.key);
    if(!target||c.node.outerHTML!==r.canonical||
       c.fingerprint!==r.fingerprint||
       c.fingerprint!==target.fingerprint)
      throw Error('Offline singleton identity mismatch');
    const snippet=html.slice(r.start,r.end);
    // Keep every byte of the source control (including the exact
    // locally saved favicon) and add one outer native link. This avoids
    // linkedom reserializing classes, SVG or existing image attributes.
    const wrapped='<a class="poc068-singleton-restored" '+
      'href="'+escapeAttribute(target.url)+'" rel="noopener noreferrer" '+
      'target="_blank" style="color:inherit;text-decoration:none">'+
      snippet+'</a>';
    edits.push({start:r.start,end:r.end,replacement:wrapped});
  }
  let result=html;
  for(const edit of edits.reverse())
    result=result.slice(0,edit.start)+edit.replacement+result.slice(edit.end);
  return {html:result,restoredSingletons:edits.length,
    sourceTargetsVerified:8,existingMultiSourceDetails:8};
}

function safeTree(root)
{
  let files=0,size=0;
  const walk=dir=>{
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}))
    {
      const full=path.join(dir,entry.name),st=fs.lstatSync(full);
      if(st.isSymbolicLink())throw Error('Private source archive contains symlink');
      if(st.isDirectory())walk(full);
      else if(st.isFile()){
        files++;size+=st.size;
        if(files>30000||size>1024*1024*1024)
          throw Error('Private source archive too large');
      }else throw Error('Unsupported original archive entry');
    }
  };
  walk(root);
}
export function materializeSingletonCitations(sourceDir,newDir,priorDir,currentDir)
{
  const source=path.resolve(sourceDir),output=path.resolve(newDir);
  if(output===source||output.startsWith(source+path.sep)||
     source.startsWith(output+path.sep)||fs.existsSync(output)||
     !fs.existsSync(path.dirname(output)))
    throw Error('New private output must be separate');
  safeTree(source);
  const original=fs.readFileSync(path.join(source,'index.html'),'utf8');
  const {document:baseline}=parseHTML(original);
  const countOriginal=baseline.querySelectorAll('details.poc068-source-details').length;
  const linksOriginal=baseline.querySelectorAll('.poc068-source-links a[href]').length;
  if(countOriginal!==8||linksOriginal!==19)
    throw Error('Accepted multi-link archive baseline missing');
  const restored=restoreSingletonCitationHtml(original,priorDir,currentDir);
  const stage=fs.mkdtempSync(path.join(path.dirname(output),'.poc068-singletons-'));
  let published=false;
  try
  {
    fs.cpSync(source,stage,{recursive:true,force:false,errorOnExist:false,
      filter:item=>!fs.lstatSync(item).isSymbolicLink()});
    fs.writeFileSync(path.join(stage,'index.html'),restored.html,{mode:0o600});
    fs.renameSync(stage,output);
    published=true;
  }
  finally{if(!published)fs.rmSync(stage,{recursive:true,force:true});}
  return {status:'private-singleton-restored',
    restoredSingletons:restored.restoredSingletons,
    existingMultiSourceDetails:countOriginal,
    existingMultiSourceLinks:linksOriginal,
    originalArchiveUnchanged:true,
    originalCspUnchanged:true,
    limitations:[
      'Fonti buttons are not modified by this work unit',
      'Exact original external icons and accepted multi-source UI are preserved',
      'Physical offline link and layout acceptance is pending'
    ]};
}
if(process.argv[1]&&path.resolve(process.argv[1])===
   path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==6){
    console.error('Usage: node restore-singleton-citations.mjs <existing-private-offline-dir> <new-output-dir> <original-remaining-capture> <verified-second-click-capture>');
    process.exitCode=2;
  }else{
    try{
      console.log(JSON.stringify(materializeSingletonCitations(
        process.argv[2],process.argv[3],process.argv[4],process.argv[5]),null,2));
    }catch(error){
      console.error('Singleton offline restoration refused: '+error.message);
      process.exitCode=1;
    }
  }
}
