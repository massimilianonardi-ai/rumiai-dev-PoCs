'use strict';
// Experimental native-CDP observer/DOM tracing for PoC 068. Not a production API.
// Output is private: saved HTML may contain chat contents and signed links.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';

function pageProbe() {
  if (globalThis.__rumiaiRenderingProbe) return;
  Object.defineProperty(globalThis, '__rumiaiRenderingProbe', {value: true});
  const log = (kind, detail = {}) => {
    try { globalThis.__rumiaiTrace(JSON.stringify({kind, pageTime: performance.now(), ...detail})); }
    catch (_) {}
  };
  const identify = node => {
    if (!(node instanceof Element)) return null;
    const parent = node.closest('[data-turn-id-container]');
    return {tag: node.localName, id: node.id || undefined,
      turnId: node.getAttribute('data-turn-id-container') ||
        parent?.getAttribute('data-turn-id-container') || undefined,
      messageId: node.getAttribute('data-message-id') || undefined,
      scrollRoot: node.hasAttribute('data-scroll-root') || undefined};
  };
  // Keep call sites without persisting query strings or fragments from signed URLs.
  const caller = () => (new Error().stack || '').split('\n').slice(2, 5)
    .map(frame => frame.trim().replace(/https?:\/\/[^\s)]+/g, match => {
      try { const url = new URL(match); return url.origin + url.pathname; }
      catch { return '[url]'; }
    }));
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, callback, opts) {
    if (['scroll','wheel','resize','scrollend'].includes(type))
      log('listener.register', {event: type, target: identify(this),
        targetType: this === window ? 'window' : this === document ? 'document' : undefined,
        callbackName: typeof callback === 'function' ? callback.name || null : null,
        caller: caller()});
    return add.call(this, type, callback, opts);
  };
  let number = 0;
  const OriginalIO = globalThis.IntersectionObserver;
  if (typeof OriginalIO === 'function') {
    globalThis.IntersectionObserver = class extends OriginalIO {
      constructor(callback, opts = {}) {
        const id = ++number;
        super((entries, observer) => {
          log('intersection.callback', {observerId: id, entries: entries.slice(0, 50)
            .map(entry => ({target: identify(entry.target), visible: entry.isIntersecting,
              ratio: entry.intersectionRatio, top: entry.boundingClientRect.top,
              rootTop: entry.rootBounds?.top, rootBottom: entry.rootBounds?.bottom}))});
          return callback(entries, observer);
        }, opts);
        this.probeId = id;
        log('intersection.create', {observerId: id, root: identify(opts.root),
          rootMargin: opts.rootMargin || '0px', threshold: opts.threshold ?? 0,
          caller: caller()});
      }
      observe(element) {
        log('intersection.observe', {observerId: this.probeId, target: identify(element)});
        return super.observe(element);
      }
      unobserve(element) { return super.unobserve(element); }
      disconnect() { return super.disconnect(); }
    };
  }
  const OriginalRO = globalThis.ResizeObserver;
  if (typeof OriginalRO === 'function') {
    globalThis.ResizeObserver = class extends OriginalRO {
      constructor(callback) {
        const id = ++number;
        super((entries, observer) => {
          log('resize.callback', {observerId: id,
            targets: entries.slice(0, 50).map(entry => identify(entry.target))});
          return callback(entries, observer);
        });
        this.probeId = id;
        log('resize.create', {observerId: id, caller: caller()});
      }
      observe(element, opts) {
        log('resize.observe', {observerId: this.probeId, target: identify(element)});
        return super.observe(element, opts);
      }
    };
  }
  const last = new Map();
  const states = new Map();
  let scheduled = false;
  function capture() {
    scheduled = false;
    const present = new Set();
    for (const turn of document.querySelectorAll('[data-turn-id-container]')) {
      const turnId = turn.getAttribute('data-turn-id-container');
      // ChatGPT may nest two wrappers with the same turn ID. Archive the
      // outermost one so one turn is captured once, with its whole subtree.
      const ancestor = turn.parentElement?.closest('[data-turn-id-container]');
      if (!turnId || ancestor?.getAttribute('data-turn-id-container') === turnId) continue;
      present.add(turnId);
      const messageIds = [...turn.querySelectorAll('[data-message-id]')]
        .map(element => element.getAttribute('data-message-id')).filter(Boolean);
      const previous = states.get(turnId);
      const rendered = messageIds.length > 0;
      if (!previous) {
        log('turn.initial', {turnId, rendered, messageIds});
      } else if (previous.rendered !== rendered) {
        log(rendered ? 'turn.content-mounted' : 'turn.content-unmounted',
          {turnId, messageIds: rendered ? messageIds : previous.messageIds});
      }
      states.set(turnId, {rendered, messageIds});
      // Keep non-message DOM evidence separate from the cumulative assembler.
      if (!rendered && !turn.children.length) continue;
      const html = turn.outerHTML;
      let hash = 2166136261;
      for (let i = 0; i < html.length; ++i)
        hash = Math.imul(hash ^ html.charCodeAt(i), 16777619);
      const signature = (rendered ? 'message:' : 'unidentified:') +
        (hash >>> 0) + ':' + html.length;
      if (last.get(turnId) === signature) continue;
      last.set(turnId, signature);
      if (html.length > 2097152)
        log('turn.too-large', {turnId, messageIds, length: html.length});
      else log(rendered ? 'turn.snapshot' : 'turn.unidentified-snapshot',
        {turnId, messageIds, html,
          // currentSrc is the browser-chosen image URL; it can differ from
          // the literal src because of responsive srcset or React updates.
          ...(globalThis.__rumiaiCompareImageUrls ? {imageSelections:
            [...turn.querySelectorAll('img')].slice(0, 40).map(img => ({
              src: img.getAttribute('src') || null,
              resolvedSrc: img.src || null,
              currentSrc: img.currentSrc || null
            }))} : {})});
    }
    // Some implementations remove the entire wrapper rather than merely
    // emptying its children. Do not mistake a wrapper removal for a React
    // unmount of its descendants: report the two observations separately.
    for (const [turnId, previous] of states) {
      if (present.has(turnId)) continue;
      log('turn.wrapper-removed', {turnId, messageIds: previous.messageIds,
        hadRenderedContent: previous.rendered});
      states.delete(turnId);
      last.delete(turnId);
    }
  }
  function schedule() {
    if (!scheduled) {scheduled = true; requestAnimationFrame(capture);}
  }
  const observer = new MutationObserver(records => {
    let added = 0, removed = 0, attributes = 0;
    const ids = new Set();
    for (const record of records) {
      added += record.addedNodes.length; removed += record.removedNodes.length;
      if (record.type === 'attributes') attributes++;
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const wrapper = target?.closest('[data-turn-id-container]');
      if (wrapper) ids.add(wrapper.getAttribute('data-turn-id-container'));
      for (const changed of [...record.addedNodes, ...record.removedNodes]) {
        if (!(changed instanceof Element)) continue;
        if (changed.matches('[data-turn-id-container]'))
          ids.add(changed.getAttribute('data-turn-id-container'));
        for (const node of changed.querySelectorAll('[data-turn-id-container]'))
          ids.add(node.getAttribute('data-turn-id-container'));
      }
    }
    if (added || removed || ids.size)
      log('dom.mutation', {added, removed, attributes, turnIds: [...ids].filter(Boolean).slice(0, 80)});
    schedule();
  });
  function arm() {
    if (!document.documentElement) {setTimeout(arm, 20);return;}
    observer.observe(document.documentElement, {childList: true, attributes: true, subtree: true});
    document.addEventListener('scroll', event => {
      const element = event.target;
      log('scroll.actual', {target: identify(element), top: element.scrollTop || 0,
        height: element.scrollHeight || 0, viewport: element.clientHeight || 0});
      schedule();
    }, true);
    log('probe.installed');
    schedule();
  }
  arm();
}

const injected = '(' + pageProbe.toString() + ')()';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

class Cdp {
  constructor(url, report, captureImageUrls = false, storeImage = null) {
    this.url = url; this.report = report; this.pending = new Map();
    this.storeImage = storeImage;
    this.imageResponses = new Map();
    this.imageBodyJobs = new Set();
    // One CDP session for DOM and network; signed URLs remain private.
    this.captureImageUrls = captureImageUrls;
    this.networkRequests = new Map();
    this.sessions = new Map(); this.targetSessions = new Map();
    this.nextId = 0; this.closed = false;
  }
  async connect() {
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', resolve, {once: true});
      this.ws.addEventListener('error', reject, {once: true});
      this.ws.addEventListener('message', e => this.receive(e.data));
      this.ws.addEventListener('close', () => {
        this.closed = true;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer); p.reject(Error('CDP disconnected'));
        }
        this.pending.clear();
      });
    });
  }
  send(method, params = {}, sessionId, timeoutMs = 12000) {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN)
      return Promise.reject(Error('CDP connection closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(Error('CDP timed out: ' + method));
      }, timeoutMs);
      this.pending.set(id, {resolve, reject, timer});
      this.ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }
  receive(raw) {
    let message;
    try {message = JSON.parse(String(raw));} catch {return;}
    if (typeof message.id === 'number') {
      const p = this.pending.get(message.id); if (!p) return;
      this.pending.delete(message.id); clearTimeout(p.timer);
      message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result || {});
      return;
    }
    const {method, params = {}, sessionId} = message;
    if (method === 'Target.attachedToTarget') {
      const sid = params.sessionId, info = params.targetInfo;
      this.sessions.set(sid, {type: info.type, ready: false});
      this.targetSessions.set(info.targetId, sid);
      void this.setup(sid, info.type);
    } else if (method === 'Target.detachedFromTarget') {
      this.sessions.delete(params.sessionId);
    } else if (this.captureImageUrls && method === 'Network.requestWillBeSent') {
      const id = JSON.stringify([sessionId, params.requestId]);
      const url = params.request?.url;
      if (typeof url === 'string') {
        const prior = this.networkRequests.get(id);
        this.networkRequests.set(id, {
          initialUrl: prior?.initialUrl || params.redirectResponse?.url || url,
          requestUrl: url
        });
      }
    } else if (this.storeImage && method === 'Network.loadingFinished') {
      const key = JSON.stringify([sessionId, params.requestId]);
      const response = this.imageResponses.get(key);
      this.imageResponses.delete(key);
      if (response) {
        const job = this.readImageBody(response);
        this.imageBodyJobs.add(job);
        void job.finally(() => this.imageBodyJobs.delete(job));
      }
    } else if (this.storeImage && method === 'Network.loadingFailed') {
      const key = JSON.stringify([sessionId, params.requestId]);
      const response = this.imageResponses.get(key);
      this.imageResponses.delete(key);
      if (response) this.report({kind: 'network.image-body',
        requestId: response.requestId, status: 'loading-failed'}, response.sessionId);
    } else if (this.captureImageUrls && method === 'Network.responseReceived') {
      const mime = String(params.response?.mimeType || '').toLowerCase();
      if (mime.startsWith('image/') || params.type === 'Image') {
        const id = JSON.stringify([sessionId, params.requestId]);
        const request = this.networkRequests.get(id);
        if (this.storeImage) this.imageResponses.set(id, {
          sessionId, requestId: params.requestId, mime,
          status: params.response?.status, url: params.response?.url
        });
        this.report({kind:'network.image-response',
          requestId:params.requestId, initialUrl:request?.initialUrl || null,
          requestUrl:request?.requestUrl || null,
          responseUrl:params.response?.url || null,
          mimeType:mime, resourceType:params.type,
          status:params.response?.status || null,
          fromDiskCache:!!params.response?.fromDiskCache,
          fromServiceWorker:!!params.response?.fromServiceWorker}, sessionId);
      }
      this.networkRequests.delete(JSON.stringify([sessionId, params.requestId]));
    } else if (method === 'Runtime.bindingCalled' && params.name === '__rumiaiTrace') {
      try {this.report(JSON.parse(params.payload), sessionId);}
      catch {this.report({kind: 'probe.event-decode-failed'}, sessionId);}
    }
  }
  async readImageBody(response) {
    const detail = {kind:'network.image-body',requestId:response.requestId};
    try {
      if (!(response.status >= 200 && response.status < 300)) {
        this.report({...detail,status:'http-status-not-success'},response.sessionId);
        return;
      }
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(
          response.mime.split(';')[0].trim())) {
        this.report({...detail,status:'mime-unsupported'},response.sessionId);
        return;
      }
      const body = await this.send('Network.getResponseBody',
        {requestId:response.requestId},response.sessionId,12000);
      const bytes = body.base64Encoded ?
        Buffer.from(body.body || '', 'base64') : Buffer.from(body.body || '', 'utf8');
      const result = this.storeImage(response,bytes);
      this.report({...detail,...result},response.sessionId);
    } catch {
      // Do not expose signed image URLs or CDP exception strings in CLI diagnostics.
      this.report({...detail,status:'body-unavailable'},response.sessionId);
    }
  }
  async drainImageBodies() {
    await Promise.allSettled([...this.imageBodyJobs]);
  }
  async setup(sid, type) {
    try {
      await this.send('Runtime.enable', {}, sid);
      if (type === 'page' || type === 'iframe') {
        await this.send('Page.enable', {}, sid);
        if (this.captureImageUrls) await this.send('Network.enable', {}, sid);
        await this.send('Runtime.addBinding', {name: '__rumiaiTrace'}, sid);
        const source = (this.captureImageUrls ?
          'globalThis.__rumiaiCompareImageUrls=true;\n' : '') + injected;
        await this.send('Page.addScriptToEvaluateOnNewDocument', {source}, sid);
        await this.send('Runtime.evaluate', {expression: source}, sid);
      }
      const info = this.sessions.get(sid);
      if (info) info.ready = true;
    } catch (e) {this.report({kind: 'probe.instrumentation-failed', reason: e.message}, sid);}
    finally {try {await this.send('Runtime.runIfWaitingForDebugger', {}, sid, 3000);} catch {}}
  }
}

function recording(directory) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  for (const entry of ['events.jsonl', 'summary.json', 'turns'])
    if (fs.existsSync(path.join(directory, entry)))
      throw Error('Previous evidence exists: ' + entry);
  fs.mkdirSync(path.join(directory, 'turns'), {mode: 0o700});
  const fd = fs.openSync(path.join(directory, 'events.jsonl'), 'wx', 0o600);
  let imageBytesTotal = 0;
  const imageFiles = new Set();
  const formats = {
    'image/png': {extension:'png', signature:bytes =>
      bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))},
    'image/jpeg': {extension:'jpg', signature:bytes =>
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255},
    'image/webp': {extension:'webp', signature:bytes =>
      bytes.toString('ascii',0,4) === 'RIFF' &&
      bytes.toString('ascii',8,12) === 'WEBP'},
    'image/gif': {extension:'gif', signature:bytes =>
      ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))}
  };
  function storeImage(response,bytes) {
    const mime = response.mime.split(';')[0].trim();
    const format = formats[mime];
    if (!format) return {status:'mime-unsupported'};
    if (bytes.length < 12 || bytes.length > 12*1024*1024 || !format.signature(bytes))
      return {status:'body-invalid-or-too-large'};
    if (imageBytesTotal + bytes.length > 64*1024*1024 ||
        imageFiles.size >= 128 && !imageFiles.has(sha(bytes)))
      return {status:'capture-limit'};
    const digest = sha(bytes), name = 'images/' + digest + '.' + format.extension;
    fs.mkdirSync(path.join(directory,'images'),{recursive:true,mode:0o700});
    if (!imageFiles.has(digest)) {
      try {fs.writeFileSync(path.join(directory,name),bytes,{flag:'wx',mode:0o600});}
      catch(error) {if(error.code !== 'EEXIST') throw error;}
      imageFiles.add(digest);
      imageBytesTotal += bytes.length;
    }
    return {status:'saved',file:name,sha256:digest,bytes:bytes.length,
      mimeType:mime};
  }
  let sequence = 0, finished = false;
  const counts = {}, files = new Set();
  function record(event, sessionId) {
    if (finished) return;
    const {kind = 'unknown', html, ...info} = event;
    counts[kind] = (counts[kind] || 0) + 1;
    if ((kind === 'turn.snapshot' || kind === 'turn.unidentified-snapshot') &&
        typeof html === 'string') {
      const bytes = Buffer.from(html, 'utf8');
      if (bytes.length <= 2097152) {
        const hash = sha(bytes), filename = 'turns/' + hash + '.html';
        if (!files.has(hash)) {
          fs.writeFileSync(path.join(directory, filename), bytes, {flag: 'wx', mode: 0o600});
          files.add(hash);
        }
        info.file = filename; info.sha256 = hash; info.bytes = bytes.length;
      } else info.status = 'too-large';
    }
    fs.writeSync(fd, JSON.stringify({sequence: ++sequence, at: new Date().toISOString(),
      sessionId, kind, ...info}) + '\n');
  }
  function finish() {
    if (finished) return;
    finished = true; fs.closeSync(fd);
    const summary = {events: sequence, counts, uniqueTurnSnapshots: files.size};
    fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n',
      {flag: 'wx', mode: 0o600});
    return summary;
  }
  return {record, finish, storeImage};
}

async function sweep(cdp, sid, record, onSample = null) {
  // Only actual scrollTop changes can cause native intersection recalculation.
  let ready = false;
  const limit = performance.now() + 120000;
  while (!cdp.closed && performance.now() < limit) {
    try {
      const r = await cdp.send('Runtime.evaluate', {expression:
        "!!(document.querySelector('[data-scroll-root]') && " +
        "document.querySelector('[data-turn-id-container]'))", returnByValue: true}, sid);
      if (r.result?.value === true) {ready = true;break;}
    } catch {}
    await pause(500);
  }
  if (!ready) {
    let shape={};
    try {
      const r=await cdp.send('Runtime.evaluate',{expression:
        "({readyState:document.readyState,hasScrollRoot:!!document.querySelector('[data-scroll-root]'),"+
        "turnWrappers:document.querySelectorAll('[data-turn-id-container]').length,"+
        "conversationMarkers:document.querySelectorAll('[data-testid^=conversation-turn-]').length,"+
        "mainElements:document.querySelectorAll('main').length})",returnByValue:true},sid);
      shape=r.result?.value||{};
    } catch {}
    record({kind:'sweep.not-ready',pageShape:shape});
    return {ready:false,pageShape:shape};
  }
  record({kind: 'sweep.started'});
  if (onSample) await onSample();
  for (const direction of [1, -1]) {
    let stable = 0;
    for (let step = 0; step < 2000 && !cdp.closed; step++) {
      let value;
      try {
        const expr = "(() => {const e=document.querySelector('[data-scroll-root]');" +
          "if(!e)return {missing:true}; const before=e.scrollTop;" +
          "e.scrollTop+=" + direction + "*Math.max(240,e.clientHeight*.65);" +
          "return {before,after:e.scrollTop,height:e.scrollHeight,viewport:e.clientHeight};})()";
        const r = await cdp.send('Runtime.evaluate', {expression: expr, returnByValue: true}, sid);
        value = r.result?.value || {};
      } catch (e) {record({kind:'sweep.command-failed',reason:e.message});break;}
      record({kind:'sweep.step',direction,...value});
      if (value.missing) break;
      stable = value.before === value.after ? stable + 1 : 0;
      await pause(350);
      if (onSample && step % 3 === 0) await onSample();
      if (stable >= 5) break;
    }
  }
  await pause(1200);
  if (onSample) await onSample();
  record({kind: 'sweep.finished'});
  return {ready:true};
}

async function run(args) {
  const [url, outputName, ...rawFlags] = args;
  const mathIndex = rawFlags.indexOf('--compare-live-katex');
  const mathFile = mathIndex < 0 ? null : rawFlags[mathIndex + 1];
  const sansMath = mathIndex < 0 ? rawFlags : rawFlags.filter((_,i) =>
    i !== mathIndex && i !== mathIndex + 1);
  const offlineIndex = sansMath.indexOf('--offline-output');
  const offlineDir = offlineIndex < 0 ? null : sansMath[offlineIndex + 1];
  const flags = offlineIndex < 0 ? sansMath : sansMath.filter((_,i) =>
    i !== offlineIndex && i !== offlineIndex + 1);
  if (!url || !outputName ||
      (mathIndex >= 0 && (!mathFile || !flags.includes('--sweep'))) ||
      (offlineIndex >= 0 && (offlineIndex !== sansMath.length - 2 || !offlineDir ||
        !flags.includes('--sweep') || !flags.includes('--capture-image-bodies'))) ||
      flags.some(x => !['--headless','--sweep','--compare-image-urls','--capture-image-bodies'].includes(x))) {
    process.stderr.write('Usage: node render-probe.mjs <url> <output-dir> [--sweep] [--headless] [--compare-image-urls] [--capture-image-bodies] [--offline-output <new-dir>] [--compare-live-katex <reading-index.html>]\n');
    return 2;
  }
  const parsed = new URL(url);
  if (!['http:','https:'].includes(parsed.protocol)) throw Error('HTTP(S) URL required');
  const output = path.resolve(outputName);
  if (offlineDir && (fs.existsSync(path.resolve(offlineDir)) ||
      path.resolve(offlineDir) === output ||
      path.resolve(offlineDir).startsWith(output + path.sep)))
    throw Error('Offline output must be a new directory outside the capture');
  const log = recording(output);
  const profile = path.join(output, 'profile');
  fs.mkdirSync(profile, {mode: 0o700});
  const browser = spawn('chromium', ['--user-data-dir=' + profile,
    '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
    '--no-first-run','--no-default-browser-check',
    ...(flags.includes('--headless') ? ['--headless=new'] : []),
    '--new-window','about:blank'], {stdio: ['ignore','ignore','pipe']});
  browser.stderr.on('data', () => {});
  const browserExited = new Promise(resolve => browser.once('exit', resolve));
  let cdp, closing;
  async function stop(reason) {
    if (closing) return closing;
    closing = (async () => {
      log.record({kind:'session.stop',reason});
      if (cdp && !cdp.closed) {
        await cdp.drainImageBodies();
        try {await cdp.send('Browser.close', {}, undefined, 1000);} catch {}
      }
      if (browser.exitCode === null && browser.signalCode === null) {
        browser.kill('SIGTERM'); await Promise.race([browserExited, pause(1500)]);
      }
      if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
      return log.finish();
    })();
    return closing;
  }
  const signal = () => {void stop('signal');};
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    const portFile = path.join(profile,'DevToolsActivePort');
    const startupLimit = performance.now() + 45000;
    while (!fs.existsSync(portFile) && performance.now() < startupLimit &&
        browser.exitCode === null && browser.signalCode === null)
      await pause(75);
    if (!fs.existsSync(portFile)) {
      const state = browser.exitCode !== null ? 'exit-code-' + browser.exitCode :
        browser.signalCode ? 'signal-' + browser.signalCode : 'startup-timeout';
      log.record({kind:'browser.startup-failed',state});
      throw Error('Chromium did not publish its CDP port (' + state + ')');
    }
    const [port, endpoint] = fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
    cdp = new Cdp('ws://127.0.0.1:' + port + endpoint, log.record,
      flags.includes('--compare-image-urls') || flags.includes('--capture-image-bodies'),
      flags.includes('--capture-image-bodies') ? log.storeImage : null);
    await cdp.connect();
    await cdp.send('Target.setDiscoverTargets', {discover:true});
    await cdp.send('Target.setAutoAttach', {autoAttach:true,
      waitForDebuggerOnStart:true, flatten:true});
    const {targetId} = await cdp.send('Target.createTarget', {url:'about:blank'});
    const attachLimit = performance.now() + 20000;
    while (!cdp.targetSessions.has(targetId) && performance.now() < attachLimit) await pause(30);
    const sid = cdp.targetSessions.get(targetId);
    if (!sid) throw Error('Target attach timeout');
    while (!cdp.sessions.get(sid)?.ready && performance.now() < attachLimit) await pause(30);
    if (!cdp.sessions.get(sid)?.ready) throw Error('Page instrumentation failed');
    void cdp.send('Page.navigate', {url: parsed.href}, sid, 120000)
      .then(result => log.record({kind:'navigation.result',error:result.errorText || null}))
      .catch(error => log.record({kind:'navigation.command-failed',reason:error.message}));
    log.record({kind:'session.ready'});
    process.stdout.write('DOM rendering observation active: ' + output + '\n');
    if (flags.includes('--sweep')) {
      let sourceMath = new Map(),sourceFaces={known:0,loaded:0,loading:0};
      let mathActions = null;
      if (mathFile) mathActions=await import('./inspect-katex-live-style.mjs');
      const sampleMath = mathFile ? async () => {
        try {
          const r=await cdp.send('Runtime.evaluate',{
            expression:mathActions.browserKatexExpression(),
            returnByValue:true
          },sid,25000);
          const data=r.result?.value;
          if (!data || !Array.isArray(data.turns))return;
          for(const turn of data.turns) {
            const before=sourceMath.get(turn.ordinal);
            // Prefer the fullest mounted turn, but re-sample it once
            // the browser has completed loading fonts to avoid comparing
            // an early fallback-font frame with a settled offline page.
            if(!before || turn.math.length>before.math.length ||
                (turn.math.length===before.math.length &&
                 data.fontFaces?.loading===0))
              sourceMath.set(turn.ordinal,turn);
          }
          if(data.fontFaces?.loaded>=sourceFaces.loaded)
            sourceFaces=data.fontFaces;
        }
        catch {log.record({kind:'katex.source-sample-unavailable'});}
      } : null;
      const observation=await sweep(cdp,sid,log.record,sampleMath);
      if (!observation.ready) {
        process.stdout.write(JSON.stringify(await stop('sweep-not-ready'))+'\n');
        process.stderr.write('Page not ready for turn extraction: missing expected DOM hooks; '+
          'check sanitized sweep.not-ready pageShape in private events.jsonl.\n');
        return 3;
      }
      if (offlineDir) {
        const {renderSameSessionOffline} = await import('./render-same-session-offline.mjs');
        process.stdout.write(JSON.stringify(renderSameSessionOffline(output,offlineDir),null,2)+'\n');
      }
      if (mathFile) {
        const target=path.resolve(mathFile);
        if (!fs.existsSync(target)||!fs.statSync(target).isFile())
          throw Error('KaTeX reference offline HTML not found');
        const nav=await cdp.send('Page.navigate',
          {url:pathToFileURL(target).href},sid,30000);
        if (nav.errorText) throw Error('Cannot open local KaTeX reference HTML');
        let metrics=null;
        for(let i=0;i<40;i++) {
          await pause(300);
          const r=await cdp.send('Runtime.evaluate',{
            expression:mathActions.browserKatexExpression(),returnByValue:true
          },sid,25000);
          const candidate=r.result?.value;
          if (candidate?.turns?.length) {
            metrics=candidate;
            if(candidate.fontFaces?.loading===0)break;
          }
        }
        if(!metrics)throw Error('Offline KaTeX reference did not render');
        const verdict=mathActions.compareLiveAndOfflineMath({
          turns:[...sourceMath.values()],fontFaces:sourceFaces},metrics);
        process.stdout.write(JSON.stringify(verdict,null,2)+'\n');
      }
      process.stdout.write(JSON.stringify(await stop('sweep-finished'))+'\n');
    } else {
      process.stdout.write('Use the browser; press Ctrl+C to finish.\n');
      await Promise.race([browserExited, new Promise(resolve => {
        process.once('SIGINT',resolve);process.once('SIGTERM',resolve);
      })]);
      process.stdout.write(JSON.stringify(await stop('user-finished')) + '\n');
    }
    return 0;
  } catch (error) {
    log.record({kind:'session.error',reason:error.message});
    await stop('failure');
    throw error;
  }
}

run(process.argv.slice(2)).then(status => {process.exitCode = status;},
  error => {process.stderr.write(error.message + '\n');process.exitCode = 1;});
