import { deriveTranscript, findSnapshot, parseSnapshot } from './snapshot-export.mjs';

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
  const assets = new Map();
  for (const item of deriveTranscript(snapshot).visible) {
    const parts = item.message?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== 'object' ||
          part.content_type !== 'image_asset_pointer' ||
          typeof part.asset_pointer !== 'string' ||
          !part.asset_pointer.startsWith('sediment://')) continue;
      const match = part.asset_pointer.match(/^sediment:\/\/(file[-_][A-Za-z0-9]+)/);
      if (!match || assets.has(part.asset_pointer)) continue;
      assets.set(part.asset_pointer, {
        asset_pointer: part.asset_pointer, file_id: match[1],
        expected_size_bytes: Number.isSafeInteger(part.size_bytes) ? part.size_bytes : null,
        width: Number.isSafeInteger(part.width) ? part.width : null,
        height: Number.isSafeInteger(part.height) ? part.height : null
      });
    }
  }
  return [...assets.values()];
}

function assetFetchExpression(asset, shareId, conversationId) {
  return `(async () => {
    const attempts = [];

    const readBinary = async (response, attempt, meta = {}) => {
      attempt.binaryStatus = response.status;
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > ${MAX_ASSET_BYTES}) {
        attempt.tooLarge = true;
        return null;
      }
      const bytes = new Uint8Array(buffer);
      let binaryString = '';
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binaryString += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      return {
        attempts, base64: btoa(binaryString), byteLength: bytes.length,
        mimeType: response.headers.get('content-type') || meta.mime_type || null,
        fileName: meta.file_name || null
      };
    };

    const resolve = async (source, url, options) => {
      try {
        const response = await fetch(url, options);
        const attempt = { source, metadataStatus: response.status };
        attempts.push(attempt);
        if (!response.ok) return null;
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          attempt.directBinary = true;
          return await readBinary(response, attempt);
        }
        let meta;
        try { meta = await response.json(); }
        catch {
          attempt.invalidJson = true;
          return null;
        }
        if (!meta?.download_url) {
          attempt.noDownloadUrl = true;
          return null;
        }
        try {
          const signed = new URL(meta.download_url, location.origin);
          const sameOrigin = signed.origin === location.origin;
          const binaryHeaders = sameOrigin && options?.headers?.Authorization
            ? { Authorization: options.headers.Authorization } : undefined;
          const binary = await fetch(signed.href, {
            credentials: sameOrigin ? 'include' : 'omit',
            headers: binaryHeaders
          });
          return await readBinary(binary, attempt, meta);
        } catch {
          attempt.binaryFailed = true;
          return null;
        }
      } catch {
        attempts.push({ source, metadataStatus: null, failed: true });
        return null;
      }
    };

    const anon = await resolve(
      'backend-anon',
      '/backend-anon/files/download/' + ${JSON.stringify(asset.file_id)} +
        '?post_id=&shared_conversation_id=' + encodeURIComponent(${JSON.stringify(shareId)}) +
        '&inline=false&download_intent=false',
      { credentials: 'omit', headers: { accept: 'application/json' } }
    );
    if (anon?.base64) return anon;

    let accessToken = null;
    try {
      const sessionResponse = await fetch('/api/auth/session', { credentials: 'include' });
      const sessionAttempt = { source: 'auth-session', metadataStatus: sessionResponse.status };
      attempts.push(sessionAttempt);
      if (sessionResponse.ok) {
        const session = await sessionResponse.json();
        if (typeof session?.accessToken === 'string' && session.accessToken) {
          accessToken = session.accessToken;
          sessionAttempt.authenticated = true;
        } else sessionAttempt.authenticated = false;
      }
    } catch {
      attempts.push({ source: 'auth-session', metadataStatus: null, failed: true });
    }
    if (!accessToken) return { attempts, base64: null };

    const auth = { credentials: 'include', headers: {
      accept: 'application/json', Authorization: 'Bearer ' + accessToken
    } };
    const endpoints = [
      ['backend-api-files-download',
        '/backend-api/files/download/' + ${JSON.stringify(asset.file_id)}],
      ['backend-api-files-download-alt',
        '/backend-api/files/' + ${JSON.stringify(asset.file_id)} + '/download'],
      ['backend-api-conversation-attachment',
        '/backend-api/conversation/' + encodeURIComponent(${JSON.stringify(conversationId || '')}) +
          '/attachment/' + ${JSON.stringify(asset.file_id)} + '/download']
    ];
    for (const [source, url] of endpoints) {
      const result = await resolve(source, url, auth);
      if (result?.base64) return result;
    }
    return { attempts, base64: null };
  })()`;
}
async function captureImageAssets(send, snapshot, shareId, stats) {
  const found = [];
  for (const asset of imageAssets(snapshot)) {
    let result = null;
    try {
      const response = await send('Runtime.evaluate', {
        expression: assetFetchExpression(asset, shareId, snapshot.conversation_id),
        awaitPromise: true, returnByValue: true, silent: true
      });
      result = response?.result?.value || null;
    } catch {
      result = { attempts: [{ source: 'web-control', failed: true }], base64: null };
    }
    const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
    stats.assetAttempts.push({ fileId: asset.file_id, attempts });
    found.push({ ...asset,
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
    sourceAttempts: [], assetAttempts: [] };
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
