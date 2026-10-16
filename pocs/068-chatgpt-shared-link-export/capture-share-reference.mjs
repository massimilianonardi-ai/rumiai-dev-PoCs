#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { shareUrl } from './snapshot-acquire.mjs';
import { webControl } from './export-share.mjs';
import { captureReferenceInteractions } from './reference-interactions.mjs';

const execFileAsync = promisify(execFile);
const entrypoint = fileURLToPath(import.meta.url);
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_SHARE_BYTES = 24 * 1024 * 1024;
const MAX_CANDIDATES = 96;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeLeaf(value) {
  return String(value || 'capture').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'capture';
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function allocateDirectory(root, shareId) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const base = stamp() + '-' + safeLeaf(shareId);
  for (let n = 0; n < 1000; n++) {
    const name = base + (n ? '-' + String(n + 1) : '');
    const directory = path.join(root, name);
    try {
      await fs.mkdir(directory, { mode: 0o700 });
      return directory;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('reference.capture-directory-exhausted');
}

async function ensureController(control) {
  if (control !== webControl) return;
  try {
    await webControl('status');
    return;
  } catch {}
  await execFileAsync('srv', ['start', 'web-control'], {
    timeout: 60000, maxBuffer: 1024 * 1024
  });
  await webControl('status');
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

function settleExpression() {
  return `(() => ({
    marker: 'page-reference-settle',
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    htmlLength: document.documentElement?.outerHTML?.length || 0,
    textLength: document.body?.innerText?.length || 0,
    imageCount: document.images?.length || 0,
    resourceCount: performance.getEntriesByType('resource').length,
    turnCount: document.querySelectorAll('[data-turn-key],[data-testid^="conversation-turn-"]').length
  }))()`;
}

async function waitForStablePage(send, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let previous = null;
  let stable = 0;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const response = await send('Runtime.evaluate', {
        expression: settleExpression(),
        returnByValue: true,
        silent: true
      });
      last = response?.result?.value || null;
      if (last && last.readyState !== 'loading') {
        const signature = JSON.stringify([
          last.href, last.title, last.htmlLength, last.textLength,
          last.imageCount, last.resourceCount, last.turnCount
        ]);
        stable = signature === previous ? stable + 1 : 0;
        previous = signature;
        if (stable >= 3) return last;
      }
    } catch {}
    await sleep(250);
  }
  return last;
}

function evidenceProbeExpression(kind) {
  return `(() => {
    const marker = 'page-reference-probe';
    const kind = ${JSON.stringify(kind)};
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height,
        top:r.top, right:r.right, bottom:r.bottom, left:r.left };
    };
    const attrs = element => element ? Object.fromEntries(
      [...element.attributes].map(a => [a.name, a.value])) : null;
    const context = element => {
      const turn = element.closest(
        '[data-turn-key],[data-testid^="conversation-turn-"],[data-message-id],' +
        '[data-chatgpt-selection-message-id],[data-chatgpt-search-message-ids]'
      );
      return turn ? { tag: turn.tagName.toLowerCase(), attributes: attrs(turn) } : null;
    };
    const splitSrcset = value => String(value || '').split(',').map(part =>
      part.trim().split(/\\s+/)[0]).filter(Boolean);

    if (kind === 'meta') return { marker, kind, value: {
      href: location.href, title: document.title, readyState: document.readyState,
      visibilityState: document.visibilityState, userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      document: {
        scrollWidth: document.documentElement?.scrollWidth || 0,
        scrollHeight: document.documentElement?.scrollHeight || 0
      }
    } };

    if (kind === 'html')
      return { marker, kind, value: document.documentElement?.outerHTML || '' };
    if (kind === 'text')
      return { marker, kind, value: document.body?.innerText || '' };

    if (kind === 'turns') return { marker, kind, value:
      [...document.querySelectorAll(
        '[data-turn-key],[data-testid^="conversation-turn-"]'
      )].map((node, index) => ({
        index, attributes: attrs(node), text: node.innerText || '', rect: rect(node)
      }))
    };

    if (kind === 'images') return { marker, kind, value:
      [...document.querySelectorAll('img')].map((img, index) => ({
        index, attributes: attrs(img), currentSrc: img.currentSrc || null,
        src: img.src || null, srcset: img.getAttribute('srcset'),
        alt: img.alt || null, complete: Boolean(img.complete),
        naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0,
        rect: rect(img), context: context(img),
        button: (() => {
          const button = img.closest('button');
          return button ? { attributes: attrs(button), text: button.innerText || '' } : null;
        })()
      }))
    };

    if (kind === 'sources') return { marker, kind, value:
      [...document.querySelectorAll('source')].map((node, index) => ({
        index, attributes: attrs(node), src: node.src || null,
        srcset: node.getAttribute('srcset'), context: context(node)
      }))
    };

    if (kind === 'links') return { marker, kind, value:
      [...document.querySelectorAll('a[href]')].map((node, index) => ({
        index, href: node.href, text: node.innerText || '',
        attributes: attrs(node), rect: rect(node), context: context(node)
      }))
    };

    if (kind === 'buttons') return { marker, kind, value:
      [...document.querySelectorAll('button')].map((node, index) => ({
        index, text: node.innerText || '', attributes: attrs(node),
        rect: rect(node), context: context(node)
      }))
    };

    if (kind === 'media') return { marker, kind, value:
      [...document.querySelectorAll('video,audio')].map((node, index) => ({
        index, tag: node.tagName.toLowerCase(), attributes: attrs(node),
        currentSrc: node.currentSrc || null, src: node.src || null,
        rect: rect(node), context: context(node)
      }))
    };

    if (kind === 'iframes') return { marker, kind, value:
      [...document.querySelectorAll('iframe')].map((node, index) => ({
        index, attributes: attrs(node), src: node.src || null,
        rect: rect(node), context: context(node)
      }))
    };

    if (kind === 'attributes') {
      const value = [];
      const attrPattern = /file|asset|attach|download|message|turn|testid|reference/i;
      const valuePattern = /sediment:\\/\\/|file[-_][A-Za-z0-9]+|blob:|download|attachment|\\.(?:md|pdf|png|jpe?g|webp|svg|zip|docx?|xlsx?|pptx?)(?:$|[?#])/i;
      for (const node of document.querySelectorAll('*')) {
        const selected = {};
        for (const attribute of node.attributes) {
          if (attrPattern.test(attribute.name) || valuePattern.test(attribute.value))
            selected[attribute.name] = attribute.value;
        }
        if (Object.keys(selected).length)
          value.push({ tag: node.tagName.toLowerCase(),
            attributes: selected, context: context(node) });
        if (value.length >= 5000) break;
      }
      return { marker, kind, value };
    }

    if (kind === 'resources') return { marker, kind, value:
      performance.getEntriesByType('resource').map((entry, index) => ({
        index, name: entry.name, initiatorType: entry.initiatorType,
        startTime: entry.startTime, duration: entry.duration,
        transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        nextHopProtocol: entry.nextHopProtocol || null,
        responseStatus: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null
      }))
    };

    if (kind === 'candidates') {
      const candidates = new Map();
      const add = (url, evidence) => {
        if (typeof url !== 'string' || !url) return;
        let item = candidates.get(url);
        if (!item) { item = { url, evidence: [] }; candidates.set(url, item); }
        item.evidence.push(evidence);
      };
      [...document.querySelectorAll('img')].forEach((img,index) => {
        add(img.currentSrc,{kind:'img-currentSrc',index});
        add(img.src,{kind:'img-src',index});
        for (const url of splitSrcset(img.getAttribute('srcset')))
          add(url,{kind:'img-srcset',index});
      });
      [...document.querySelectorAll('source')].forEach((node,index) => {
        add(node.src,{kind:'source-src',index});
        for (const url of splitSrcset(node.getAttribute('srcset')))
          add(url,{kind:'source-srcset',index});
      });
      [...document.querySelectorAll('a[href]')].forEach((node,index) => {
        const signal = [
          node.getAttribute('download') || '', node.innerText || '', node.href || '',
          node.getAttribute('aria-label') || '', node.getAttribute('data-testid') || ''
        ].join(' ');
        if (node.hasAttribute('download') ||
            /download|attachment|file_|\\.(?:png|jpe?g|webp|gif|svg|pdf|md|txt|zip|docx?|xlsx?|pptx?)(?:$|[?#])/i.test(signal))
          add(node.href,{kind:'link',index});
      });
      try {
        performance.getEntriesByType('resource').forEach((entry,index) => {
          if (entry.initiatorType === 'img')
            add(entry.name,{kind:'performance-img',index});
        });
      } catch {}
      return { marker, kind, value:[...candidates.values()] };
    }

    if (kind === 'svg-inventory') return { marker, kind, value:
      [...document.querySelectorAll('svg')].map((node,index) => ({
        index, attributes: attrs(node), rect: rect(node), context: context(node),
        outerHTMLLength: node.outerHTML.length
      }))
    };

    if (kind === 'canvas-inventory') return { marker, kind, value:
      [...document.querySelectorAll('canvas')].map((node,index) => ({
        index, width: node.width, height: node.height,
        attributes: attrs(node), rect: rect(node), context: context(node)
      }))
    };

    if (kind === 'inline-json-inventory') return { marker, kind, value:
      [...document.querySelectorAll('script[type="application/json"]')].map((node,index) => ({
        index, id: node.id || null, attributes: attrs(node),
        textLength: (node.textContent || '').length
      }))
    };

    return { marker, kind, unsupported:true, value:null };
  })()`;
}

function indexedBodyExpression(kind, index) {
  if (kind === 'svg') return `(() => {
    const node = document.querySelectorAll('svg')[${index}];
    return node ? { marker:'page-reference-body', kind:'svg',
      index:${index}, value:node.outerHTML } : null;
  })()`;
  if (kind === 'canvas') return `(() => {
    const node = document.querySelectorAll('canvas')[${index}];
    if (!node) return null;
    try { return { marker:'page-reference-body', kind:'canvas',
      index:${index}, value:node.toDataURL('image/png') }; }
    catch (cause) { return { marker:'page-reference-body', kind:'canvas',
      index:${index}, error:String(cause?.message || cause).slice(0,200) }; }
  })()`;
  if (kind === 'inline-json') return `(() => {
    const node = document.querySelectorAll('script[type="application/json"]')[${index}];
    return node ? { marker:'page-reference-body', kind:'inline-json',
      index:${index}, value:node.textContent || '' } : null;
  })()`;
  throw new Error('reference.unsupported-indexed-body');
}

async function runProbe(send, kind) {
  const response = await safeSend(send,'Runtime.evaluate',{
    expression:evidenceProbeExpression(kind),
    returnByValue:true, silent:true
  });
  if (!response.ok)
    return { ok:false, error:response.error || 'runtime-evaluate-failed' };
  const result = response.value?.result;
  const value = result?.value;
  if (!value || value.marker !== 'page-reference-probe' || value.kind !== kind)
    return { ok:false, error:'probe-result-unavailable',
      result_type:result?.type || null, result_subtype:result?.subtype || null,
      description:result?.description || null };
  return { ok:true, value:value.value };
}

async function runIndexedBody(send, kind, index) {
  const response = await safeSend(send,'Runtime.evaluate',{
    expression:indexedBodyExpression(kind,index),
    returnByValue:true, silent:true
  });
  if (!response.ok) return { ok:false, error:response.error || 'runtime-evaluate-failed' };
  const value = response.value?.result?.value;
  if (!value || value.marker !== 'page-reference-body')
    return { ok:false, error:'body-result-unavailable' };
  if (value.error) return { ok:false, error:value.error };
  return { ok:true, value:value.value };
}

function shareFetchExpression(shareId) {
  return `(async () => {
    const marker = 'page-reference-share-fetch';
    const result = [];
    for (const source of ['backend-anon','backend-api']) {
      const url = '/' + source + '/share/' + ${JSON.stringify(shareId)};
      try {
        const response = await fetch(url, {
          credentials: 'include', headers: { accept:'application/json' }
        });
        const text = await response.text();
        result.push({
          source, status: response.status,
          contentType: response.headers.get('content-type') || null,
          byteLength: new TextEncoder().encode(text).length,
          body: text.length <= ${MAX_SHARE_BYTES} ? text : null,
          tooLarge: text.length > ${MAX_SHARE_BYTES}
        });
      } catch (cause) {
        result.push({ source, status:null, failed:true,
          error:String(cause?.message || cause).slice(0,200) });
      }
    }
    return { marker, result };
  })()`;
}

function resourceFetchExpression(url) {
  return `(async () => {
    const marker = 'page-reference-resource-fetch';
    const input = ${JSON.stringify(url)};
    try {
      const parsed = new URL(input, location.href);
      const response = await fetch(parsed.href, {
        credentials: parsed.origin === location.origin ? 'include' : 'omit'
      });
      const buffer = await response.arrayBuffer();
      const out = {
        marker, status: response.status, finalUrl: response.url,
        redirected: response.redirected,
        contentType: response.headers.get('content-type') || null,
        contentDisposition: response.headers.get('content-disposition') || null,
        byteLength: buffer.byteLength
      };
      if (!response.ok || buffer.byteLength > ${MAX_BODY_BYTES}) {
        out.tooLarge = buffer.byteLength > ${MAX_BODY_BYTES};
        return out;
      }
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      out.base64 = btoa(binary);
      return out;
    } catch (cause) {
      return { marker, status:null, failed:true,
        error:String(cause?.message || cause).slice(0,200) };
    }
  })()`;
}

function extensionFor(contentType, url) {
  const type = String(contentType || '').toLowerCase().split(';')[0];
  const known = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg',
    'application/pdf': '.pdf', 'text/markdown': '.md', 'text/plain': '.txt',
    'application/json': '.json', 'text/html': '.html',
    'application/zip': '.zip'
  };
  if (known[type]) return known[type];
  try {
    const leaf = new URL(url).pathname.match(/(\.[A-Za-z0-9]{1,8})$/);
    if (leaf) return leaf[1].toLowerCase();
  } catch {}
  return '.bin';
}

async function safeSend(send, method, params = {}) {
  try { return { ok:true, value:await send(method, params) }; }
  catch (error) { return { ok:false, error:String(error?.message || error).slice(0,500) }; }
}

export async function captureReferencePage(inputUrl, outputRoot, options = {}) {
  const url = shareUrl(inputUrl);
  const shareId = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  const seconds = options.seconds ?? 8;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 60)
    throw new Error('reference.invalid-seconds: seconds must be 1..60');
  const control = options.controller || webControl;
  await ensureController(control);

  const directory = await allocateDirectory(path.resolve(outputRoot), shareId);
  let page = null, session = null;
  async function send(method, params = {}) {
    const response = await control(
      'debug','session','send',session,method,JSON.stringify(params)
    );
    return response.result;
  }

  try {
    const created = await control('page','new');
    page = created.id;
    if (!page) throw new Error('reference.page-create-failed');
    const opened = await control('debug','session','open',page);
    session = opened.session;
    if (!session) throw new Error('reference.debug-open-failed');

    await send('Page.navigate', { url });
    const settled = await waitForStablePage(send, seconds);

    let correctPage = false;
    try {
      const expected = new URL(url);
      const observed = new URL(settled?.href || '');
      const pathname = value => value.endsWith('/') ? value.slice(0,-1) : value;
      correctPage = observed.origin === expected.origin &&
        pathname(observed.pathname) === pathname(expected.pathname);
    } catch {}
    if (!correctPage) {
      const failure = {
        error:'reference.share-page-not-loaded',
        source:url,
        observed_url:settled?.href || null,
        title:settled?.title || null,
        turn_count:settled?.turnCount ?? null,
        captured_at:new Date().toISOString()
      };
      await writeJson(path.join(directory,'failure.json'),failure);
      throw new Error('reference.share-page-not-loaded: ' +
        (failure.observed_url || 'page URL unavailable'));
    }

    const probeKinds = [
      'meta','html','text','turns','images','sources','links','buttons',
      'media','iframes','attributes','resources','candidates',
      'svg-inventory','canvas-inventory','inline-json-inventory'
    ];
    const probes = {};
    const probeStatus = {};
    for (const kind of probeKinds) {
      const result = await runProbe(send,kind);
      probeStatus[kind] = result.ok
        ? { ok:true, type:Array.isArray(result.value) ? 'array' : typeof result.value,
            count:Array.isArray(result.value) ? result.value.length : null }
        : { ok:false, error:result.error, result_type:result.result_type || null,
            result_subtype:result.result_subtype || null,
            description:result.description || null };
      if (result.ok) probes[kind] = result.value;
      await writeJson(path.join(directory,'probe-' + safeLeaf(kind) + '.json'),
        result.ok ? { ok:true, value:result.value } : probeStatus[kind]);
    }

    if (typeof probes.html === 'string')
      await fs.writeFile(path.join(directory,'page.html'),probes.html,{mode:0o600});
    if (typeof probes.text === 'string')
      await fs.writeFile(path.join(directory,'page.txt'),probes.text,{mode:0o600});

    const elementEvidence = {
      meta:probes.meta || null,
      turns:Array.isArray(probes.turns) ? probes.turns : [],
      images:Array.isArray(probes.images) ? probes.images : [],
      sources:Array.isArray(probes.sources) ? probes.sources : [],
      links:Array.isArray(probes.links) ? probes.links : [],
      buttons:Array.isArray(probes.buttons) ? probes.buttons : [],
      media:Array.isArray(probes.media) ? probes.media : [],
      iframes:Array.isArray(probes.iframes) ? probes.iframes : [],
      interestingAttributes:Array.isArray(probes.attributes) ? probes.attributes : []
    };
    await writeJson(path.join(directory,'elements.json'),elementEvidence);
    await writeJson(path.join(directory,'resources.json'),
      Array.isArray(probes.resources) ? probes.resources : []);
    await writeJson(path.join(directory,'PROBES.json'),probeStatus);

    const inlineDir = path.join(directory,'inline-json');
    await fs.mkdir(inlineDir,{mode:0o700});
    const inlineManifest = [];
    for (const item of Array.isArray(probes['inline-json-inventory'])
      ? probes['inline-json-inventory'] : []) {
      const body = await runIndexedBody(send,'inline-json',item.index);
      let local = null, byteLength = null;
      if (body.ok && typeof body.value === 'string') {
        const file = String(item.index + 1).padStart(3,'0') + '.json.txt';
        await fs.writeFile(path.join(inlineDir,file),body.value,{mode:0o600});
        local = 'inline-json/' + file;
        byteLength = Buffer.byteLength(body.value);
      }
      inlineManifest.push({ ...item, local_path:local, byte_length:byteLength,
        capture_error:body.ok ? null : body.error });
    }
    await writeJson(path.join(directory,'inline-json.json'),inlineManifest);

    const svgDir = path.join(directory,'svg');
    await fs.mkdir(svgDir,{mode:0o700});
    const svgManifest = [];
    for (const item of Array.isArray(probes['svg-inventory'])
      ? probes['svg-inventory'] : []) {
      const body = await runIndexedBody(send,'svg',item.index);
      let local = null;
      if (body.ok && typeof body.value === 'string') {
        const file = String(item.index + 1).padStart(3,'0') + '.svg';
        await fs.writeFile(path.join(svgDir,file),body.value,{mode:0o600});
        local = 'svg/' + file;
      }
      svgManifest.push({ ...item, local_path:local,
        capture_error:body.ok ? null : body.error });
    }
    await writeJson(path.join(directory,'svg.json'),svgManifest);

    const canvasDir = path.join(directory,'canvas');
    await fs.mkdir(canvasDir,{mode:0o700});
    const canvasManifest = [];
    for (const item of Array.isArray(probes['canvas-inventory'])
      ? probes['canvas-inventory'] : []) {
      const body = await runIndexedBody(send,'canvas',item.index);
      let local = null;
      if (body.ok && typeof body.value === 'string' &&
          body.value.startsWith('data:image/png;base64,')) {
        const bytes = Buffer.from(
          body.value.slice('data:image/png;base64,'.length),'base64');
        const file = String(item.index + 1).padStart(3,'0') + '.png';
        await fs.writeFile(path.join(canvasDir,file),bytes,{mode:0o600});
        local = 'canvas/' + file;
      }
      canvasManifest.push({ ...item, local_path:local,
        capture_error:body.ok ? null : body.error });
    }
    await writeJson(path.join(directory,'canvas.json'),canvasManifest);

    const domSnapshot = await safeSend(send,'DOMSnapshot.captureSnapshot',{
      computedStyles:[], includePaintOrder:true, includeDOMRects:true
    });
    await writeJson(path.join(directory,'dom-snapshot.json'),domSnapshot);

    await safeSend(send,'Accessibility.enable');
    const accessibility = await safeSend(send,'Accessibility.getFullAXTree');
    await safeSend(send,'Accessibility.disable');
    await writeJson(path.join(directory,'accessibility-tree.json'),accessibility);

    const frameTree = await safeSend(send,'Page.getFrameTree');
    await writeJson(path.join(directory,'frame-tree.json'),frameTree);
    const layout = await safeSend(send,'Page.getLayoutMetrics');
    await writeJson(path.join(directory,'layout-metrics.json'),layout);

    const mhtml = await safeSend(send,'Page.captureSnapshot',{format:'mhtml'});
    if (mhtml.ok && typeof mhtml.value?.data === 'string')
      await fs.writeFile(path.join(directory,'page.mhtml'),mhtml.value.data,{mode:0o600});
    else await writeJson(path.join(directory,'page-mhtml-error.json'),mhtml);

    const screenshot = await safeSend(send,'Page.captureScreenshot',{
      format:'png', fromSurface:true, captureBeyondViewport:true
    });
    if (screenshot.ok && typeof screenshot.value?.data === 'string')
      await fs.writeFile(path.join(directory,'page.png'),
        Buffer.from(screenshot.value.data,'base64'),{mode:0o600});
    else await writeJson(path.join(directory,'page-screenshot-error.json'),screenshot);

    const rawShare = await send('Runtime.evaluate',{
      expression:shareFetchExpression(shareId),
      awaitPromise:true, returnByValue:true, silent:true
    });
    const shareResults = rawShare?.result?.value?.result || [];
    const shareManifest = [];
    for (const item of shareResults) {
      let local = null;
      if (typeof item.body === 'string') {
        const file = 'share-' + safeLeaf(item.source) + '.txt';
        await fs.writeFile(path.join(directory,file),item.body,{mode:0o600});
        local = file;
      }
      shareManifest.push({ ...item, body:undefined, local_path:local });
    }
    await writeJson(path.join(directory,'share-fetch.json'),shareManifest);

    const candidateDir = path.join(directory,'candidate-resources');
    await fs.mkdir(candidateDir,{mode:0o700});
    const candidateManifest = [];
    for (const [index,candidate] of (Array.isArray(probes.candidates)
      ? probes.candidates : []).slice(0,MAX_CANDIDATES).entries()) {
      const response = await send('Runtime.evaluate',{
        expression:resourceFetchExpression(candidate.url),
        awaitPromise:true, returnByValue:true, silent:true
      });
      const value = response?.result?.value || {};
      let local = null, digest = null;
      if (typeof value.base64 === 'string') {
        const bytes = Buffer.from(value.base64,'base64');
        digest = sha256(bytes);
        const file = String(index + 1).padStart(3,'0') +
          extensionFor(value.contentType,candidate.url);
        await fs.writeFile(path.join(candidateDir,file),bytes,{mode:0o600});
        local = 'candidate-resources/' + file;
      }
      candidateManifest.push({
        index, url:candidate.url, evidence:candidate.evidence,
        status:value.status ?? null, final_url:value.finalUrl ?? null,
        redirected:Boolean(value.redirected), content_type:value.contentType ?? null,
        content_disposition:value.contentDisposition ?? null,
        byte_length:value.byteLength ?? null, too_large:Boolean(value.tooLarge),
        failed:Boolean(value.failed), error:value.error ?? null,
        sha256:digest, local_path:local
      });
    }
    await writeJson(path.join(directory,'candidate-resources.json'),candidateManifest);

    let interactionEvidence;
    try {
      interactionEvidence = await captureReferenceInteractions(
        control,url,directory,{seconds}
      );
    } catch (error) {
      interactionEvidence = {
        inventory:[],selected:[],interactions:[],
        error:String(error?.message || error).slice(0,1000)
      };
      await writeJson(path.join(directory,'INTERACTIONS.json'),interactionEvidence);
    }

    const summary = {
      source:url, share_id:shareId, captured_at:new Date().toISOString(),
      settled,
      title:probes.meta?.title || null,
      final_url:probes.meta?.href || null,
      counts:{
        turns:Array.isArray(probes.turns) ? probes.turns.length : 0,
        images:Array.isArray(probes.images) ? probes.images.length : 0,
        sources:Array.isArray(probes.sources) ? probes.sources.length : 0,
        links:Array.isArray(probes.links) ? probes.links.length : 0,
        buttons:Array.isArray(probes.buttons) ? probes.buttons.length : 0,
        svg:Array.isArray(probes['svg-inventory']) ? probes['svg-inventory'].length : 0,
        canvas:Array.isArray(probes['canvas-inventory']) ? probes['canvas-inventory'].length : 0,
        resources:Array.isArray(probes.resources) ? probes.resources.length : 0,
        candidates:Array.isArray(probes.candidates) ? probes.candidates.length : 0,
        candidates_captured:candidateManifest.length,
        candidates_downloaded:candidateManifest.filter(x=>x.local_path).length,
        inline_json:Array.isArray(probes['inline-json-inventory'])
          ? probes['inline-json-inventory'].length : 0,
        probes_ok:Object.values(probeStatus).filter(x=>x.ok).length,
        probes_failed:Object.values(probeStatus).filter(x=>!x.ok).length,
        interaction_inventory:Array.isArray(interactionEvidence.inventory)
          ? interactionEvidence.inventory.length : 0,
        interactions_selected:Array.isArray(interactionEvidence.selected)
          ? interactionEvidence.selected.length : 0,
        interactions_complete:Array.isArray(interactionEvidence.interactions)
          ? interactionEvidence.interactions.filter(x=>x.status==='complete').length : 0
      },
      cdp:{
        dom_snapshot:domSnapshot.ok,
        accessibility_tree:accessibility.ok,
        frame_tree:frameTree.ok,
        layout_metrics:layout.ok,
        mhtml:mhtml.ok,
        screenshot:screenshot.ok
      }
    };
    await writeJson(path.join(directory,'SUMMARY.json'),summary);
    await fs.writeFile(path.join(directory,'README.txt'),
      'Diagnostic evidence captured directly from the public ChatGPT share page.\n' +
      'This directory may contain conversation content and temporary/signed resource URLs.\n' +
      'Do not commit it to GitHub. Share it only as intentional diagnostic evidence.\n' +
      'Cookies, localStorage, sessionStorage and authentication tokens are not captured.\n',
      {mode:0o600});

    return { directory, ...summary };
  } finally {
    if (session) await control('debug','session','close',session).catch(()=>{});
    if (page) await control('page','close',page).catch(()=>{});
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length < 1 || argv.length > 4 || argv.includes('--help')) {
    process.stderr.write(
      'usage: node capture-share-reference.mjs <https://chatgpt.com/share/id> ' +
      '[output-root] [--seconds N]\n'
    );
    return 2;
  }
  let seconds = 8;
  const secondsIndex = argv.indexOf('--seconds');
  if (secondsIndex >= 0) {
    seconds = Number(argv[secondsIndex + 1]);
    argv = argv.slice(0,secondsIndex);
  }
  const outputRoot = path.resolve(argv[1] || './reference-captures');
  process.umask(0o077);
  try {
    const result = await captureReferencePage(argv[0],outputRoot,{seconds});
    process.stdout.write(JSON.stringify(result,null,2) + '\n');
    return 0;
  } catch (error) {
    process.stderr.write(String(error?.message || error).split('\n')[0] + '\n');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === entrypoint)
  process.exitCode = await main();
