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
  window.__rumiaiLiveObservation = {
    dump: () => ({version:1, capturedAt: new Date().toISOString(),
      overflow: entries.length >= 5000, entries: entries.slice()})
  };
})()