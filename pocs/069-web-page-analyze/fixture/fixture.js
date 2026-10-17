(() => {
  const scroll = document.getElementById('scrollbox');
  const items = document.getElementById('items');
  const status = document.getElementById('status');
  const total = 24;
  let shown = 0;

  function appendBatch() {
    const target = Math.min(total, shown + 6);
    while (shown < target) {
      const number = ++shown;
      const item = document.createElement('article');
      item.className = 'item';
      item.dataset.ordinal = String(number);
      item.textContent = `Elemento ${number} / ${total}`;
      items.appendChild(item);
    }
    status.textContent = shown === total
      ? 'Fine dei contenuti' : `${shown} elementi caricati`;
  }

  function maybeLoad() {
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 200 && shown < total)
      appendBatch();
  }

  scroll.addEventListener('scroll', maybeLoad, { passive: true });
  appendBatch();
  window.__fixture = { total, get shown() { return shown; } };
})();
