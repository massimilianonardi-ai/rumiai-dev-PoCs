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
  constructor(url, report, captureImageUrls = false, storeImage = null, storeStatic = null) {
    this.url = url; this.report = report; this.pending = new Map();
    this.storeImage = storeImage;
    this.storeStatic = storeStatic;
    this.staticResponses = new Map();
    this.imageResponses = new Map();
    this.imageBodyJobs = new Set();
    // One CDP session for DOM and network; signed URLs remain private.
    this.captureImageUrls = captureImageUrls;
    this.networkRequests = new Map();
    this.sessions = new Map(); this.targetSessions = new Map();
    this.nextId = 0; this.closed = false;
    this.blockRequests = false;
    this.blockedRequestEvents = [];
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
    if (method === 'Fetch.requestPaused') {
      // Fail closed for the explicit source-card action probe. Never allow a
      // paused request to continue, even while shutting down the capture.
      if (this.blockRequests && this.blockedRequestEvents.length < 80) {
        const url=params.request?.url;
        if(typeof url==='string' && url.startsWith('https://'))
          this.blockedRequestEvents.push({url,resourceType:params.resourceType||null});
      }
      void this.send('Fetch.failRequest',
        {requestId:params.requestId,errorReason:'BlockedByClient'},sessionId,3000)
        .catch(()=>{});
    } else if (method === 'Target.attachedToTarget') {
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
    } else if ((this.storeImage || this.storeStatic) && method === 'Network.loadingFinished') {
      const key = JSON.stringify([sessionId, params.requestId]);
      const response = this.imageResponses.get(key);
      this.imageResponses.delete(key);
      const staticResponse = this.staticResponses.get(key);
      this.staticResponses.delete(key);
      if (staticResponse) {
        const job = this.readStaticBody(staticResponse);
        this.imageBodyJobs.add(job);
        void job.finally(() => this.imageBodyJobs.delete(job));
      }
      if (response) {
        const job = this.readImageBody(response);
        this.imageBodyJobs.add(job);
        void job.finally(() => this.imageBodyJobs.delete(job));
      }
    } else if ((this.storeImage || this.storeStatic) && method === 'Network.loadingFailed') {
      const key = JSON.stringify([sessionId, params.requestId]);
      const response = this.imageResponses.get(key);
      this.imageResponses.delete(key);
      this.staticResponses.delete(key);
      if (response) this.report({kind: 'network.image-body',
        requestId: response.requestId, status: 'loading-failed'}, response.sessionId);
    } else if (this.captureImageUrls && method === 'Network.responseReceived') {
      const mime = String(params.response?.mimeType || '').toLowerCase();
      if (this.storeStatic && (params.type === 'Stylesheet' ||
          params.type === 'Font' || params.type === 'Document')) {
        this.staticResponses.set(JSON.stringify([sessionId,params.requestId]),{
          sessionId,requestId:params.requestId,mime,status:params.response?.status,
          resourceType:params.type,url:params.response?.url
        });
      }
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
  async readStaticBody(response) {
    const detail={kind:'network.static-body',resourceType:response.resourceType};
    try {
      if (!(response.status>=200 && response.status<300)) {
        this.report({...detail,status:'http-status-not-success'},response.sessionId);
        return;
      }
      const body=await this.send('Network.getResponseBody',
        {requestId:response.requestId},response.sessionId,12000);
      const bytes=body.base64Encoded ? Buffer.from(body.body||'','base64') :
        Buffer.from(body.body||'','utf8');
      const result=this.storeStatic(response,bytes);
      this.report({...detail,...result},response.sessionId);
    } catch {
      this.report({...detail,status:'body-unavailable'},response.sessionId);
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
    const guardedNewTarget=this.blockRequests &&
      sid!==this.primarySessionId && (type==='page' || type==='iframe');
    let guardInstalled=false;
    try {
      await this.send('Runtime.enable', {}, sid);
      if (type === 'page' || type === 'iframe') {
        await this.send('Page.enable', {}, sid);
        // Target auto-attach pauses new pages before any script can run.
        // Install the same fail-closed Fetch guard in every popup target
        // before resuming its debugger.
        if (guardedNewTarget) {
          await this.send('Fetch.enable',{
            patterns:[{urlPattern:'*',requestStage:'Request'}]},sid,7000);
          guardInstalled=true;
        }
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
    finally {
      if(guardedNewTarget && !guardInstalled) {
        // Never resume a newly opened target without the network guard.
        const targetId=[...this.targetSessions.entries()]
          .find(([,session])=>session===sid)?.[0];
        if(targetId){
          try{await this.send('Target.closeTarget',{targetId},undefined,3000);}
          catch{this.report({kind:'interaction.popup-guard-close-failed'},sid);}
        }
        return;
      }
      try{await this.send('Runtime.runIfWaitingForDebugger',{},sid,3000);}
      catch{}
    }
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
  let staticBytesTotal=0;
  const staticFiles=new Set();
  function storeStatic(response,bytes) {
    const mime=response.mime.split(';')[0].trim();
    const ext=response.resourceType==='Stylesheet' && mime==='text/css' ? 'css' :
      response.resourceType==='Font' && (mime==='font/woff2' ||
      mime==='application/octet-stream') && bytes.toString('ascii',0,4)==='wOF2' ? 'woff2' :
      response.resourceType==='Document' && mime==='text/html' ? 'html' : null;
    if (!ext) return {status:'mime-unsupported'};
    const maxBytes=ext==='html'?24*1024*1024:8*1024*1024;
    if (!bytes.length || bytes.length>maxBytes)
      return {status:'body-invalid-or-too-large'};
    const digest=sha(bytes),name='static/'+digest+'.'+ext;
    if ((!staticFiles.has(name) && staticFiles.size>=128) ||
      (!staticFiles.has(name) && staticBytesTotal+bytes.length>48*1024*1024))
      return {status:'capture-limit'};
    fs.mkdirSync(path.join(directory,'static'),{recursive:true,mode:0o700});
    if (!staticFiles.has(name)) {
      fs.writeFileSync(path.join(directory,name),bytes,{flag:'wx',mode:0o600});
      staticFiles.add(name);
      staticBytesTotal+=bytes.length;
    }
    return {status:'saved',file:name,sha256:digest,bytes:bytes.length,
      mimeType:mime,originalUrl:response.url};
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
  return {record, finish, storeImage, storeStatic};
}

async function sweep(cdp, sid, record, onSample = null, onProgress = null,
    shouldStop = () => false, preserveSweepCursor = false) {
  // Interactive source-card tests may call scrollIntoView on their popup
  // trigger. Keep that side-effect from moving the virtualized sweep cursor.
  async function sampleWithoutMovingCursor(cursor)
  {
    if(!onSample)return;
    await onSample();
    if(!preserveSweepCursor || !Number.isFinite(cursor))return;
    const expr="(() => {const e=document.querySelector('[data-scroll-root]');"+
      "if(!e)return {missing:true};e.scrollTop="+JSON.stringify(cursor)+
      ";return {restored:e.scrollTop};})()";
    await cdp.send('Runtime.evaluate',{expression:expr,returnByValue:true},sid,7000);
    await pause(80);
  }
  // Only actual scrollTop changes can cause native intersection recalculation.
  let ready = false;
  const limit = performance.now() + 120000;
  let lastReadyUpdate=0;
  while (!cdp.closed && !shouldStop() && performance.now() < limit) {
    if(onProgress && performance.now()-lastReadyUpdate>10000) {
      lastReadyUpdate=performance.now();
      onProgress('attesa struttura conversazione');
    }
    try {
      const r = await cdp.send('Runtime.evaluate', {expression:
        "!!(document.querySelector('[data-scroll-root]') && " +
        "document.querySelector('[data-turn-id-container]'))", returnByValue: true}, sid);
      if (r.result?.value === true) {ready = true;break;}
    } catch {}
    await pause(500);
  }
  if(shouldStop())return {ready:false,interrupted:true};
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
  if(onProgress)onProgress('struttura pronta; avvio scorrimento');
  let initialCursor=null;
  if(preserveSweepCursor)
  {
    const row=await cdp.send('Runtime.evaluate',{
      expression:"document.querySelector('[data-scroll-root]')?.scrollTop",
      returnByValue:true},sid,7000);
    initialCursor=Number(row.result?.value);
  }
  await sampleWithoutMovingCursor(initialCursor);
  if(shouldStop())return {ready:false,interrupted:true};
  const deadline=performance.now()+360000;
  for (const direction of [1, -1]) {
    let stable = 0;
    if(onProgress)onProgress('scorrimento '+(direction===1?'avanti':'indietro'));
    for (let step = 0; step < 2000 && !cdp.closed &&
        !shouldStop() && performance.now()<deadline; step++) {
      if(onProgress && step>0 && step%15===0)
        onProgress('scorrimento '+(direction===1?'avanti':'indietro')+
          ': '+step+' passi');
      let value;
      try {
        const expr = "(() => {const e=document.querySelector('[data-scroll-root]');" +
          "if(!e)return {missing:true}; const before=e.scrollTop;" +
          // Move less than one viewport to keep each virtualized region
          // observable on consecutive samples; long chats need fewer steps.
          "const stride=Math.max(1,Math.floor(e.clientHeight*.85));" +
          "e.scrollTop+=" + direction + "*stride;" +
          "return {before,after:e.scrollTop,height:e.scrollHeight,viewport:e.clientHeight};})()";
        const r = await cdp.send('Runtime.evaluate', {expression: expr, returnByValue: true}, sid);
        value = r.result?.value || {};
      } catch (e) {record({kind:'sweep.command-failed',reason:e.message});break;}
      record({kind:'sweep.step',direction,...value});
      if (value.missing) break;
      stable = value.before === value.after ? stable + 1 : 0;
      // Allow native intersection and React frame updates without making
      // very long public conversations hit the bounded sweep deadline.
      await pause(220);
      await sampleWithoutMovingCursor(value.after);
      if (stable >= 5) break;
    }
  }
  if(shouldStop())return {ready:false,interrupted:true};
  if(cdp.closed) {
    record({kind:'sweep.browser-disconnected'});
    return {ready:false,disconnected:true};
  }
  if(performance.now()>=deadline) {
    record({kind:'sweep.timeout',deadlineMs:360000});
    return {ready:false,timedOut:true};
  }
  await pause(1200);
  await sampleWithoutMovingCursor(null);
  if(shouldStop())return {ready:false,interrupted:true};
  record({kind: 'sweep.finished'});
  return {ready:true};
}

async function run(args) {
  const [url, outputName, ...rawFlags] = args;
  const readinessOnly=rawFlags.includes('--readiness-only');
  const captureStatic=rawFlags.includes('--capture-static-bodies');
  const observeInteractions=rawFlags.includes('--observe-interactions');
  const sourceCardActions=rawFlags.includes('--probe-source-card-actions');
  const trustedSourceCardActions=rawFlags.includes('--probe-trusted-source-card-actions');
  const remainingControlsProbe=rawFlags.includes('--probe-remaining-controls');
  const sourceGroupPositions=rawFlags.flatMap((flag,i)=>
    flag==='--source-group'?[i]:[]);
  const sourceGroupPosition=sourceGroupPositions[0]??-1;
  const sourceGroupValue=sourceGroupPosition>=0?
    rawFlags[sourceGroupPosition+1]:null;
  const sourceGroupMatch=typeof sourceGroupValue==='string'?
    /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(sourceGroupValue):null;
  const targetSourceGroup=sourceGroupMatch?
    {ordinal:Number(sourceGroupMatch[1]),index:Number(sourceGroupMatch[2])}:null;
  const sourceGroupValid=targetSourceGroup &&
    Number.isSafeInteger(targetSourceGroup.ordinal) &&
    Number.isSafeInteger(targetSourceGroup.index) &&
    targetSourceGroup.ordinal<=10000 && targetSourceGroup.index<=40;
  const withoutSourceGroup=sourceGroupPosition<0?rawFlags:
    rawFlags.filter((_,i)=>i!==sourceGroupPosition && i!==sourceGroupPosition+1);
  const mathIndex = withoutSourceGroup.indexOf('--compare-live-katex');
  const mathFile = mathIndex < 0 ? null : withoutSourceGroup[mathIndex + 1];
  const sansMath = mathIndex < 0 ? withoutSourceGroup :
    withoutSourceGroup.filter((_,i) => i !== mathIndex && i !== mathIndex + 1);
  const offlineIndex = sansMath.indexOf('--offline-output');
  const offlineDir = offlineIndex < 0 ? null : sansMath[offlineIndex + 1];
  const flags = offlineIndex < 0 ? sansMath : sansMath.filter((_,i) =>
    i !== offlineIndex && i !== offlineIndex + 1);
  if (!url || !outputName ||
      (mathIndex >= 0 && (!mathFile || !flags.includes('--sweep'))) ||
      (observeInteractions && !flags.includes('--sweep')) ||
      (sourceCardActions && (!observeInteractions || !flags.includes('--sweep'))) ||
      (trustedSourceCardActions && (!observeInteractions || !flags.includes('--sweep'))) ||
      (remainingControlsProbe && (!observeInteractions ||
        !flags.includes('--sweep') || !flags.includes('--headless'))) ||
      (sourceCardActions && trustedSourceCardActions) ||
      (remainingControlsProbe && (sourceCardActions || trustedSourceCardActions ||
        sourceGroupPosition>=0 || mathIndex>=0 || offlineIndex>=0)) ||
      (sourceGroupPositions.length>1) ||
      (sourceGroupPosition>=0 && (!trustedSourceCardActions || !sourceGroupValid)) ||
      (readinessOnly && (flags.some(x=>x!=='--headless' &&
        x!=='--readiness-only') || mathIndex>=0 || offlineIndex>=0)) ||
      (offlineIndex >= 0 && (offlineIndex !== sansMath.length - 2 || !offlineDir ||
        !flags.includes('--sweep') || !flags.includes('--capture-image-bodies'))) ||
      flags.some(x => !['--headless','--sweep','--compare-image-urls','--capture-image-bodies','--capture-static-bodies','--observe-interactions','--probe-source-card-actions','--probe-trusted-source-card-actions','--probe-remaining-controls','--readiness-only'].includes(x))) {
    process.stderr.write('Usage: node render-probe.mjs <url> <output-dir> [--sweep] [--headless] [--compare-image-urls] [--capture-image-bodies] [--capture-static-bodies] [--observe-interactions] [--probe-source-card-actions] [--probe-trusted-source-card-actions] [--probe-remaining-controls] [--source-group <ordinal:index>] [--offline-output <new-dir>] [--compare-live-katex <reading-index.html>] [--readiness-only]\n');
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
  let phase='avvio Chromium',heartbeat=null,interrupted=false;
  const progress=message=>{
    if (!mathFile)return;
    phase=message;
    process.stderr.write('[KaTeX] '+message+'\n');
  };
  if(mathFile) {
    progress('avvio Chromium');
    heartbeat=setInterval(()=>{
      if(!interrupted && !closing)
        process.stderr.write('[KaTeX] ancora in corso: '+phase+'\n');
    },10000);
    heartbeat.unref();
  }
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
  const signal = () => {
    interrupted=true;
    if(mathFile) {
      progress('interruzione richiesta; chiusura sessione');
      if(cdp?.ws?.readyState===WebSocket.OPEN)cdp.ws.close();
    }
    else void stop('signal');
  };
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
      flags.includes('--compare-image-urls') || flags.includes('--capture-image-bodies') || captureStatic,
      flags.includes('--capture-image-bodies') ? log.storeImage : null,
      captureStatic ? log.storeStatic : null);
    await cdp.connect();
    await cdp.send('Target.setDiscoverTargets', {discover:true});
    await cdp.send('Target.setAutoAttach', {autoAttach:true,
      waitForDebuggerOnStart:true, flatten:true});
    const {targetId} = await cdp.send('Target.createTarget', {url:'about:blank'});
    const attachLimit = performance.now() + 20000;
    while (!cdp.targetSessions.has(targetId) && performance.now() < attachLimit) await pause(30);
    const sid = cdp.targetSessions.get(targetId);
    if (!sid) throw Error('Target attach timeout');
    cdp.primarySessionId=sid;
    while (!cdp.sessions.get(sid)?.ready && performance.now() < attachLimit) await pause(30);
    if (!cdp.sessions.get(sid)?.ready) throw Error('Page instrumentation failed');
    const navigation = cdp.send('Page.navigate', {url: parsed.href}, sid,
      readinessOnly ? 30000 : 120000)
      .then(result => {
        const failed=!!result.errorText;
        log.record({kind:'navigation.result',error:result.errorText || null});
        return failed ? 'error' : 'no-error';
      })
      .catch(error => {
        log.record({kind:'navigation.command-failed',reason:error.message});
        return 'failed';
      });
    log.record({kind:'session.ready'});
    process.stdout.write('DOM rendering observation active: ' + output + '\n');
    if (readinessOnly) {
      const {liveReadinessExpression,summarizeLiveReadiness}=
        await import('./inspect-live-readiness.mjs');
      const navigationState=await navigation;
      const start=performance.now(),deadline=start+30000;
      const samples=[];
      let consecutiveReady=0;
      process.stderr.write('[Readiness] osservazione DOM in corso (max 30 s)\n');
      while(!interrupted && !cdp.closed && performance.now()<deadline) {
        try {
          const row=await cdp.send('Runtime.evaluate',{
            expression:liveReadinessExpression,returnByValue:true
          },sid,5000);
          const value=row.result?.value;
          if(value && typeof value==='object'){
            samples.push(value);
            if(value.hasScrollRoot && value.turnWrappers>0)consecutiveReady++;
            else consecutiveReady=0;
            if(consecutiveReady>=2)break;
          }
        }catch{
          log.record({kind:'readiness.dom-evaluation-unavailable'});
        }
        await pause(1000);
      }
      if(interrupted){
        await stop('signal');
        return 130;
      }
      const report=summarizeLiveReadiness(samples,navigationState);
      log.record({kind:'readiness.observed',classification:report.classification,
        validSamples:report.validSamples,initialShape:report.initialShape,
        finalShape:report.finalShape});
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
      process.stdout.write(JSON.stringify(await stop('readiness-observed'))+'\n');
      return report.validSamples>0?0:4;
    }
    if (flags.includes('--sweep')) {
      let sourceMath = new Map(),sourceFaces={known:0,loaded:0,loading:0};
      let sampleCalls=0,sampleFailures=0;
      let mathActions = null;
      if (mathFile) mathActions=await import('./inspect-katex-live-style.mjs');
      const sampleMath = mathFile ? async () => {
        if(interrupted)return;
        sampleCalls++;
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
        catch {
          sampleFailures++;
          if(!interrupted) log.record({kind:'katex.source-sample-unavailable'});
        }
      } : null;
      const interactionModule=observeInteractions ?
        await import('./inspect-live-share-interactions.mjs') : null;
      const sourceCardModule=sourceCardActions ?
        await import('./inspect-source-card-actions.mjs') : null;
      const trustedCardModule=trustedSourceCardActions ?
        await import('./inspect-trusted-source-cards.mjs') : null;
      const remainingControlsModule=remainingControlsProbe?
        await import('./inspect-remaining-controls.mjs'):null;
      const sampleLive=(interactionModule || sampleMath) ? async () => {
        if(remainingControlsModule)
          await remainingControlsModule.probeRemainingControls(cdp,sid,log.record);
        else if (interactionModule)
          await interactionModule.sampleLiveShareInteractions(cdp,sid,log.record,
            sourceCardModule ? sourceCardModule.probeSourceCardIntent :
            trustedCardModule ? trustedCardModule.probeTrustedSourceGroup : null,
            trustedSourceCardActions,targetSourceGroup);
        if (sampleMath) await sampleMath();
      } : null;
      const observation=await sweep(cdp,sid,log.record,sampleLive,
        mathFile ? progress : null,()=>interrupted,
        trustedSourceCardActions||remainingControlsProbe);
      if(observation.interrupted || interrupted) {
        progress('interrotto; le misure non sono state completate');
        process.stdout.write(JSON.stringify(await stop('signal'))+'\n');
        return 130;
      }
      if (!observation.ready) {
        const reason=observation.timedOut?'sweep-timeout':
          observation.disconnected?'sweep-browser-disconnected':'sweep-not-ready';
        process.stdout.write(JSON.stringify(await stop(reason))+'\n');
        if(observation.timedOut){
          process.stderr.write('Conversation sweep exceeded the bounded scroll deadline; '+
            'check private sweep.step progress and sweep.timeout evidence.\n');
          return 5;
        }
        if(observation.disconnected){
          process.stderr.write('Browser disconnected during conversation sweep.\n');
          return 6;
        }
        process.stderr.write('Page not ready for turn extraction: missing expected DOM hooks; '+
          'check sanitized sweep.not-ready pageShape in private events.jsonl.\n');
        return 3;
      }
      if (offlineDir) {
        const {renderSameSessionOffline} = await import('./render-same-session-offline.mjs');
        process.stdout.write(JSON.stringify(renderSameSessionOffline(output,offlineDir),null,2)+'\n');
      }
      if (mathFile) {
        progress('sorgente rilevata: '+sourceMath.size+
          ' turni con formule; campionamenti '+sampleCalls+
          ', errori '+sampleFailures);
        if(!sourceMath.size) {
          process.stderr.write('[KaTeX] nessuna formula osservata nella sorgente\n');
        }
        progress('apertura HTML offline e confronto font/layout');
        const target=path.resolve(mathFile);
        if (!fs.existsSync(target)||!fs.statSync(target).isFile())
          throw Error('KaTeX reference offline HTML not found');
        const nav=await cdp.send('Page.navigate',
          {url:pathToFileURL(target).href},sid,30000);
        if (nav.errorText) throw Error('Cannot open local KaTeX reference HTML');
        let metrics=null;
        for(let i=0;i<40 && !interrupted;i++) {
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
        if(interrupted) {
          process.stdout.write(JSON.stringify(await stop('signal'))+'\n');
          return 130;
        }
        if(!metrics)throw Error('Offline KaTeX reference did not render');
        const verdict=mathActions.compareLiveAndOfflineMath({
          turns:[...sourceMath.values()],fontFaces:sourceFaces},metrics);
        progress('confronto terminato');
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
    if(interrupted){
      progress('interrotto');
      await stop('signal');
      return 130;
    }
    log.record({kind:'session.error',reason:error.message});
    await stop('failure');
    throw error;
  } finally {
    if(heartbeat)clearInterval(heartbeat);
  }
}

run(process.argv.slice(2)).then(status => {process.exitCode = status;},
  error => {process.stderr.write(error.message + '\n');process.exitCode = 1;});
