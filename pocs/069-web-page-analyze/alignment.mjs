// Match visible DOM anchors when the same Chromium MHTML is reopened.
// A uniform translation is correctable; changed/reflowed content is evidence.
const anchorCode=String.raw`(root,reference) => {
  if(!root)return [];
  const signature=element=>{
    const content=(element.textContent||'').trim().slice(0,120);
    let hash=2166136261;
    for(let i=0;i<content.length;i++)
    {
      hash=Math.imul(hash^content.charCodeAt(i),16777619);
    }
    return hash>>>0;
  };
  const describe=(element,path)=>{
    if(!element)return null;
    if(!path)
    {
      path=[];
      let cursor=element;
      while(cursor!==document.documentElement && cursor.parentElement)
      {
        const parent=cursor.parentElement;
        path.unshift(Array.prototype.indexOf.call(parent.children,cursor));
        cursor=parent;
      }
      if(cursor!==document.documentElement)return null;
    }
    return {path,top:element.getBoundingClientRect().top,
      fingerprint:signature(element)};
  };
  if(Array.isArray(reference))
  {
    return reference.map(item=>{
      let element=document.documentElement;
      for(const index of item.path)
      {
        element=element?.children[index];
        if(!element)break;
      }
      return describe(element,item.path);
    }).filter(Boolean);
  }
  const bounds=root===document.scrollingElement
    ? {left:0,top:0,right:innerWidth,bottom:innerHeight}
    : root.getBoundingClientRect();
  const items=[];
  for(const element of root.querySelectorAll(
    'p,li,h1,h2,h3,h4,pre,blockquote,td,th'))
  {
    const rect=element.getBoundingClientRect();
    if(rect.top<bounds.top+12 || rect.top>bounds.bottom-20 ||
       rect.left>=bounds.right || rect.right<=bounds.left ||
       rect.width<40 || rect.height<8 ||
       (element.textContent||'').trim().length<12)continue;
    const position=getComputedStyle(element).position;
    if(position==='fixed'||position==='sticky')continue;
    const item=describe(element);
    if(item)items.push(item);
  }
  items.sort((a,b)=>a.top-b.top);
  const selected=[];
  for(const item of items)
  {
    if(selected.length &&
       item.top-selected[selected.length-1].top<55)continue;
    selected.push(item);
    if(selected.length===8)break;
  }
  return selected;
}`;

export async function contentAnchors(browser,page,elementExpression,reference=null)
{
  const expression='('+anchorCode+')('+
    elementExpression+','+JSON.stringify(reference)+')';
  return browser.evaluate(page,expression);
}

// Original/reopened scrollTop equality does not prove the same visible text.
// The median of multiple matching anchors distinguishes translation from reflow.
export function contentAnchorShift(source,archive)
{
  const byPath=new Map((archive||[]).map(item=>
    [item.path.join('.'),item]));
  const offsets=[];
  for(const item of source||[])
  {
    const found=byPath.get(item.path.join('.'));
    if(!found||found.fingerprint!==item.fingerprint||
       !Number.isFinite(item.top)||!Number.isFinite(found.top))continue;
    offsets.push(found.top-item.top);
  }
  if(offsets.length<2)
    return {usable:false,reason:'insufficient-matching-content',
      matches:offsets.length};
  offsets.sort((a,b)=>a-b);
  const shift=offsets[Math.floor(offsets.length/2)];
  const spread=Math.max(...offsets.map(value=>Math.abs(value-shift)));
  if(spread>4)
    return {usable:false,reason:'content-reflow',
      matches:offsets.length,spread,shift};
  return {usable:true,matches:offsets.length,spread,shift};
}
