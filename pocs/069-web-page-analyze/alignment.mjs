// Read-only content anchors: actual rendered text, not brittle DOM element paths.
// Virtualized pages and native MHTML may place identical text at different paths.
const anchorCode=String.raw`(root,references) =>
{
  if(!root)return [];
  const hashText=value=>
  {
    let hash=2166136261;
    for(let i=0;i<value.length;i++)
    {
      hash=Math.imul(hash^value.charCodeAt(i),16777619);
    }
    return hash>>>0;
  };
  const bounds=root===document.scrollingElement
    ? {left:0,top:0,right:innerWidth,bottom:innerHeight}
    : root.getBoundingClientRect();
  const countBySignature=new Map();
  const nodes=[];
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node;
  let scanned=0;
  while((node=walker.nextNode()) && scanned++<30000)
  {
    const value=(node.textContent||'').replace(/\s+/g,' ').trim();
    if(value.length<12)continue;
    const key=value.length+':'+hashText(value);
    const range=document.createRange();
    range.selectNodeContents(node);
    const rects=Array.from(range.getClientRects());
    if(!rects.length)continue;
    countBySignature.set(key,(countBySignature.get(key)||0)+1);
    nodes.push({key,rects});
  }
  if(Array.isArray(references))
  {
    const unique=new Map();
    for(const item of nodes)
    {
      if(countBySignature.get(item.key)===1)unique.set(item.key,item);
    }
    const resolved=[];
    for(const reference of references)
    {
      const item=unique.get(reference.key);
      const rect=item?.rects[reference.line];
      if(!rect)continue;
      resolved.push({key:reference.key,line:reference.line,top:rect.top});
    }
    return resolved;
  }
  const candidates=[];
  for(const item of nodes)
  {
    if(countBySignature.get(item.key)!==1)continue;
    const parentNode=item.rects.length;
    for(let index=0;index<parentNode;index++)
    {
      const rect=item.rects[index];
      if
      (
        rect.top<bounds.top+12 || rect.bottom>bounds.bottom-12 ||
        rect.left<bounds.left || rect.right>bounds.right ||
        rect.width<35 || rect.height<7
      )
      {
        continue;
      }
      candidates.push({key:item.key,line:index,top:rect.top});
      break;
    }
  }
  candidates.sort((a,b)=>a.top-b.top);
  const selected=[];
  for(const candidate of candidates)
  {
    if
    (
      selected.length &&
      candidate.top-selected[selected.length-1].top<48
    )
    {
      continue;
    }
    selected.push(candidate);
    if(selected.length===12)break;
  }
  return selected;
}`;

export async function contentAnchors(browser,page,elementExpression,references=null)
{
  const expression='('+anchorCode+')('+
    elementExpression+','+JSON.stringify(references)+')';
  return browser.evaluate(page,expression);
}

// Same CSS scrollTop is not proof of the same visible content.
// Refuse corrections based on one marker, repeated text or nonuniform reflow.
export function contentAnchorShift(source,archive)
{
  const byKey=new Map();
  for(const item of archive||[])
  {
    byKey.set(item.key+':'+item.line,item);
  }
  const offsets=[];
  for(const item of source||[])
  {
    const matched=byKey.get(item.key+':'+item.line);
    if(!matched||
       !Number.isFinite(item.top)||!Number.isFinite(matched.top))
    {
      continue;
    }
    offsets.push(matched.top-item.top);
  }
  if(offsets.length<2)
  {
    return {usable:false,reason:'insufficient-matching-content',
      matches:offsets.length,sourceCount:(source||[]).length,
      archiveCount:(archive||[]).length};
  }
  offsets.sort((a,b)=>a-b);
  const shift=offsets[Math.floor(offsets.length/2)];
  const spread=Math.max(...offsets.map(value=>Math.abs(value-shift)));
  if(spread>4)
  {
    return {usable:false,reason:'content-reflow',
      matches:offsets.length,spread,shift};
  }
  return {usable:true,matches:offsets.length,spread,shift};
}
