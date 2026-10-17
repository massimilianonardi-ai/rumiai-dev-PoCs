(() => {
  if (window.__rumiaiLiveObservation) return;
  const entries = [];
  let sequence = 0;
  function scrollRoot() {
    return document.scrollingElement || document.documentElement;
  }
  function locator(el) {
    if (el === scrollRoot() || el === document.documentElement ||
        el === document.body) return 'html';
    if (!(el instanceof Element)) return 'html';
    if (el.id) {
      const id = '#' + CSS.escape(el.id);
      if (document.querySelectorAll(id).length === 1) return id;
    }
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 24;
         node = node.parentElement) {
      let part = node.localName;
      if (!node.parentElement) { parts.unshift(part); break; }
      const siblings = [...node.parentElement.children].filter(
        child => child.localName === node.localName);
      if (siblings.length > 1)
        part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  }
  function scrollParent(target) {
    let el = target instanceof Element ? target : document.body;
    for (; el; el = el.parentElement) {
      if (el === document.documentElement || el === document.body) break;
      const css = getComputedStyle(el);
      if (el.scrollHeight - el.clientHeight > 12 &&
          /auto|scroll|overlay/.test(css.overflowY)) return el;
    }
    return scrollRoot();
  }
  function state(el) {
    return {selector: locator(el), top: Math.round(el.scrollTop),
      max: Math.max(0, Math.round(el.scrollHeight - el.clientHeight)),
      viewport: el.clientHeight};
  }
  function add(kind, data) {
    if (entries.length >= 5000) return;
    entries.push({n: ++sequence, at: Math.round(performance.now()), kind, ...data});
  }
  document.addEventListener('wheel', event => {
    if (!event.isTrusted || event.deltaY === 0) return;
    const el = scrollParent(event.target);
    add('wheel', {...state(el), direction: event.deltaY > 0 ? 'down' : 'up'});
  }, {capture: true, passive: true});
  document.addEventListener('scroll', event => {
    const el = event.target === document ? scrollRoot() : event.target;
    if (!(el instanceof Element)) return;
    if (el.scrollHeight - el.clientHeight < 12) return;
    add('scroll', {...state(el), trusted: event.isTrusted});
  }, true);
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const el = event.target instanceof Element
      ? event.target.closest('summary,[aria-expanded]') : null;
    if (!el) return;
    add('disclosure', {selector: locator(el),
      element: el.localName, expandable: el.hasAttribute('aria-expanded')});
  }, true);
  // Passive page state for human-phase evidence; never store message text
  // in observation metadata. A one-way hash and role allow source/replay checks.
  let mutationRevision=0;
  let mutationTime=performance.now();
  const mutations=new MutationObserver(() => {
    mutationRevision++;
    mutationTime=performance.now();
  });
  mutations.observe(document.documentElement,{subtree:true,childList:true,
    characterData:true,attributes:true,
    attributeFilter:['class','style','aria-busy','data-message-author-role']});
  function hash(value) {
    let h=2166136261;
    for (let i=0;i<value.length;i++)
      h=Math.imul(h^value.charCodeAt(i),16777619);
    return (h>>>0).toString(16).padStart(8,'0');
  }
  function messages() {
    const nodes=[...document.querySelectorAll('[data-message-author-role]')];
    const seen=new Set();
    return nodes.flatMap(el => {
      const role=el.getAttribute('data-message-author-role');
      if(role!=='user'&&role!=='assistant')return [];
      const content=(el.innerText||'').trim();
      if(!content)return [];
      const r=el.getBoundingClientRect();
      const item={role,signature:content.length+':'+hash(content),
        length:content.length,top:Math.round(r.top),
        bottom:Math.round(r.bottom),
        visible:r.bottom>0&&r.top<innerHeight};
      const identity=role+':'+item.signature;
      if(seen.has(identity))return [];
      seen.add(identity);
      return [item];
    });
  }
  function sample() {
    const last=[...entries].reverse().find(e=>
      e.kind==='scroll'||e.kind==='wheel');
    const scroll=last?.selector||'html';
    let node;
    try {
      node=scroll==='html'?scrollRoot():document.querySelector(scroll);
    } catch {}
    const stateNow=node?state(node):null;
    const inventory=messages();
    return {
      now:Math.round(performance.now()),mutationRevision,
      mutationTime:Math.round(mutationTime),eventCount:sequence,
      scroll:stateNow,resourceCount:performance.getEntriesByType('resource').length,
      incompleteImages:[...document.images].filter(x=>!x.complete).length,
      fontStatus:document.fonts?.status||'unknown',
      roleDetection:'data-message-author-role',
      roles:{
        user:inventory.filter(x=>x.role==='user').length,
        assistant:inventory.filter(x=>x.role==='assistant').length
      },
      messages:inventory
    };
  }
  window.__rumiaiLiveObservation = {
    sample,
    dump: () => ({version:2, capturedAt:new Date().toISOString(),
      overflow: entries.length >= 5000,entries:entries.slice()})
  };
})()