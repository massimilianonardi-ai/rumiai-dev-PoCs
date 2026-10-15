import { parseSnapshot } from './snapshot-export.mjs';

const MAX_SCRIPTS = 120;
const MAX_JSON_BYTES = 24 * 1024 * 1024;

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

export function splitTopLevelParams(source) {
  const values = [];
  let start = 0, depth = 0;
  for (let i = 0; i < source.length; i++) {
    if ('([{'.includes(source[i])) depth += 1;
    else if (')]}'.includes(source[i])) depth -= 1;
    else if (source[i] === ',' && depth === 0) {
      values.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  values.push(source.slice(start).trim());
  return values;
}

export function discoverHook(source, url) {
  let position = source.indexOf('mergeActiveBranch');
  while (position >= 0) {
    const start = Math.max(0, position - 500);
    const fragment = source.slice(start, position + 250);
    const regex = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\((.*?)\)\{/gs;
    const matches = [...fragment.matchAll(regex)];
    for (const match of matches.reverse()) {
      if (!match[2].includes('mergeActiveBranch')) continue;
      const parameters = splitTopLevelParams(match[2]);
      const arg = parameters[1];
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(arg || '')) continue;
      const offset = start + match.index + match[0].length;
      const preceding = source.slice(0, offset);
      const line = preceding.split('\n').length - 1;
      const column = offset - preceding.lastIndexOf('\n') - 1;
      return { url, lineNumber: line, columnNumber: column, arg };
    }
    position = source.indexOf('mergeActiveBranch', position + 1);
  }
  return null;
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

function withinShare(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'chatgpt.com'; }
  catch { return false; }
}
function scriptsForHook(scripts) {
  return [...scripts.entries()].filter(([, url]) =>
    url.startsWith('https://') && url.includes('.js') &&
    (url.startsWith('https://chatgpt.com/') || url.includes('.oaistatic.com/')))
    .sort((a, b) => Number(!a[1].startsWith('https://chatgpt.com/')) -
      Number(!b[1].startsWith('https://chatgpt.com/')))
    .slice(0, MAX_SCRIPTS);
}

// Control is the portable public web-control client adapter: one command per
// request, managed sessions live inside the provider's controller.
export async function captureStructuredSnapshot(control, inputUrl, options = {}) {
  const url = shareUrl(inputUrl);
  const seconds = options.seconds ?? 20;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 120)
    throw new AcquisitionError('share.invalid-seconds', 'seconds must be 1..120');
  const stats = { phase: 'page-creation', operation: null, providerDiagnostic: null,
    hookFound: false, scriptCount: 0, inspectedResponses: 0, jsonShapes: [] };
  const scripts = new Map();
  const requests = new Map();
  let page, session, after = 0;

  async function send(method, params = {}) {
    const result = await control('debug', 'session', 'send', session, method, JSON.stringify(params));
    return result.result;
  }

  async function eventBatch(deadline, waitOverride = null) {
    const wait = waitOverride ?? Math.min(500, Math.max(0, deadline - Date.now()));
    return control('debug', 'session', 'events', session,
      String(after), '128', String(wait));
  }

  async function handleEvents(events, hookArg) {
    for (const event of events) {
      const data = event.params || {};
      if (event.method === 'Debugger.scriptParsed') {
        if (data.scriptId) scripts.set(data.scriptId, data.url || '');
      } else if (event.method === 'Network.responseReceived') {
        if (data.requestId) requests.set(data.requestId,
          { url: data.response?.url || '', mime: data.response?.mimeType || '' });
      } else if (event.method === 'Network.loadingFinished') {
        const entry = requests.get(data.requestId);
        requests.delete(data.requestId);
        if (!entry || !withinShare(entry.url) ||
            !/json|text\/html/.test(entry.mime)) continue;
        stats.inspectedResponses += 1;
        try {
          const response = await send('Network.getResponseBody', { requestId: data.requestId });
          const raw = response.base64Encoded
            ? Buffer.from(response.body, 'base64').toString('utf8')
            : response.body;
          const snapshot = fromJson(raw, stats);
          if (snapshot) return { snapshot, method: 'observed-network' };
        } catch { /* Response may be unavailable after the request is disposed. */ }
      } else if (event.method === 'Debugger.paused') {
        let snapshot = null;
        try {
          if (hookArg) {
            for (const frame of data.callFrames || []) {
              try {
                const result = await send('Debugger.evaluateOnCallFrame', {
                  callFrameId: frame.callFrameId,
                  expression: 'JSON.stringify(' + hookArg + ')',
                  returnByValue: true, silent: true
                });
                const raw = result?.result?.value;
                if (typeof raw === 'string' && (snapshot = parseSnapshot(raw))) break;
              } catch { /* The selected expression may be absent in this frame. */ }
            }
          }
        } finally {
          await send('Debugger.resume');
        }
        if (snapshot) return { snapshot, method: 'original-breakpoint' };
      }
    }
    return null;
  }

  async function observed(deadline, hookArg = null, trigger = null) {
    if (trigger) {
      while (Date.now() < deadline) {
        const batch = await eventBatch(deadline, 0);
        const events = batch.events || [];
        if (!events.length) break;
        after = events.at(-1).sequence;
        const found = await handleEvents(events, hookArg);
        if (found) return found;
      }
    }

    const pending = () => eventBatch(deadline).then(
      batch => ({ batch }),
      error => ({ error })
    );
    let next = pending();
    if (trigger) await trigger();

    while (Date.now() < deadline) {
      const delivery = await next;
      if (delivery.error) throw delivery.error;
      const events = delivery.batch.events || [];
      if (events.length) after = events.at(-1).sequence;
      next = Date.now() < deadline ? pending() : null;
      const found = await handleEvents(events, hookArg);
      if (found) return found;
    }
    return null;
  }

  try {
    const created = await control('page', 'new');
    page = created.id;
    if (!page) throw new AcquisitionError('share.page-create-failed', 'provider did not return page ID', stats);
    stats.phase = 'debug-attach';
    stats.operation = 'debug session open';
    const opened = await control('debug', 'session', 'open', page);
    session = opened.session;
    if (!session) throw new AcquisitionError('share.debug-open-failed', 'missing session handle', stats);
    // Keep the initial event stream minimal. Network is the only domain
    // required while looking for a browser-delivered structured response.
    stats.operation = 'debug session send Network.enable';
    await send('Network.enable');
    stats.operation = null;

    stats.phase = 'initial-navigation';
    stats.operation = 'debug session send Page.navigate';
    let found = await observed(Date.now() + Math.min(seconds, 10) * 1000,
      null, () => send('Page.navigate', { url }));
    stats.operation = null;
    if (found) return { ...found, stats };

    stats.phase = 'embedded-json';
    const expression = "(() => [...document.querySelectorAll('script[type=\"application/json\"]')].slice(0,20).map(s=>s.textContent).filter(x=>x&&x.length<16000000))()";
    try {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true });
      for (const raw of result?.result?.value || []) {
        if (typeof raw !== 'string') continue;
        const snapshot = fromJson(raw, stats);
        if (snapshot) return { snapshot, method: 'embedded-json', stats };
      }
    } catch { /* Not every page exposes inline JSON script tags. */ }

    stats.phase = 'hook-discovery';
    stats.operation = 'debug session send Network.disable';
    await send('Network.disable');
    requests.clear();

    // Debugger.enable can emit the already-known script set immediately. Start
    // the event reader first so those scriptParsed events are consumed while
    // the domain is being enabled instead of competing with navigation events.
    stats.operation = 'debug session send Debugger.enable';
    found = await observed(Date.now() + Math.min(seconds, 1) * 1000,
      null, () => send('Debugger.enable'));
    stats.operation = null;
    if (found) return { ...found, stats };

    stats.scriptCount = scripts.size;
    let hook = null;
    for (const [id, jsUrl] of scriptsForHook(scripts)) {
      try {
        const result = await send('Debugger.getScriptSource', { scriptId: id });
        hook = discoverHook(result.scriptSource || '', jsUrl);
        if (hook) break;
      } catch { /* Loading/reloading a bundle can invalidate the script ID. */ }
    }
    stats.hookFound = Boolean(hook);
    if (!hook) throw new AcquisitionError('share.snapshot-hook-unavailable',
      'no structured snapshot or matching observed browser hook', stats);

    stats.phase = 'breakpoint-capture';
    await send('Debugger.setBreakpointByUrl', { url: hook.url,
      lineNumber: hook.lineNumber, columnNumber: hook.columnNumber });
    // CDP navigation returns before a paused JS breakpoint can deadlock the
    // provider's page.goto/BrowserWindow.loadURL awaiting DOM readiness.
    stats.operation = 'debug session send Page.navigate';
    found = await observed(Date.now() + seconds * 1000, hook.arg,
      () => send('Page.navigate', { url }));
    stats.operation = null;
    if (found) return { ...found, stats };
    throw new AcquisitionError('share.snapshot-not-observed',
      'matching hook installed, but no parent-linked snapshot captured', stats);
  } catch (error) {
    if (error instanceof AcquisitionError) throw error;
    stats.operation = error.operation || stats.operation;
    stats.providerDiagnostic = error.providerDiagnostic || null;
    throw new AcquisitionError('share.web-control-failed',
      'browser command or debugger event processing failed: ' +
      String(error.message || error).split('\n')[0].slice(0, 180), stats);
  } finally {
    if (session) await control('debug', 'session', 'close', session).catch(() => {});
    if (page) await control('page', 'close', page).catch(() => {});
  }
}
