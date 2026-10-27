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
function disclosure(trigger,ordinal,index,targets)
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
    '<summary'+labelAttrs+'>'+trigger.innerHTML+'</summary>'+
    '<div class="poc068-source-links">'+links+'</div></details>';
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
    replacements.push({old:trigger.outerHTML,
      next:disclosure(trigger,ordinal,group.index,group.targets),
      index:group.index,count:group.targets.length});
  }
  let result=snapshotHtml;
  // The original HTML is patched in DOM order using exact serialized
  // trigger fragments. Every unrelated byte (SVG, tables, content) remains
  // identical. Fail closed if a parser reserializes a trigger differently.
  let last=0;
  for(const item of replacements)
  {
    const location=result.indexOf(item.old,last);
    if(location<0)
      throw Error('Exact captured source trigger not found; no transformation');
    result=result.slice(0,location)+item.next+
      result.slice(location+item.old.length);
    last=location+item.next.length;
  }
  return {html:result,converted:replacements.length,
    links:replacements.reduce((n,x)=>n+x.count,0)};
}
