// Executed in every document, including cross-origin frames, before page scripts.
// No form values, keystrokes, clipboard data, DOM text or input payloads are collected.
export const OBSERVER_SOURCE = `(() =>
{
  const send = (event, data) =>
  {
    try { Promise.resolve(window.__webAnalyzeEmit({ event, data, pageTime: performance.now() })).catch(() => {}); }
    catch (_) { /* Frames can disappear while an event is being reported. */ }
  };
  const describe = node =>
  {
    if (!node || node.nodeType !== 1) return null;
    return {
      tag: node.localName,
      inputType: node.localName === 'input' ? node.type : undefined,
      idPresent: !!node.id,
      classes: node.classList ? node.classList.length : 0,
      editable: !!node.isContentEditable
    };
  };
  const events = ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu',
    'keydown', 'keyup', 'input', 'change', 'submit', 'focusin', 'focusout',
    'touchstart', 'touchend', 'wheel', 'scroll', 'selectionchange'];
  let lastWheel = 0;
  let lastScroll = 0;
  for (const type of events)
  {
    document.addEventListener(type, event =>
    {
      const now = performance.now();
      if (type === 'wheel' && now - lastWheel < 40) return;
      if (type === 'scroll' && now - lastScroll < 80) return;
      if (type === 'wheel') lastWheel = now;
      if (type === 'scroll') lastScroll = now;
      const target = describe(event.target);
      send('dom-event', {
        type,
        target,
        trusted: event.isTrusted,
        pointerType: event.pointerType,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        keyKind: type.startsWith('key') ? (event.key?.length === 1 ? 'printable' : 'control') : undefined,
        // Do not record event.code or event.key: either can reveal typed text.
        scrollX: type === 'scroll' ? window.scrollX : undefined,
        scrollY: type === 'scroll' ? window.scrollY : undefined
      });
    }, { capture: true, passive: true });
  }
  let pending = [];
  let overflow = 0;
  let timer;
  const flush = () =>
  {
    timer = null;
    if (!pending.length && !overflow) return;
    send('mutation-batch', { mutations: pending, omitted: overflow });
    pending = [];
    overflow = 0;
  };
  const start = () =>
  {
    if (!document.documentElement) { setTimeout(start, 10); return; }
    new MutationObserver(records =>
    {
      for (const record of records)
      {
        if (pending.length >= 200) { overflow++; continue; }
        pending.push({
          type: record.type,
          target: describe(record.target),
          attribute: record.attributeName,
          added: record.addedNodes?.length ?? 0,
          removed: record.removedNodes?.length ?? 0,
          addedTags: Array.from(record.addedNodes ?? []).slice(0, 8).map(describe),
          removedTags: Array.from(record.removedNodes ?? []).slice(0, 8).map(describe)
        });
      }
      if (!timer) timer = setTimeout(flush, 100);
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    send('observer-ready', { url: location.href, readyState: document.readyState });
  };
  start();
  document.addEventListener('visibilitychange', () => send('visibility', { state: document.visibilityState }));
  window.addEventListener('hashchange', () => send('hash-change', { url: location.href }));
  window.addEventListener('popstate', () => send('history-pop', { url: location.href }));
  window.addEventListener('error', event => send('window-error', { message: event.message, filename: event.filename, line: event.lineno }));
  window.addEventListener('unhandledrejection', () => send('unhandled-rejection', { reasonType: typeof event.reason }));
  if (typeof PerformanceObserver === 'function')
  {
    for (const type of ['navigation', 'resource', 'longtask', 'layout-shift', 'paint', 'largest-contentful-paint'])
    {
      try
      {
        new PerformanceObserver(list =>
        {
          for (const entry of list.getEntries())
          {
            send('performance-entry', {
              type: entry.entryType,
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
              value: entry.value,
              transferSize: entry.transferSize,
              decodedBodySize: entry.decodedBodySize
            });
          }
        }).observe({ type, buffered: true });
      }
      catch (_) { /* Optional browser performance capability. */ }
    }
  }
})();`;
