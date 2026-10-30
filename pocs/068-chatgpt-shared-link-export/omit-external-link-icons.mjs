'use strict';
// Exclude decorative images belonging to citations and external-link badges.
// Preserve all other original HTML bytes, CSS and conversation media.
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';

function faviconUrl(value)
{
  if(!value)return false;
  try
  {
    const url=new URL(value.replace(/&amp;/gu,'&'),'https://chatgpt.com');
    const host=url.hostname.toLowerCase();
    return (
      host==='www.google.com' && url.pathname==='/s2/favicons' ||
      /^t[0-9]\.gstatic\.com$/u.test(host) &&
        url.pathname==='/faviconV2' ||
      /\/favicon\.ico$/iu.test(url.pathname)
    );
  }
  catch{return false;}
}
function smallLinkIcon(img)
{
  const anchor=img.closest('a[href]');
  if(!anchor)return false;
  let dest;
  try{dest=new URL(anchor.getAttribute('href'),'https://chatgpt.com');}
  catch{return false;}
  if(!['http:','https:'].includes(dest.protocol) ||
     dest.hostname==='chatgpt.com')return false;
  const signals=[
    img.getAttribute('class')||'',img.getAttribute('alt')||'',
    img.getAttribute('data-testid')||'',img.getAttribute('src')||''
  ].join(' ');
  if(/(?:favicon|site-icon|source-icon|link-icon|site-logo)/iu.test(signals))
    return true;
  const width=Number(img.getAttribute('width'));
  const height=Number(img.getAttribute('height'));
  // Only explicit tiny dimensions; a linked screenshot/diagram stays content.
  const dimensions=[img.getAttribute('width'),img.getAttribute('height')]
    .filter(value=>value!==null);
  if(!dimensions.length)return false;
  return dimensions.every(value=>/^\d+(?:\.\d+)?$/u.test(value)&&
    Number(value)>0&&Number(value)<=64) &&
    (width<=64&&height<=64);
}
function ignored(img)
{
  if(faviconUrl(img.getAttribute('src')))return true;
  if(img.closest('[aria-haspopup],.poc068-source-details,'+
    '.poc068-source-links,[data-testid*="citation"],'+
    '[data-testid*="source-pill"]'))return true;
  return smallLinkIcon(img);
}

// Source positions are taken from the original HTML, not linkedom's
// serializer: removing only selected <img> tags preserves all other bytes.
export function omitExternalLinkIcons(directory)
{
  const file=path.join(directory,'index.html');
  const html=fs.readFileSync(file,'utf8');
  if(!html.includes("script-src 'none'"))
    throw Error('Link icon omission requires script-blocked HTML');
  const {document}=parseHTML(html);
  const nodes=[...document.querySelectorAll('img')];
  const positions=[...html.matchAll(
    /<img(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/giu)];
  if(nodes.length!==positions.length)
    throw Error('IMG source/DOM correspondence is ambiguous');
  const selected=[];
  for(let i=0;i<nodes.length;i++)
    if(ignored(nodes[i]))
      selected.push({start:positions[i].index,
        end:positions[i].index+positions[i][0].length});
  if(!selected.length)return {omitted:0,preserved:nodes.length};
  let output=html;
  for(const item of selected.reverse())
    output=output.slice(0,item.start)+output.slice(item.end);
  fs.writeFileSync(file,output,{mode:0o600});
  return {omitted:selected.length,preserved:nodes.length-selected.length};
}
