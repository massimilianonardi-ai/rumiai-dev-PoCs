import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_NETWORK_EVENTS = 512;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeLeaf(value) {
  return String(value || 'interaction')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'interaction';
}

function settleExpression() {
  return `(() => ({
    marker:'reference-interaction-settle',
    href:location.href,
    readyState:document.readyState,
    htmlLength:document.documentElement?.outerHTML?.length || 0,
    resourceCount:performance.getEntriesByType('resource').length
  }))()`;
}

async function waitForStable(send, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let previous = null, stable = 0, last = null;
  while (Date.now() < deadline) {
    try {
      const response = await send('Runtime.evaluate', {
        expression:settleExpression(), returnByValue:true, silent:true
      });
      last = response?.result?.value || null;
      const signature = last && JSON.stringify([
        last.href,last.readyState,last.htmlLength,last.resourceCount
      ]);
      stable = signature && signature === previous ? stable + 1 : 0;
      previous = signature;
      if (last?.readyState !== 'loading' && stable >= 2) break;
    } catch {}
    await sleep(200);
  }
  return last;
}

function inventoryExpression() {
  return `(() => {
    const marker = 'reference-interaction-inventory';
    const context = node => {
      const turn = node.closest(
        '[data-testid^="conversation-turn-"],[data-message-id],[data-turn-id]'
      );
      return {
        turn_id: turn?.getAttribute('data-turn-id') ||
          turn?.getAttribute('data-message-id') || null,
        message_id: turn?.getAttribute('data-message-id') || null
      };
    };
    const results = [];
    [...document.querySelectorAll('[data-image-gen-result]')].forEach((node,index) => {
      const root = node.querySelector('[id^="image-"]');
      const clickable = root?.querySelector('.cursor-pointer');
      if (!clickable) return;
      results.push({
        kind:'image-gen', index, label:root?.id || ('image-' + index),
        root_id:root?.id || null, ...context(node)
      });
    });
    [...document.querySelectorAll('button.entity-underline[aria-label]')]
      .forEach((node,index) => {
        const icon = node.querySelector('[data-library-file-icon-key]');
        const iconKey = icon?.getAttribute('data-library-file-icon-key') || null;
        results.push({
          kind:iconKey === 'photo' ? 'sandbox-photo' : 'sandbox-file',
          index, label:node.getAttribute('aria-label') || node.innerText || null,
          icon_key:iconKey, ...context(node)
        });
      });
    return { marker, results };
  })()`;
}

function tagTargetExpression(target, token) {
  return `(() => {
    const marker = 'reference-interaction-target';
    const spec = ${JSON.stringify(target)};
    let node = null;
    if (spec.kind === 'image-gen') {
      const items = [...document.querySelectorAll('[data-image-gen-result]')];
      const item = items[spec.index];
      const root = item?.querySelector('[id^="image-"]');
      node = root?.querySelector('.cursor-pointer') || null;
    } else {
      const items = [...document.querySelectorAll('button.entity-underline[aria-label]')];
      node = items[spec.index] || null;
    }
    if (!node) return { marker, found:false };
    node.setAttribute('data-rumiai-reference-target', ${JSON.stringify(token)});
    return {
      marker, found:true, tag:node.tagName.toLowerCase(),
      aria_label:node.getAttribute('aria-label') || null,
      text:node.innerText || '', href:node.getAttribute('href') || null
    };
  })()`;
}

function stateExpression() {
  return `(() => ({
    marker:'reference-interaction-state',
    href:location.href,
    title:document.title,
    images:[...document.querySelectorAll('img')].slice(0,200).map((img,index) => ({
      index,src:img.src || null,currentSrc:img.currentSrc || null,
      complete:Boolean(img.complete),naturalWidth:img.naturalWidth || 0,
      naturalHeight:img.naturalHeight || 0
    })),
    resources:performance.getEntriesByType('resource').slice(-300).map((entry,index) => ({
      index,name:entry.name,initiatorType:entry.initiatorType,
      transferSize:entry.transferSize,encodedBodySize:entry.encodedBodySize,
      decodedBodySize:entry.decodedBodySize,
      responseStatus:Number.isFinite(entry.responseStatus) ? entry.responseStatus : null
    })),
    dialogs:[...document.querySelectorAll(
      '[role="dialog"],[data-radix-portal],[data-testid*="modal"],[data-testid*="dialog"]'
    )].slice(0,50).map((node,index) => ({
      index,role:node.getAttribute('role'),testid:node.getAttribute('data-testid'),
      text:(node.innerText || '').slice(0,2000)
    }))
  }))()`;
}

function artifactResponse(event) {
  if (event.method !== 'Network.responseReceived') return false;
  const response = event.params?.response || {};
  const mime = String(response.mimeType || '').toLowerCase();
  const url = String(response.url || '');
  const headers = response.headers || {};
  const disposition = String(
    headers['content-disposition'] || headers['Content-Disposition'] || ''
  ).toLowerCase();
  return /^image\//.test(mime) ||
    /^(?:text\/(?:plain|markdown)|application\/(?:pdf|zip|octet-stream))/.test(mime) ||
    disposition.includes('attachment') ||
    /oaiusercontent|download|attachment|sandbox|\/files?\//i.test(url);
}

function safeNetworkEvent(event) {
  const p = event.params || {};
  if (event.method === 'Network.requestWillBeSent') return {
    sequence:event.sequence, method:event.method, request_id:p.requestId || null,
    url:p.request?.url || null, http_method:p.request?.method || null,
    type:p.type || null, initiator_type:p.initiator?.type || null
  };
  if (event.method === 'Network.responseReceived') {
    const r = p.response || {};
    const headers = r.headers || {};
    return {
      sequence:event.sequence, method:event.method, request_id:p.requestId || null,
      url:r.url || null, status:r.status ?? null, mime_type:r.mimeType || null,
      type:p.type || null, from_disk_cache:Boolean(r.fromDiskCache),
      from_service_worker:Boolean(r.fromServiceWorker),
      content_length:headers['content-length'] || headers['Content-Length'] || null,
      content_disposition:
        headers['content-disposition'] || headers['Content-Disposition'] || null
    };
  }
  if (event.method === 'Network.loadingFinished') return {
    sequence:event.sequence, method:event.method, request_id:p.requestId || null,
    encoded_data_length:p.encodedDataLength ?? null
  };
  if (event.method === 'Network.loadingFailed') return {
    sequence:event.sequence, method:event.method, request_id:p.requestId || null,
    error_text:p.errorText || null, canceled:Boolean(p.canceled),
    blocked_reason:p.blockedReason || null, type:p.type || null
  };
  if (/download/i.test(event.method)) return {
    sequence:event.sequence, method:event.method,
    url:p.url || null, suggested_filename:p.suggestedFilename || null,
    guid:p.guid || null
  };
  return null;
}

async function drainEvents(control, session, after = 0) {
  const events = [];
  let cursor = after;
  for (let n = 0; n < 5 && events.length < MAX_NETWORK_EVENTS; n++) {
    let batch;
    try {
      batch = await control(
        'debug','session','events',session,
        String(cursor),'128',String(n < 2 ? 500 : 0)
      );
    } catch (error) {
      return { events, cursor, error:String(error?.message || error).slice(0,500) };
    }
    const items = Array.isArray(batch?.events) ? batch.events : [];
    events.push(...items);
    const next = Number.isSafeInteger(batch?.lastSequence)
      ? batch.lastSequence : cursor;
    if (next <= cursor || items.length === 0) {
      cursor = next;
      break;
    }
    cursor = next;
  }
  return { events:events.slice(0,MAX_NETWORK_EVENTS), cursor, error:null };
}

async function captureBody(send, event, resourceDir, prefix, ordinal) {
  const response = event.params?.response || {};
  const requestId = event.params?.requestId;
  if (!requestId || !artifactResponse(event))
    return null;
  let body;
  try {
    body = await send('Network.getResponseBody', { requestId });
  } catch (error) {
    return {
      request_id:requestId, url:response.url || null,
      mime_type:response.mimeType || null,
      status:response.status ?? null,
      body_error:String(error?.message || error).slice(0,500)
    };
  }
  if (typeof body?.body !== 'string') return null;
  let bytes;
  try {
    bytes = body.base64Encoded
      ? Buffer.from(body.body,'base64')
      : Buffer.from(body.body,'utf8');
  } catch (error) {
    return { request_id:requestId, body_error:'body-decode-failed' };
  }
  if (bytes.length > MAX_BODY_BYTES) return {
    request_id:requestId, url:response.url || null,
    mime_type:response.mimeType || null, byte_length:bytes.length, too_large:true
  };
  const ext = (() => {
    const mime = String(response.mimeType || '').toLowerCase();
    if (mime === 'image/png') return '.png';
    if (mime === 'image/jpeg') return '.jpg';
    if (mime === 'image/webp') return '.webp';
    if (mime === 'image/gif') return '.gif';
    if (mime === 'image/svg+xml') return '.svg';
    if (mime === 'application/pdf') return '.pdf';
    if (mime === 'text/markdown') return '.md';
    if (mime === 'text/plain') return '.txt';
    if (mime === 'application/zip') return '.zip';
    return '.bin';
  })();
  const file = `${safeLeaf(prefix)}-${String(ordinal).padStart(2,'0')}${ext}`;
  await fs.writeFile(path.join(resourceDir,file),bytes,{mode:0o600});
  return {
    request_id:requestId, url:response.url || null,
    mime_type:response.mimeType || null, status:response.status ?? null,
    byte_length:bytes.length, sha256:sha256(bytes),
    local_path:'interaction-resources/' + file
  };
}

async function discover(control, url, seconds) {
  let page = null, session = null;
  try {
    const created = await control('page','new');
    page = created.id;
    if (!page) throw new Error('interaction.page-create-failed');
    await control('page','navigate',page,url);
    const opened = await control('debug','session','open',page);
    session = opened.session;
    if (!session) throw new Error('interaction.debug-open-failed');
    const send = async (method,params={}) => {
      const response = await control(
        'debug','session','send',session,method,JSON.stringify(params)
      );
      return response.result;
    };
    await waitForStable(send,seconds);
    const response = await send('Runtime.evaluate',{
      expression:inventoryExpression(),returnByValue:true,silent:true
    });
    const value = response?.result?.value;
    if (!value || value.marker !== 'reference-interaction-inventory')
      return [];
    return Array.isArray(value.results) ? value.results : [];
  } finally {
    if (session) await control('debug','session','close',session).catch(()=>{});
    if (page) await control('page','close',page).catch(()=>{});
  }
}

function selectRepresentatives(inventory) {
  const selected = [];
  for (const kind of ['image-gen','sandbox-file','sandbox-photo']) {
    const items = inventory.filter(x => x.kind === kind);
    if (!items.length) continue;
    selected.push(items.at(-1));
  }
  return selected;
}

async function captureOne(control, url, directory, target, ordinal, seconds) {
  let page = null, session = null;
  const token = `interaction-${ordinal + 1}`;
  const record = { ordinal, target, token, status:'pending' };
  try {
    const created = await control('page','new');
    page = created.id;
    if (!page) throw new Error('interaction.page-create-failed');
    await control('page','navigate',page,url);

    const opened = await control('debug','session','open',page);
    session = opened.session;
    if (!session) throw new Error('interaction.debug-open-failed');
    const send = async (method,params={}) => {
      const response = await control(
        'debug','session','send',session,method,JSON.stringify(params)
      );
      return response.result;
    };

    record.settled = await waitForStable(send,seconds);
    const tagged = await send('Runtime.evaluate',{
      expression:tagTargetExpression(target,token),returnByValue:true,silent:true
    });
    record.tagged = tagged?.result?.value || null;
    if (!record.tagged?.found) {
      record.status = 'target-unavailable';
      return record;
    }

    const pre = await send('Runtime.evaluate',{
      expression:stateExpression(),returnByValue:true,silent:true
    });
    record.pre = pre?.result?.value || null;

    await send('Network.enable',{});
    await send('Page.enable',{}).catch(()=>{});
    const initial = await drainEvents(control,session,0);
    const cursor = initial.cursor;

    await control(
      'page','click',page,`[data-rumiai-reference-target="${token}"]`
    );
    record.clicked = true;

    const drained = await drainEvents(control,session,cursor);
    record.event_error = drained.error;
    const relevant = drained.events.map(safeNetworkEvent).filter(Boolean);
    record.network = relevant;

    await sleep(500);
    const post = await send('Runtime.evaluate',{
      expression:stateExpression(),returnByValue:true,silent:true
    });
    record.post = post?.result?.value || null;

    const screenshot = await send('Page.captureScreenshot',{
      format:'png',fromSurface:true,captureBeyondViewport:false
    }).catch(()=>null);
    if (typeof screenshot?.data === 'string') {
      const name = `${String(ordinal + 1).padStart(2,'0')}-${safeLeaf(target.kind)}.png`;
      await fs.writeFile(path.join(directory,name),
        Buffer.from(screenshot.data,'base64'),{mode:0o600});
      record.screenshot = name;
    }

    const resourceDir = path.join(directory,'interaction-resources');
    await fs.mkdir(resourceDir,{recursive:true,mode:0o700});
    const bodies = [];
    const responses = drained.events.filter(artifactResponse);
    for (const [index,event] of responses.entries()) {
      const captured = await captureBody(
        send,event,resourceDir,`${ordinal + 1}-${target.kind}`,index + 1
      );
      if (captured) bodies.push(captured);
    }
    record.bodies = bodies;
    record.status = 'complete';

    await send('Network.disable',{}).catch(()=>{});
    await send('Page.disable',{}).catch(()=>{});
    return record;
  } catch (error) {
    record.status = 'failed';
    record.error = String(error?.message || error).slice(0,1000);
    return record;
  } finally {
    if (session) await control('debug','session','close',session).catch(()=>{});
    if (page) await control('page','close',page).catch(()=>{});
  }
}

export async function captureReferenceInteractions(
  control,url,directory,options={}
) {
  const seconds = options.seconds ?? 8;
  const inventory = await discover(control,url,seconds).catch(error => [{
    kind:'inventory-error', error:String(error?.message || error).slice(0,1000)
  }]);
  await fs.writeFile(path.join(directory,'INTERACTION-INVENTORY.json'),
    JSON.stringify(inventory,null,2) + '\n',{mode:0o600});

  if (inventory.length === 1 && inventory[0]?.kind === 'inventory-error') {
    const result = { inventory, selected:[], interactions:[] };
    await fs.writeFile(path.join(directory,'INTERACTIONS.json'),
      JSON.stringify(result,null,2) + '\n',{mode:0o600});
    return result;
  }

  const selected = selectRepresentatives(inventory);
  const interactions = [];
  for (const [ordinal,target] of selected.entries())
    interactions.push(await captureOne(
      control,url,directory,target,ordinal,seconds
    ));

  const result = { inventory, selected, interactions };
  await fs.writeFile(path.join(directory,'INTERACTIONS.json'),
    JSON.stringify(result,null,2) + '\n',{mode:0o600});
  return result;
}
