import { findSnapshot, parseSnapshot } from './snapshot-export.mjs';

const MAX_JSON_BYTES = 24 * 1024 * 1024;
const CAPTURE_SLOT = '__rumiaiChatgptShareSnapshot';

export class AcquisitionError extends Error {
  constructor(code, message, stats) {
    super(code + ': ' + message);
    this.code = code;
    this.stats = stats;
  }
}

export function shareUrl(input) {
  let url;
  try { url = new URL(input); }
  catch { throw new AcquisitionError('share.invalid-url', 'expected ChatGPT share HTTPS URL'); }
  if (url.protocol !== 'https:' || url.host !== 'chatgpt.com' ||
    url.username || url.password || url.search ||
    !/^\/share\/[A-Za-z0-9-]+\/?$/.test(url.pathname)) {
    throw new AcquisitionError('share.invalid-url', 'expected https://chatgpt.com/share/<id>');
  }
  url.hash = '';
  return url.href;
}

export function recordJsonShape(raw, stats) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_JSON_BYTES ||
      stats.jsonShapes.length >= 6) return;
  let value;
  try { value = JSON.parse(raw); }
  catch { return; }
  const keys = (v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v).filter(k => /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k)).sort().slice(0, 16)
    : [];
  const signature = Array.isArray(value) ? { type: 'array', items: value.length }
    : value && typeof value === 'object' ? {
      type: 'object', keys: keys(value),
      nested: Object.fromEntries(keys(value).filter(k => keys(value[k]).length)
        .map(k => [k, keys(value[k])]))
    } : { type: typeof value };
  if (!stats.jsonShapes.some(v => JSON.stringify(v) === JSON.stringify(signature)))
    stats.jsonShapes.push(signature);
}

function fromJson(raw, stats) {
  const found = parseSnapshot(raw);
  if (!found) recordJsonShape(raw, stats);
  return found;
}

export function injectedCaptureSource() {
  return `(() => {
    const slot = ${JSON.stringify(CAPTURE_SLOT)};
    const findSnapshot = ${findSnapshot.toString()};
    const store = (value) => {
      try {
        if (globalThis[slot]) return;
        const snapshot = findSnapshot(value);
        if (snapshot) globalThis[slot] = JSON.stringify(snapshot);
      } catch {}
    };
    const inspectText = (text) => {
      if (typeof text !== 'string' || text.length > ${MAX_JSON_BYTES}) return;
      try { store(JSON.parse(text)); } catch {}
    };
    const relevant = (type) =>
      /json|javascript|text|x-component|event-stream/i.test(String(type || ''));

    const nativeFetch = globalThis.fetch;
    if (typeof nativeFetch === 'function') {
      globalThis.fetch = async function(...args) {
        const response = await Reflect.apply(nativeFetch, this, args);
        try {
          const type = response.headers?.get?.('content-type') || '';
          if (relevant(type)) {
            const clone = response.clone();
            void clone.text().then(inspectText).catch(() => {});
          }
        } catch {}
        return response;
      };
    }

    const xhr = globalThis.XMLHttpRequest?.prototype;
    const nativeSend = xhr?.send;
    if (typeof nativeSend === 'function') {
      xhr.send = function(...args) {
        try {
          this.addEventListener('loadend', () => {
            try {
              const type = this.getResponseHeader?.('content-type') || '';
              if (!relevant(type)) return;
              if (this.responseType === 'json') store(this.response);
              else if (!this.responseType || this.responseType === 'text')
                inspectText(this.responseText);
            } catch {}
          }, { once: true });
        } catch {}
        return Reflect.apply(nativeSend, this, args);
      };
    }

    const scanScripts = () => {
      try {
        for (const script of document.querySelectorAll('script')) {
          const type = script.type || '';
          if (type === 'application/json' || type === 'application/ld+json')
            inspectText(script.textContent || '');
        }
      } catch {}
    };
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', scanScripts, { once: true });
    else
      scanScripts();
  })()`;
}

function captureExpression() {
  return `globalThis[${JSON.stringify(CAPTURE_SLOT)}] ?? null`;
}

// Control is the portable public web-control client adapter: one command per
// request. The persistent session is used only as the common privileged CDP
// transport; this acquisition path does not enable Network or Debugger events.
export async function captureStructuredSnapshot(control, inputUrl, options = {}) {
  const url = shareUrl(inputUrl);
  const seconds = options.seconds ?? 20;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 120)
    throw new AcquisitionError('share.invalid-seconds', 'seconds must be 1..120');
  const stats = { phase: 'page-creation', operation: null, providerDiagnostic: null,
    hookFound: false, scriptCount: 0, inspectedResponses: 0, jsonShapes: [] };
  let page, session;

  async function send(method, params = {}) {
    const result = await control('debug', 'session', 'send', session, method, JSON.stringify(params));
    return result.result;
  }

  try {
    const created = await control('page', 'new');
    page = created.id;
    if (!page)
      throw new AcquisitionError('share.page-create-failed', 'provider did not return page ID', stats);

    stats.phase = 'debug-attach';
    stats.operation = 'debug session open';
    const opened = await control('debug', 'session', 'open', page);
    session = opened.session;
    if (!session)
      throw new AcquisitionError('share.debug-open-failed', 'missing session handle', stats);

    stats.phase = 'script-injection';
    stats.operation = 'debug session send Page.addScriptToEvaluateOnNewDocument';
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: injectedCaptureSource()
    });

    stats.phase = 'initial-navigation';
    stats.operation = 'debug session send Page.navigate';
    await send('Page.navigate', { url });

    stats.phase = 'capture-poll';
    stats.operation = 'debug session send Runtime.evaluate';
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      try {
        const result = await send('Runtime.evaluate', {
          expression: captureExpression(),
          returnByValue: true,
          silent: true
        });
        const raw = result?.result?.value;
        if (typeof raw === 'string') {
          const snapshot = parseSnapshot(raw);
          if (snapshot) {
            stats.operation = null;
            return { snapshot, method: 'injected-page', stats };
          }
        }
      } catch { /* Navigation may transiently replace the execution context. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Keep privacy-reduced shape evidence from inline JSON if injection did
    // not observe a complete snapshot. This is diagnostic only.
    stats.phase = 'embedded-json';
    const expression =
      "(() => [...document.querySelectorAll('script[type=\"application/json\"]')]" +
      ".slice(0,20).map(s=>s.textContent).filter(x=>x&&x.length<16000000))()";
    try {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        silent: true
      });
      for (const raw of result?.result?.value || []) {
        if (typeof raw !== 'string') continue;
        const snapshot = fromJson(raw, stats);
        if (snapshot) {
          stats.operation = null;
          return { snapshot, method: 'embedded-json', stats };
        }
      }
    } catch { /* Not every page exposes inline JSON script tags. */ }

    stats.operation = null;
    throw new AcquisitionError('share.snapshot-not-observed',
      'injected page capture did not observe a parent-linked snapshot', stats);
  } catch (error) {
    if (error instanceof AcquisitionError) throw error;
    stats.operation = error.operation || stats.operation;
    stats.providerDiagnostic = error.providerDiagnostic || null;
    throw new AcquisitionError('share.web-control-failed',
      'browser command or injected capture failed: ' +
      String(error.message || error).split('\n')[0].slice(0, 180), stats);
  } finally {
    if (session) await control('debug', 'session', 'close', session).catch(() => {});
    if (page) await control('page', 'close', page).catch(() => {});
  }
}
