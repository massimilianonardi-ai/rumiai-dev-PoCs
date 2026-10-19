(() => {
  if (globalThis.__mWebAnalyzeInstalled) return;
  Object.defineProperty(globalThis, '__mWebAnalyzeInstalled', {value: true});
  const notify = (kind, detail) => {
    try { globalThis.__mWebAnalyzeNotify(JSON.stringify({kind, detail, time: performance.now()})); }
    catch (_) { /* The page may be detaching. */ }
  };
  const shape = node => {
    if (!node || node.nodeType !== 1) return null;
    const parent = node.parentElement;
    let index = 1;
    if (parent) for (let other = node.previousElementSibling; other; other = other.previousElementSibling)
      if (other.localName === node.localName) index++;
    return {tag: node.localName, nth: index, role: node.getAttribute('role') || undefined,
      type: node.localName === 'input' ? node.type : undefined};
  };
  const pointer = event => ({target: shape(event.target), x: Math.round(event.clientX),
    y: Math.round(event.clientY), button: event.button, buttons: event.buttons,
    modifiers: [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey]});
  const keyCategory = event => {
    if (['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown',
      'ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)) return event.key;
    return event.key && event.key.length === 1 ? 'character' : 'other';
  };
  document.addEventListener('pointerdown', e => notify('pointerdown', pointer(e)), true);
  document.addEventListener('pointerup', e => notify('pointerup', pointer(e)), true);
  document.addEventListener('click', e => notify('click', pointer(e)), true);
  document.addEventListener('dblclick', e => notify('dblclick', pointer(e)), true);
  document.addEventListener('submit', e => notify('submit', {target: shape(e.target)}), true);
  document.addEventListener('focusin', e => notify('focus', {target: shape(e.target)}), true);
  document.addEventListener('keydown', e => notify('keydown', {target: shape(e.target),
    keyCategory: keyCategory(e), modifiers: [e.ctrlKey,e.altKey,e.shiftKey,e.metaKey]}), true);
  document.addEventListener('input', e => notify('input', {target: shape(e.target),
    inputType: e.inputType || null, valueLength: e.target && typeof e.target.value === 'string'
      ? e.target.value.length : null}), true);
  document.addEventListener('change', e => notify('change', {target: shape(e.target)}), true);
  let lastScroll = 0;
  document.addEventListener('scroll', e => {
    const now = performance.now(); if (now - lastScroll < 80) return; lastScroll = now;
    notify('scroll', {target: shape(e.target), x: window.scrollX, y: window.scrollY});
  }, true);
  let lastWheel = 0;
  document.addEventListener('wheel', e => {
    const now = performance.now(); if (now - lastWheel < 40) return; lastWheel = now;
    notify('wheel', {target: shape(e.target), dx: e.deltaX, dy: e.deltaY});
  }, {capture: true, passive: true});
  document.addEventListener('visibilitychange', () => notify('visibility', {state: document.visibilityState}));
  window.addEventListener('hashchange', () => notify('hashchange', {}));
  window.addEventListener('popstate', () => notify('popstate', {}));
  window.addEventListener('error', e => notify('page-error', {type: e.type,
    source: e.filename || null, line: e.lineno || null, column: e.colno || null}));
  window.addEventListener('unhandledrejection', () => notify('unhandled-rejection', {}));
  const arm = () => {
    if (!document.documentElement) { setTimeout(arm, 20); return; }
    const observer = new MutationObserver(records => {
      const counts = {added: 0, removed: 0, attributes: 0, text: 0};
      const sample = [];
      for (const r of records) {
        if (r.type === 'childList') {
          counts.added += r.addedNodes.length; counts.removed += r.removedNodes.length;
        } else if (r.type === 'attributes') counts.attributes++;
        else if (r.type === 'characterData') counts.text++;
        if (sample.length < 12) sample.push({type: r.type,
          target: shape(r.target.nodeType === 1 ? r.target : r.target.parentElement),
          attribute: r.attributeName || undefined});
      }
      notify('mutation', {counts, records: records.length, sample});
    });
    observer.observe(document.documentElement, {subtree: true, childList: true,
      attributes: true, characterData: true});
  };
  arm();
  try {
    const supported = PerformanceObserver.supportedEntryTypes || [];
    for (const kind of ['navigation','resource','paint','largest-contentful-paint','longtask','layout-shift']) {
      if (!supported.includes(kind)) continue;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) notify('performance', {
          entryType: entry.entryType, name: entry.name, startTime: entry.startTime,
          duration: entry.duration, transferSize: entry.transferSize || 0});
      }).observe({type: kind, buffered: true});
    }
  } catch (_) { notify('instrumentation-warning', {feature: 'performance'}); }
  notify('instrumented', {readyState: document.readyState});
})()