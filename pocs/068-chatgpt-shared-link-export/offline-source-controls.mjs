'use strict';
// Native, script-free reconstruction of source disclosures from verified,
// private card-to-HTTPS evidence. Original non-source markup stays untouched.
import {parseHTML} from 'linkedom';
import {sourceGroupSignatures} from './inspect-source-group-identity.mjs';

const escape=value=>String(value).replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const sourceLeaf=node=>!node.children.length && /^\+\d+$/.test(
  (node.textContent||'').trim());

export const sourceDisclosureCss=[
  // Do not restyle normal assistant text or the original writing editor.
  '.poc068-source-details{display:inline-block;position:relative;vertical-align:middle}',
  '.poc068-source-details>summary{list-style:none;cursor:pointer}',
  '.poc068-source-details>summary::-webkit-details-marker{display:none}',
  '.poc068-source-details>summary:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
  '.poc068-source-details>.poc068-source-links{position:absolute;z-index:30;top:100%;left:0;min-width:14rem;max-width:min(26rem,90vw);max-height:60vh;overflow:auto;background:Canvas;color:CanvasText;border:1px solid currentColor;border-radius:.5rem;padding:.5rem;box-shadow:0 .25rem .75rem #0002}',
  '.poc068-source-links>a{display:block;color:LinkText;overflow-wrap:anywhere;padding:.4rem .5rem;text-decoration:none}',
  '.poc068-source-links>a:focus-visible,.poc068-source-links>a:hover{text-decoration:underline}'
].join('\n');

function trustedTarget(value)
{
  if(typeof value!=='string'||value.length>4096)throw Error('Invalid source URL');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password)
    throw Error('Untrusted source URL');
  return url;
}
function disclosure(trigger,ordinal,index,targets,originalChildren=trigger.innerHTML)
{
  const classes=trigger.getAttribute('class');
  const inline=trigger.getAttribute('style');
  const labelAttrs=(classes?' class="'+escape(classes)+'"':'')+
    (inline?' style="'+escape(inline)+'"':'');
  const links=targets.map((target,i)=>{
    const url=trustedTarget(target);
    return '<a href="'+escape(url.href)+'" rel="noopener noreferrer" '+
      'target="_blank">'+escape(url.hostname)+' · '+(i+1)+'</a>';
  }).join('');
  // Existing original label/icon markup is reused, not approximated.
  return '<details class="poc068-source-details" data-poc068-ordinal="'+ordinal+
    '" data-poc068-index="'+index+'">'+
    '<summary'+labelAttrs+'>'+originalChildren+'</summary>'+
    '<div class="poc068-source-links">'+links+'</div></details>';
}

// Recover byte offsets from the captured HTML rather than searching for
// linkedom's normalized outerHTML, which can reformat attributes/entities/SVG.
// Scanning never rewrites content; each candidate is then independently parsed
// and compared to the exact, already-verified source-control DOM node.
export function capturedElementRanges(html)
{
  const stack=[],ranges=[];
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input',
    'link','meta','param','source','track','wbr']);
  let i=0;
  while(i<html.length)
  {
    const start=html.indexOf('<',i);
    if(start<0)break;
    if(html.startsWith('<!--',start)){
      const end=html.indexOf('-->',start+4);
      if(end<0)throw Error('Unclosed HTML comment in source snapshot');
      i=end+3;continue;
    }
    if(html.startsWith('<![CDATA[',start)){
      const end=html.indexOf(']]>',start+9);
      if(end<0)throw Error('Unclosed CDATA in source snapshot');
      i=end+3;continue;
    }
    const closing=html[start+1]==='/';
    const token=html.slice(start+(closing?2:1))
      .match(/^([A-Za-z][A-Za-z0-9:._-]*)/);
    if(!token){i=start+1;continue;}
    const name=token[1].toLowerCase();
    let quote=null,end=-1;
    for(let j=start+(closing?2:1)+token[1].length;j<html.length;j++){
      const char=html[j];
      if(quote){if(char===quote)quote=null;}
      else if(char==='"'||char==="'")quote=char;
      else if(char==='>'){end=j+1;break;}
    }
    if(end<0 || quote)throw Error('Unclosed HTML source tag');
    const opening=html.slice(start,end);
    if(closing)
    {
      const node=stack.pop();
      if(!node || node.name!==name)
        throw Error('Unbalanced HTML source markup');
      if(node.sourceCandidate)
        ranges.push({start:node.start,end,innerStart:node.innerStart,
          innerEnd:start});
    }
    else if(!voidTags.has(name)&&!/\/\s*>$/.test(opening))
    {
      stack.push({name,start,innerStart:end,
        sourceCandidate:/(?:^|[\s])aria-haspopup(?:\s|=|>)/i.test(opening)});
    }
    // Original browser outerHTML may contain text with raw '<' in these
    // elements. Skip to the real closing tag; no source pill is in raw text.
    if(!closing && /^(script|style|textarea|title)$/.test(name)){
      const remainder=html.slice(end);
      const close=new RegExp('</'+name+'\\s*>','i').exec(remainder);
      if(!close)throw Error('Unclosed raw-text HTML element');
      i=end+close.index;
    }else i=end;
  }
  if(stack.length)throw Error('Unbalanced HTML source markup');
  return ranges.sort((a,b)=>a.start-b.start);
}
function verifiedRawSourceRanges(html)
{
  const ranges=[];
  for(const range of capturedElementRanges(html))
  {
    const original=html.slice(range.start,range.end);
    const {document}=parseHTML(
      '<div data-poc068-fragment-root="">'+original+'</div>');
    const wrapper=document.querySelector('[data-poc068-fragment-root]');
    const trigger=wrapper?.firstElementChild;
    if(!trigger || wrapper.children.length!==1 ||
       !trigger.hasAttribute('aria-haspopup'))continue;
    const leaves=[
      ...(sourceLeaf(trigger)?[trigger]:[]),
      ...trigger.querySelectorAll('span')
    ].filter(sourceLeaf).filter(node=>
      node.closest('[aria-haspopup]')===trigger);
    if(!leaves.length)continue;
    // Preserve the one source-pill-to-one-trigger requirement; unexpected
    // nesting is never assigned a target.
    if(leaves.length!==1)
      throw Error('Ambiguous captured source trigger');
    ranges.push({...range,canonical:trigger.outerHTML,
      sourceLabel:leaves[0].textContent.trim()});
  }
  return ranges;
}

export function restoreSourceDisclosures(snapshotHtml,ordinal,groups,referencePills)
{
  if(!Array.isArray(groups)||!groups.length)
    return {html:snapshotHtml,converted:0,links:0};
  const {document}=parseHTML(snapshotHtml);
  const root=document.querySelector('[data-turn-id-container]');
  if(!root)throw Error('Missing source turn root');
  const leaves=[...root.querySelectorAll('span')].filter(sourceLeaf);
  const signatures=sourceGroupSignatures(snapshotHtml);
  if(signatures.length!==leaves.length ||
     !Array.isArray(referencePills) ||
     signatures.length!==referencePills.length)
    throw Error('Source group identity/cardinality mismatch in selected snapshot');
  for(let i=0;i<signatures.length;i++)
  {
    if(signatures[i].fingerprint!==referencePills[i].fingerprint ||
       signatures[i].count!==referencePills[i].count)
      throw Error('Selected source snapshot differs from trusted group context');
  }
  if(groups.length!==leaves.length)
    throw Error('Incomplete source groups in selected snapshot');
  const replacements=[];
  const used=new Set();
  for(const group of [...groups].sort((a,b)=>a.index-b.index))
  {
    const pill=leaves[group.index];
    if(!pill || !group.complete || !Array.isArray(group.targets) ||
       group.targets.length!==group.expectedSources ||
       group.expectedSources!==signatures[group.index].count)
      throw Error('Unverified source group cannot be rendered');
    const trigger=pill.closest('[aria-haspopup]');
    if(!trigger || trigger.localName==='a' ||
       trigger.closest?.('a[href]') || used.has(trigger) ||
       trigger.querySelector('a,button,input,summary,details'))
      throw Error('Unsupported original source trigger structure');
    used.add(trigger);
    replacements.push({old:trigger.outerHTML,trigger,
      targets:group.targets,
      index:group.index,count:group.targets.length});
  }
  // Browser-captured attributes, HTML entities and inline SVG often have
  // different lexical spellings from linkedom outerHTML. Match by parsed DOM
  // identity, but patch only byte ranges from the original source snapshot.
  const rawRanges=verifiedRawSourceRanges(snapshotHtml);
  if(rawRanges.length!==leaves.length)
    throw Error('Captured source trigger count mismatch');
  const sorted=replacements.sort((a,b)=>a.index-b.index);
  for(let i=0;i<sorted.length;i++)
  {
    const raw=rawRanges[i],item=sorted[i];
    if(raw.canonical!==item.old ||
       raw.sourceLabel!==leaves[item.index].textContent.trim())
      throw Error('Captured source trigger structure mismatch');
    // Reuse the *literal captured* trigger children, including its SVG bytes.
    item.next=disclosure(item.trigger,ordinal,item.index,item.targets,
      snapshotHtml.slice(raw.innerStart,raw.innerEnd));
    item.start=raw.start;
    item.end=raw.end;
  }
  let result=snapshotHtml;
  for(const item of [...sorted].reverse())
    result=result.slice(0,item.start)+item.next+result.slice(item.end);
  return {html:result,converted:replacements.length,
    links:replacements.reduce((n,x)=>n+x.count,0)};
}
