import { createHash } from 'node:crypto';
import { activeBranch, deriveTranscript, findSnapshot, parseSnapshot } from './snapshot-export.mjs';

const MAX_JSON_BYTES = 24 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;

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

function shareFetchExpression(shareId) {
  return `(async () => {
    const findSnapshot = ${findSnapshot.toString()};
    const attempts = [];
    for (const base of ['backend-anon', 'backend-api']) {
      try {
        const response = await fetch('/' + base + '/share/' +
          ${JSON.stringify(shareId)}, {
            credentials: 'include',
            headers: { accept: 'application/json' }
          });
        const attempt = { source: base, status: response.status };
        attempts.push(attempt);
        if (!response.ok) continue;
        const text = await response.text();
        if (text.length > ${MAX_JSON_BYTES}) {
          attempt.tooLarge = true;
          continue;
        }
        let value;
        try { value = JSON.parse(text); }
        catch {
          attempt.invalidJson = true;
          continue;
        }
        const snapshot = findSnapshot(value);
        if (snapshot)
          return { attempts, snapshot: JSON.stringify(snapshot) };
        attempt.noSnapshot = true;
      } catch {
        attempts.push({ source: base, status: null, failed: true });
      }
    }
    return { attempts, snapshot: null };
  })()`;
}

async function waitForShareDocument(send, deadline) {
  while (Date.now() < deadline) {
    try {
      const result = await send('Runtime.evaluate', {
        expression: "location.origin + '|' + document.readyState",
        returnByValue: true,
        silent: true
      });
      const value = result?.result?.value;
      if (typeof value === 'string' &&
          value.startsWith('https://chatgpt.com|') &&
          !value.endsWith('|loading')) return;
    } catch { /* Navigation can transiently replace the execution context. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function imageAssets(snapshot) {
  const transcript = deriveTranscript(snapshot);
  const classificationByNode = new Map(transcript.nodes.map(node =>
    [node.node_id, node.classification]));
  const assets = new Map();
  for (const [ordinal, id] of activeBranch(snapshot).entries()) {
    const msg = snapshot.mapping[id]?.message;
    const parts = msg?.content?.parts;
    if (!Array.isArray(parts)) continue;
    parts.forEach((part, partIndex) => {
      if (!part || typeof part !== 'object' ||
          part.content_type !== 'image_asset_pointer' ||
          typeof part.asset_pointer !== 'string' ||
          !part.asset_pointer.startsWith('sediment://')) return;
      const match = part.asset_pointer.match(/^sediment:\/\/(file[-_][A-Za-z0-9]+)/);
      if (!match) return;
      const fileId = match[1];
      let asset = assets.get(fileId);
      if (!asset) {
        asset = {
          asset_pointer: part.asset_pointer,
          asset_pointers: [],
          file_id: fileId,
          expected_size_bytes: Number.isSafeInteger(part.size_bytes) ? part.size_bytes : null,
          width: Number.isSafeInteger(part.width) ? part.width : null,
          height: Number.isSafeInteger(part.height) ? part.height : null,
          references: []
        };
        assets.set(fileId, asset);
      }
      if (!asset.asset_pointers.includes(part.asset_pointer))
        asset.asset_pointers.push(part.asset_pointer);
      asset.references.push({
        ordinal, node_id: id, message_id: msg.id ?? null,
        role: msg.author?.role ?? null, channel: msg.channel ?? null,
        content_type: msg.content?.content_type ?? null,
        classification: classificationByNode.get(id) ?? null,
        part_index: partIndex
      });
    });
  }
  return [...assets.values()];
}
function rendererImageExpression(assets) {
  const sizes = [...new Set(assets
    .filter(asset => Number.isSafeInteger(asset.expected_size_bytes))
    .map(asset => asset.expected_size_bytes))];
  return `(async () => {
    const expectedSizes = new Set(${JSON.stringify(sizes)});
    const urls = new Map();
    const add = (url, evidence) => {
      if (typeof url !== 'string' || !url) return;
      let item = urls.get(url);
      if (!item) {
        item = { url, evidence: [] };
        urls.set(url, item);
      }
      item.evidence.push(evidence);
    };
    const splitSrcset = value => String(value || '').split(',').map(part =>
      part.trim().split(/\\s+/)[0]).filter(Boolean);

    [...document.querySelectorAll('img')].forEach((img, occurrence) => {
      const evidence = {
        source: 'img', occurrence,
        complete: Boolean(img.complete),
        natural_width: Number.isSafeInteger(img.naturalWidth) ? img.naturalWidth : null,
        natural_height: Number.isSafeInteger(img.naturalHeight) ? img.naturalHeight : null,
        generated_preview: Boolean(img.closest('[data-testid="generated-image-preview"]')),
        button_aria_label: img.closest('button')?.getAttribute('aria-label') || null
      };
      add(img.currentSrc, evidence);
      add(img.src, evidence);
      for (const url of splitSrcset(img.getAttribute('srcset')))
        add(url, { ...evidence, source: 'img-srcset' });
    });
    [...document.querySelectorAll('source[srcset]')].forEach((node, occurrence) => {
      for (const url of splitSrcset(node.getAttribute('srcset')))
        add(url, { source: 'source-srcset', occurrence });
    });
    [...document.querySelectorAll('a[download][href]')].forEach((node, occurrence) =>
      add(node.href, { source: 'download-link', occurrence }));
    try {
      for (const entry of performance.getEntriesByType('resource')) {
        if (entry?.initiatorType === 'img')
          add(entry.name, { source: 'performance-img', occurrence: null });
      }
    } catch {}

    const result = [];
    for (const item of urls.values()) {
      const safe = {
        evidence: item.evidence,
        url_scheme: (() => { try { return new URL(item.url, location.href).protocol; }
          catch { return null; } })()
      };
      try {
        const parsed = new URL(item.url, location.href);
        const response = await fetch(parsed.href, {
          credentials: parsed.origin === location.origin ? 'include' : 'omit'
        });
        safe.status = response.status;
        safe.mimeType = response.headers.get('content-type') || null;
        if (!response.ok) {
          result.push(safe);
          continue;
        }
        const buffer = await response.arrayBuffer();
        safe.byteLength = buffer.byteLength;
        if (!expectedSizes.has(buffer.byteLength)) {
          safe.size_match = false;
          result.push(safe);
          continue;
        }
        safe.size_match = true;
        if (buffer.byteLength > ${MAX_ASSET_BYTES}) {
          safe.tooLarge = true;
          result.push(safe);
          continue;
        }
        const bytes = new Uint8Array(buffer);
        let binaryString = '';
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binaryString += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        safe.base64 = btoa(binaryString);
        result.push(safe);
      } catch {
        safe.failed = true;
        result.push(safe);
      }
    }
    return result;
  })()`;
}

function collapseRendererImages(items) {
  const unique = new Map();
  for (const item of items) {
    if (typeof item?.base64 !== 'string' || !Number.isSafeInteger(item?.byteLength)) continue;
    const bytes = Buffer.from(item.base64, 'base64');
    const digest = createHash('sha256').update(bytes).digest('hex');
    let found = unique.get(digest);
    if (!found) {
      found = { ...item, sha256: digest, occurrences: [] };
      unique.set(digest, found);
    }
    found.occurrences.push(...(Array.isArray(item.occurrences) ? item.occurrences : []));
  }
  return [...unique.values()];
}

function rendererImageProbeExpression() {
  return `(() => {
    const urls = new Set();
    const add = value => { if (typeof value === 'string' && value) urls.add(value); };
    const split = value => String(value || '').split(',').map(part =>
      part.trim().split(/\\s+/)[0]).filter(Boolean);
    for (const img of document.querySelectorAll('img')) {
      add(img.currentSrc); add(img.src);
      for (const url of split(img.getAttribute('srcset'))) add(url);
    }
    for (const node of document.querySelectorAll('source[srcset]'))
      for (const url of split(node.getAttribute('srcset'))) add(url);
    for (const node of document.querySelectorAll('a[download][href]')) add(node.href);
    try {
      for (const entry of performance.getEntriesByType('resource'))
        if (entry?.initiatorType === 'img') add(entry.name);
    } catch {}
    return { candidates: urls.size, images: document.images.length };
  })()`;
}

async function captureRendererImages(send, assets, deadline) {
  let resources = [];
  let observation = {
    attempted: 0, fetched: 0, failed: 0,
    size_matched: 0, size_mismatched: 0
  };
  while (Date.now() < deadline) {
    try {
      const response = await send('Runtime.evaluate', {
        expression: rendererImageExpression(assets),
        awaitPromise: true, returnByValue: true, silent: true
      });
      const value = response?.result?.value;
      if (Array.isArray(value)) {
        observation = {
          attempted: value.length,
          fetched: value.filter(item => Number.isSafeInteger(item?.status) &&
            item.status >= 200 && item.status < 300).length,
          failed: value.filter(item => item?.failed === true ||
            (Number.isSafeInteger(item?.status) &&
             (item.status < 200 || item.status >= 300))).length,
          size_matched: value.filter(item => item?.size_match === true).length,
          size_mismatched: value.filter(item => item?.size_match === false).length
        };
        resources = collapseRendererImages(value);
        if (resources.length >= assets.length) break;
      }
    } catch { /* Renderer may still be materializing image resources. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return { resources, observation };
}

function assetFetchExpression(asset, shareId) {
  return `(async () => {
    const attempts = [];
    try {
      const metadata = await fetch(
        '/backend-anon/files/download/' + ${JSON.stringify(asset.file_id)} +
        '?post_id=&shared_conversation_id=' + encodeURIComponent(${JSON.stringify(shareId)}) +
        '&inline=false&download_intent=false',
        { credentials: 'include', headers: { accept: 'application/json' } }
      );
      const attempt = { source: 'backend-anon', metadataStatus: metadata.status };
      attempts.push(attempt);
      if (!metadata.ok) return { attempts, base64: null };
      const contentType = metadata.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        attempt.directBinary = true;
        const buffer = await metadata.arrayBuffer();
        if (buffer.byteLength > ${MAX_ASSET_BYTES}) {
          attempt.tooLarge = true;
          return { attempts, base64: null };
        }
        const bytes = new Uint8Array(buffer);
        let binaryString = '';
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binaryString += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        attempt.binaryStatus = metadata.status;
        return {
          attempts, base64: btoa(binaryString), byteLength: bytes.length,
          mimeType: contentType || null, fileName: null
        };
      }
      let meta;
      try { meta = await metadata.json(); }
      catch {
        attempt.invalidJson = true;
        return { attempts, base64: null };
      }
      const url = meta?.download_url || meta?.metadata?.download_url;
      if (!url) {
        attempt.noDownloadUrl = true;
        return { attempts, base64: null };
      }
      try {
        const signed = new URL(url, location.origin);
        const binary = await fetch(signed.href, {
          credentials: signed.origin === location.origin ? 'include' : 'omit'
        });
        attempt.binaryStatus = binary.status;
        if (!binary.ok) return { attempts, base64: null };
        const buffer = await binary.arrayBuffer();
        if (buffer.byteLength > ${MAX_ASSET_BYTES}) {
          attempt.tooLarge = true;
          return { attempts, base64: null };
        }
        const bytes = new Uint8Array(buffer);
        let binaryString = '';
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binaryString += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        return {
          attempts, base64: btoa(binaryString), byteLength: bytes.length,
          mimeType: binary.headers.get('content-type') ||
            meta?.mime_type || meta?.metadata?.mime_type || null,
          fileName: meta?.file_name || meta?.metadata?.file_name || null
        };
      } catch {
        attempt.binaryFailed = true;
        return { attempts, base64: null };
      }
    } catch {
      attempts.push({ source: 'backend-anon', metadataStatus: null, failed: true });
      return { attempts, base64: null };
    }
  })()`;
}

function rendererMatch(asset, renderer) {
  return renderer.filter(item => {
    if (typeof item?.base64 !== 'string' || !Number.isSafeInteger(item?.byteLength)) return false;
    if (Number.isSafeInteger(asset.expected_size_bytes) &&
        item.byteLength !== asset.expected_size_bytes) return false;
    const occurrence = Array.isArray(item.occurrences) ? item.occurrences[0] : null;
    if (Number.isSafeInteger(asset.width) && Number.isSafeInteger(occurrence?.natural_width) &&
        occurrence.natural_width !== asset.width) return false;
    if (Number.isSafeInteger(asset.height) && Number.isSafeInteger(occurrence?.natural_height) &&
        occurrence.natural_height !== asset.height) return false;
    return true;
  });
}

async function captureImageAssets(send, snapshot, shareId, stats) {
  const assets = imageAssets(snapshot);
  try {
    const probe = await send('Runtime.evaluate', {
      expression: rendererImageProbeExpression(),
      returnByValue: true, silent: true
    });
    stats.rendererImageCandidates =
      Number.isSafeInteger(probe?.result?.value?.candidates) ? probe.result.value.candidates : 0;
  } catch {}
  const captured = await captureRendererImages(send, assets, Date.now() + 10000);
  const renderer = captured.resources;
  stats.rendererImageFetch = captured.observation;
  stats.rendererImageResources = renderer.length;
  stats.rendererImageOccurrences = renderer.reduce((n, item) =>
    n + (Array.isArray(item?.occurrences) ? item.occurrences.length : 0), 0);
  const found = [];
  for (const asset of assets) {
    const matches = rendererMatch(asset, renderer);
    if (matches.length === 1) {
      const item = matches[0];
      const attempts = [{
        source: 'renderer-generated-image',
        status: item.status ?? 200,
        byteLength: item.byteLength,
        occurrences: Array.isArray(item.occurrences) ? item.occurrences.length : 0
      }];
      stats.assetAttempts.push({ fileId: asset.file_id, attempts });
      found.push({ ...asset,
        renderer_references: item.occurrences || [],
        mime_type: typeof item.mimeType === 'string' ? item.mimeType : null,
        file_name: null,
        downloaded_size_bytes: item.byteLength,
        base64: item.base64,
        attempts });
      continue;
    }

    let result = null;
    try {
      const response = await send('Runtime.evaluate', {
        expression: assetFetchExpression(asset, shareId),
        awaitPromise: true, returnByValue: true, silent: true
      });
      result = response?.result?.value || null;
    } catch {
      result = { attempts: [{ source: 'web-control', failed: true }], base64: null };
    }
    const attempts = [{
      source: 'renderer-generated-image',
      matches: matches.length,
      availableResources: renderer.length,
      candidateResources: stats.rendererImageCandidates,
      fetchObservation: stats.rendererImageFetch
    }, ...(Array.isArray(result?.attempts) ? result.attempts : [])];
    stats.assetAttempts.push({ fileId: asset.file_id, attempts });
    found.push({ ...asset,
      renderer_references: matches.length === 1 ? matches[0].occurrences || [] : [],
      mime_type: typeof result?.mimeType === 'string' ? result.mimeType : null,
      file_name: typeof result?.fileName === 'string' ? result.fileName : null,
      downloaded_size_bytes: Number.isSafeInteger(result?.byteLength) ? result.byteLength : null,
      base64: typeof result?.base64 === 'string' ? result.base64 : null,
      attempts });
  }
  return found;
}

// Control is the portable public web-control client adapter: one command per
// request. The persistent session is used only as the common privileged CDP
// transport for page navigation and Runtime.evaluate. No debugger or network
// event domain is enabled by this acquisition path.
export async function captureStructuredSnapshot(control, inputUrl, options = {}) {
  const url = shareUrl(inputUrl);
  const shareId = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  const seconds = options.seconds ?? 20;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 120)
    throw new AcquisitionError('share.invalid-seconds', 'seconds must be 1..120');
  const stats = { phase: 'page-creation', operation: null, providerDiagnostic: null,
    hookFound: false, scriptCount: 0, inspectedResponses: 0, jsonShapes: [],
    sourceAttempts: [], assetAttempts: [], rendererImageResources: 0,
    rendererImageOccurrences: 0, rendererImageCandidates: 0,
    rendererImageFetch: { attempted: 0, fetched: 0, failed: 0,
      size_matched: 0, size_mismatched: 0 } };
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

    stats.phase = 'initial-navigation';
    stats.operation = 'debug session send Page.navigate';
    await send('Page.navigate', { url });

    stats.phase = 'share-json';
    stats.operation = 'debug session send Runtime.evaluate';
    await waitForShareDocument(send, Date.now() + Math.min(seconds, 10) * 1000);
    const result = await send('Runtime.evaluate', {
      expression: shareFetchExpression(shareId),
      awaitPromise: true,
      returnByValue: true,
      silent: true
    });
    const fetched = result?.result?.value;
    if (fetched && typeof fetched === 'object') {
      stats.sourceAttempts = Array.isArray(fetched.attempts) ? fetched.attempts : [];
      if (typeof fetched.snapshot === 'string') {
        const snapshot = parseSnapshot(fetched.snapshot);
        if (snapshot) {
          stats.phase = 'media-acquisition';
          stats.operation = 'debug session send Runtime.evaluate';
          const assets = await captureImageAssets(send, snapshot, shareId, stats);
          stats.operation = null;
          return { snapshot, assets, method: 'page-fetch', stats };
        }
      }
    }

    // Diagnostic fallback only: retain privacy-reduced shapes from inline JSON.
    stats.phase = 'embedded-json';
    const expression =
      "(() => [...document.querySelectorAll('script[type=\"application/json\"]')]" +
      ".slice(0,20).map(s=>s.textContent).filter(x=>x&&x.length<16000000))()";
    try {
      const inline = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        silent: true
      });
      for (const raw of inline?.result?.value || []) {
        if (typeof raw !== 'string') continue;
        const snapshot = fromJson(raw, stats);
        if (snapshot) {
          stats.phase = 'media-acquisition';
          stats.operation = 'debug session send Runtime.evaluate';
          const assets = await captureImageAssets(send, snapshot, shareId, stats);
          stats.operation = null;
          return { snapshot, assets, method: 'embedded-json', stats };
        }
      }
    } catch { /* Not every page exposes inline JSON script tags. */ }

    stats.operation = null;
    throw new AcquisitionError('share.snapshot-not-observed',
      'shared conversation JSON did not yield a parent-linked snapshot', stats);
  } catch (error) {
    if (error instanceof AcquisitionError) throw error;
    stats.operation = error.operation || stats.operation;
    stats.providerDiagnostic = error.providerDiagnostic || null;
    throw new AcquisitionError('share.web-control-failed',
      'browser command or page-context fetch failed: ' +
      String(error.message || error).split('\n')[0].slice(0, 180), stats);
  } finally {
    if (session) await control('debug', 'session', 'close', session).catch(() => {});
    if (page) await control('page', 'close', page).catch(() => {});
  }
}
