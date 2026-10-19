// Inject BEFORE navigation into the ORIGINAL page. No scroll manipulation.
// Captures mounted AND about-to-be-unmounted message turns as HTML, not pixels.
// The export page is managed by accumulate.mjs in a separate Playwright tab.
(() => {
  if(window.__rumiaiAccumulate)return;
  const queue=[],maxQueued=12000,seen=new Map(),dirty=new Set();
  const state={added:0,removed:0,updated:0,dropped:0,
    missingIdentity:0,overflow:false,baselineRuns:0,canvasFailures:0,
    shadowRootsUnsupported:true,version:1};
  const selector='[data-message-id],[data-testid^="conversation-turn"],'+
    '[data-message-author-role]';
  const fnv=text=>{
    let h=2166136261;
    for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);
    return (h>>>0).toString(16)+':'+text.length;
  };
  const cssTag=element=>{
    const out={tag:element.localName,className:element.getAttribute('class')||'',
      role:element.getAttribute('role')||null};
    return out;
  };
  function identify(el){
    if(!(el instanceof Element))return null;
    const target=el.closest(selector)||el.querySelector(selector);
    if(!target)return null;
    const turn=target.closest('[data-testid^="conversation-turn"]')||
      target.closest('article')||target.closest('[data-message-id]')||target;
    const msg=turn.matches('[data-message-id]')?turn:
      turn.querySelector('[data-message-id]');
    const dataId=msg?.getAttribute('data-message-id');
    const uniqueId=dataId||turn.getAttribute('data-message-id')||
      (turn.id&&/^(?:turn|message|conversation)[-_]/i.test(turn.id)?turn.id:null);
    const testId=turn.getAttribute('data-testid');
    const id=uniqueId?('id:'+uniqueId):
      testId&&/^conversation-turn/.test(testId)?('testid:'+testId):null;
    if(!id)return null; // never use inner text as a durable identity
    return {key:id,turn,role:msg?.getAttribute('data-message-author-role')||
      turn.querySelector('[data-message-author-role]')?.getAttribute(
        'data-message-author-role')||null,stable:!!uniqueId};
  }
  function turnsWithin(el){
    if(!(el instanceof Element))return [];
    const nodes=[el,...el.querySelectorAll(selector)];
    const map=new Map();
    for(const node of nodes){
      const entry=identify(node);
      if(entry&&!map.has(entry.key))map.set(entry.key,entry);
    }
    return [...map.values()];
  }
  function ancestors(turn){
    const result=[];let node=turn.parentElement;
    const stop=turn.closest('main');
    while(node&&node!==document.body&&result.length<12){
      result.unshift(cssTag(node));
      if(node===stop)break;
      node=node.parentElement;
    }
    return result;
  }
  function frozenHTML(turn){
    const clone=turn.cloneNode(true);
    const a=turn.querySelectorAll('canvas'),b=clone.querySelectorAll('canvas');
    for(let i=0;i<a.length&&i<b.length;i++){
      const canvas=a[i],replacement=clone.ownerDocument.createElement('img');
      try{
        const img=canvas.toDataURL('image/png');
        if(img.length>8*1024*1024)throw Error('canvas-over-budget');
        replacement.setAttribute('src',img);
        replacement.setAttribute('data-export-canvas','bitmap');
      }catch{
        state.canvasFailures++;
        replacement.setAttribute('data-export-canvas','unavailable');
      }
      replacement.width=canvas.width;
      replacement.height=canvas.height;
      b[i].replaceWith(replacement);
    }
    // Retain tables, SVG, MathML, code and original semantic markup.
    // Prevent copied active scripts and inline handlers in the export tab.
    for(const active of clone.querySelectorAll('script,iframe,object,embed,form'))
      active.remove();
    for(const child of [clone,...clone.querySelectorAll('*')]){
      for(const att of [...child.attributes])
        if(/^on/i.test(att.name))child.removeAttribute(att.name);
    }
    return clone.outerHTML;
  }
  function capture(entry,kind){
    if(!entry||!entry.turn)return;
    const html=frozenHTML(entry.turn);
    if(html.length>4500000){
      state.overflow=true;state.dropped++;return;
    }
    const hash=fnv(html),before=seen.get(entry.key);
    if(before===hash&&kind!=='removed')return;
    seen.set(entry.key,hash);
    if(queue.length>=maxQueued){state.overflow=true;state.dropped++;return;}
    const packet={kind,key:entry.key,role:entry.role,stable:entry.stable,
      hash,html,ancestors:ancestors(entry.turn),at:Math.round(performance.now())};
    queue.push(packet);
    state[kind==='removed'?'removed':before?'updated':'added']++;
  }
  function observeElement(el,kind){
    for(const entry of turnsWithin(el))capture(entry,kind);
  }
  function collectFrame(){
    const main=document.querySelector('main')||document;
    const entries=turnsWithin(main).filter(x=>x.turn.isConnected);
    const ordered=entries.sort((a,b)=>{
      if(a.turn===b.turn)return 0;
      const position=a.turn.compareDocumentPosition(b.turn);
      return position&Node.DOCUMENT_POSITION_FOLLOWING?-1:
        position&Node.DOCUMENT_POSITION_PRECEDING?1:0;
    });
    const keys=[...new Set(ordered.map(x=>x.key))];
    if(keys.length&&queue.length<maxQueued)
      queue.push({kind:'frame',keys,at:Math.round(performance.now()),
        htmlClass:document.documentElement.className,
        bodyClass:document.body?.className||''});
    for(const entry of entries)capture(entry,'added');
    state.baselineRuns++;
    return keys;
  }
  let timer=null;
  function schedule(){if(timer)return;timer=setTimeout(()=>{timer=null;
    for(const el of dirty)observeElement(el,'added');
    dirty.clear();
    collectFrame();
  },60);}
  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='childList'){
        // MutationObserver still owns removed Node references: capture before
        // React's virtualizer releases/destroys their content.
        for(const node of record.removedNodes)observeElement(node,'removed');
        for(const node of record.addedNodes)
          if(node instanceof Element)dirty.add(node);
        if(record.target instanceof Element)dirty.add(record.target);
      }else if(record.type==='characterData'){
        if(record.target.parentElement)dirty.add(record.target.parentElement);
      }else if(record.target instanceof Element)dirty.add(record.target);
    }
    schedule();
  });
  observer.observe(document,{subtree:true,childList:true,characterData:true,
    attributes:true,attributeFilter:['id','data-message-id','class','src',
      'srcset','style','data-message-author-role','data-testid']});
  window.__rumiaiAccumulate={
    status:()=>({...state,queued:queue.length,distinct:seen.size}),
    drain:(limit=120)=>({items:queue.splice(0,Math.min(500,Math.max(1,limit))),
      ...state,remaining:queue.length}),
    scan:collectFrame
  };
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>collectFrame(),{once:true});
  }else collectFrame();
})();