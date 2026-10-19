(() => {
  if (window.__rumiaiInvestigate) return;
  const selector='[data-message-id],[data-message-author-role],[id]';
  const maxEvents=30000, pending=[], stats={added:0,removed:0,attribute:0,dropped:0};
  const hash=value=>{
    let h=2166136261;
    for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);
    return String(value.length)+':'+(h>>>0).toString(16);
  };
  const short=value=>typeof value==='string'?value.slice(0,240):null;
  const isMessageId=value=>typeof value==='string'&&
    /(?:^|[-_])(message|turn|conversation|chat|response|prompt)(?:[-_]|$)|^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value);
  function identity(el) {
    if(!(el instanceof Element))return null;
    let current=el,level=0,role=null;
    const ancestors=[];
    while(current&&level++<7){
      const id=current.getAttribute('id');
      const dataId=current.getAttribute('data-message-id');
      const testId=current.getAttribute('data-testid');
      const tag=current.localName;
      const author=current.getAttribute('data-message-author-role');
      if(author&&!role)role=author;
      if(dataId||author||(id&&(isMessageId(id)||level<=3))||
         (testId&&isMessageId(testId))){
        ancestors.push({level:level-1,tag,kind:dataId?'data-message-id':
          id?'id':author?'data-message-author-role':'data-testid',
          value:short(dataId||id||testId||author)});
      }
      current=current.parentElement;
    }
    if(!ancestors.length||!ancestors.some(x=>
      x.kind==='data-message-author-role'||x.kind==='data-message-id'||
      x.kind==='data-testid'&&isMessageId(x.value)||
      x.kind==='id'&&isMessageId(x.value)))return null;
    const node=ancestors.find(x=>x.kind==='data-message-id')||
      ancestors.find(x=>x.kind==='id'&&isMessageId(x.value))||
      ancestors.find(x=>x.kind==='id'&&x.level<=3)||
      ancestors[0];
    return {key:node.kind+':'+node.value,role,ancestors};
  }
  function candidates(node){
    if(!(node instanceof Element))return [];
    const items=[];
    if(node.matches(selector))items.push(node);
    // A single added wrapper may contain many message divs.
    for(const el of node.querySelectorAll(selector)){
      if(items.length>=1200)break;
      items.push(el);
    }
    const seen=new Set(),out=[];
    for(const item of items){
      const v=identity(item);
      if(!v||seen.has(v.key))continue;
      seen.add(v.key);
      out.push(v);
    }
    return out;
  }
  function append(op,id,parent){
    stats[op]++;
    if(pending.length>=maxEvents){stats.dropped++;return;}
    pending.push({at:Math.round(performance.now()),op,
      key:id.key,role:id.role,ancestors:id.ancestors,
      parent:parent?.localName||null});
  }
  function inspectMutations(mutations){
    for(const m of mutations){
      if(m.type==='childList'){
        for(const child of m.removedNodes)
          for(const item of candidates(child))append('removed',item,m.target);
        for(const child of m.addedNodes)
          for(const item of candidates(child))append('added',item,m.target);
      }else if(m.type==='attributes'){
        const id=identity(m.target);
        if(id)append('attribute',id,m.target.parentElement);
      }
    }
  }
  const observer=new MutationObserver(inspectMutations);
  observer.observe(document,{subtree:true,childList:true,attributes:true,
    attributeFilter:['id','data-message-id','data-message-author-role','data-testid']});
  function globalScroll(){
    const root=document.scrollingElement||document.documentElement;
    return {windowY:Math.round(window.scrollY),rootY:Math.round(root?.scrollTop||0),
      scrollHeight:root?.scrollHeight||0,viewport:window.innerHeight,
      rootClientHeight:root?.clientHeight||0};
  }
  function scrollBoxes(){
    const result=[];
    for(const el of document.querySelectorAll('main,section,div,article')){
      if(result.length>=24)break;
      const height=el.scrollHeight-el.clientHeight;
      if(height<35||el.clientHeight<70)continue;
      const css=getComputedStyle(el);
      const r=el.getBoundingClientRect();
      result.push({tag:el.localName,id:short(el.id),
        role:el.getAttribute('role'),overflowY:css.overflowY,
        scrollTop:Math.round(el.scrollTop),max:Math.round(height),
        height:el.clientHeight,top:Math.round(r.top),
        actualScroller:/auto|scroll|overlay/.test(css.overflowY)});
    }
    return result;
  }
  function messages(){
    const found=new Map();
    const els=document.querySelectorAll(selector);
    let scanned=0;
    for(const el of els){
      if(scanned++>=18000||found.size>=800)break;
      const info=identity(el);
      if(!info||found.has(info.key))continue;
      // Prefer the innermost content node, and do not export its text.
      const role=el.getAttribute('data-message-author-role')||
        el.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role')||
        info.role;
      const txt=(el.textContent||'').trim();
      const r=el.getBoundingClientRect();
      found.set(info.key,{key:info.key,role:role||null,
        anchors:info.ancestors,contentHash:hash(txt),
        textLength:txt.length,
        top:Math.round(r.top),bottom:Math.round(r.bottom),
        visible:r.bottom>0&&r.top<innerHeight,
        parentTag:el.parentElement?.localName||null,
        siblingIndex:el.parentElement?
          Array.prototype.indexOf.call(el.parentElement.children,el):-1});
    }
    return [...found.values()].sort((a,b)=>a.top-b.top);
  }
  function topology(){
    const main=document.querySelector('main')||document.body;
    const root=main||document.documentElement;
    if(!root)return null;
    const levels=[];
    let row=[root];
    for(let d=0;d<4&&row.length;d++){
      levels.push(row.slice(0,40).map(el=>({tag:el.localName,
        id:short(el.id),testId:short(el.getAttribute('data-testid')),
        children:el.children.length,role:el.getAttribute('role')})));
      row=row.flatMap(el=>[...el.children].slice(0,20)).slice(0,60);
    }
    return levels;
  }
  window.__rumiaiInvestigate={
    version:1,
    snapshot:()=>({at:Math.round(performance.now()),href:location.origin+location.pathname,
      scroll:globalScroll(),boxes:scrollBoxes(),messages:messages(),
      topology:topology(),stats:{...stats},
      scripts:document.scripts.length,
      resources:performance.getEntriesByType('resource').length}),
    drain:limit=>({events:pending.splice(0,Math.min(2000,Math.max(1,limit||500))),
      queued:pending.length,stats:{...stats}})
  };
})();