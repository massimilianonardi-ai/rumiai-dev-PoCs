import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { EventLog, safeUrl } from './log.mjs';
import { OBSERVER_SOURCE } from './observer.mjs';

function _describeRequest(request)
{
  return {
    url: safeUrl(request.url()),
    method: request.method(),
    resourceType: request.resourceType(),
    redirectedFrom: request.redirectedFrom() ? safeUrl(request.redirectedFrom().url()) : null,
    isNavigation: request.isNavigationRequest()
  };
}

async function _observeCDP(context, page, log, pageId)
{
  let session;
  try
  {
    session = await context.newCDPSession(page);
    for (const [name, fields] of Object.entries
    ({
      'Network.requestWillBeSent': e => ({ requestId: e.requestId, url: safeUrl(e.request?.url), method: e.request?.method, type: e.type, initiatorType: e.initiator?.type, frameId: e.frameId }),
      'Network.responseReceived': e => ({ requestId: e.requestId, url: safeUrl(e.response?.url), status: e.response?.status, protocol: e.response?.protocol, mimeType: e.response?.mimeType, fromDiskCache: e.response?.fromDiskCache, encodedDataLength: e.response?.encodedDataLength }),
      'Network.loadingFinished': e => ({ requestId: e.requestId, encodedDataLength: e.encodedDataLength }),
      'Network.loadingFailed': e => ({ requestId: e.requestId, errorText: e.errorText, canceled: e.canceled, blockedReason: e.blockedReason }),
      'Network.webSocketCreated': e => ({ requestId: e.requestId, url: safeUrl(e.url) }),
      'Network.webSocketClosed': e => ({ requestId: e.requestId, timestamp: e.timestamp }),
      'Network.webSocketFrameReceived': e => ({ requestId: e.requestId, opcode: e.response?.opcode, payloadLength: e.response?.payloadData?.length }),
      'Network.webSocketFrameSent': e => ({ requestId: e.requestId, opcode: e.response?.opcode, payloadLength: e.response?.payloadData?.length }),
      'Network.eventSourceMessageReceived': e => ({ requestId: e.requestId, eventName: e.eventName, eventIdPresent: !!e.eventId, payloadLength: e.data?.length }),
      'Page.lifecycleEvent': e => ({ frameId: e.frameId, name: e.name, loaderId: e.loaderId })
    }))
    {
      session.on(name, event => log.record(name.startsWith('Page.') ? 'lifecycle' : 'network', `cdp.${name}`, { pageId, ...fields(event) }));
    }
    await Promise.all
    ([
      session.send('Network.enable'),
      session.send('Page.enable'),
      session.send('Page.setLifecycleEventsEnabled', { enabled: true })
    ]);
    log.record('lifecycle', 'cdp-attached', { pageId });
    return session;
  }
  catch (error)
  {
    log.record('error', 'cdp-attach-failed', { pageId, errorType: error.name, messageLength: error.message?.length });
    if (session) await session.detach().catch(() => {});
    return null;
  }
}

/**
 * Open visible Chromium and record a human browsing session.
 * stop() resolves only after queued log writes are durable and the browser closes.
 * The output directory must not exist; an existing profile may be reused explicitly.
 */
export async function startWebAnalyze
({
  url,
  outputDir,
  profileDir,
  executablePath,
  headless = false
})
{
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('url must be an http(s) URL');
  if (!outputDir || !profileDir) throw new Error('outputDir and profileDir are required');
  const log = await EventLog.create(outputDir);
  let context;
  let finished = false;
  let stopping;
  let nextPageId = 0;
  const opened = new WeakMap();
  const startedAt = new Date().toISOString();
  const sessions = new Set();
  const pendingAttachments = new WeakMap();
  const stop = async (reason = 'user-stop') =>
  {
    if (stopping) return stopping;
    stopping = (async () =>
    {
      finished = true;
      log.record('lifecycle', 'session-stop', { reason });
      for (const session of sessions) await session.detach().catch(() => {});
      if (context) await context.close().catch(error => log.record('error', 'browser-close-failed', { errorType: error.name }));
      return log.finish({ startedAt, stoppedAt: new Date().toISOString(), stopReason: reason, initialUrl: safeUrl(url), profile: 'dedicated', version: 1 });
    })();
    return stopping;
  };

  try
  {
    await mkdir(resolve(profileDir), { recursive: true, mode: 0o700 });
    // Playwright is loaded only on session start, so log utilities remain dependency-free.
    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext
    (
      resolve(profileDir),
      {
        headless,
        ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
        acceptDownloads: false,
        chromiumSandbox: true,
        viewport: null
      }
    );
    log.record('lifecycle', 'browser-started', { headless, browserVersion: context.browser()?.version() ?? null });
    await context.exposeBinding('__webAnalyzeEmit', (source, payload) =>
    {
      const pageId = opened.get(source.page) ?? null;
      const stream = payload.event === 'mutation-batch' ? 'dom' : payload.event === 'performance-entry' ? 'performance' : payload.event === 'window-error' || payload.event === 'unhandled-rejection' ? 'error' : 'interaction';
      log.record(stream, payload.event, { pageId, frameUrl: safeUrl(source.frame.url()), pageTime: payload.pageTime, ...payload.data });
    });
    await context.addInitScript({ content: OBSERVER_SOURCE });
    const onPage = page =>
    {
      if (opened.has(page)) return;
      const pageId = `page-${++nextPageId}`;
      opened.set(page, pageId);
      log.record('lifecycle', 'page-open', { pageId, url: safeUrl(page.url()) });
      page.on('request', request => log.record('network', 'request', { pageId, ..._describeRequest(request) }));
      page.on('requestfailed', request => log.record('network', 'request-failed', { pageId, ..._describeRequest(request), failure: request.failure() }));
      page.on('requestfinished', request => log.record('network', 'request-finished', { pageId, ..._describeRequest(request), timing: request.timing() }));
      page.on('response', response => log.record('network', 'response', { pageId, url: safeUrl(response.url()), status: response.status(), ok: response.ok(), contentType: response.headers()['content-type'], fromServiceWorker: response.fromServiceWorker() }));
      page.on('console', message => log.record('console', 'console-message', { pageId, level: message.type(), location: { url: safeUrl(message.location().url), line: message.location().lineNumber }, textLength: message.text().length }));
      page.on('pageerror', error => log.record('error', 'page-error', { pageId, errorType: error.name, messageLength: error.message?.length }));
      page.on('dialog', dialog => log.record('interaction', 'dialog', { pageId, type: dialog.type(), messageLength: dialog.message().length }));
      page.on('download', download => log.record('interaction', 'download', { pageId, suggestedFilename: '[not-recorded]', url: safeUrl(download.url()) }));
      page.on('frameattached', frame => log.record('lifecycle', 'frame-attached', { pageId, url: safeUrl(frame.url()) }));
      page.on('framenavigated', frame => log.record('lifecycle', 'frame-navigated', { pageId, url: safeUrl(frame.url()), isMain: frame === page.mainFrame() }));
      page.on('framedetached', frame => log.record('lifecycle', 'frame-detached', { pageId, url: safeUrl(frame.url()) }));
      page.on('domcontentloaded', () => log.record('lifecycle', 'domcontentloaded', { pageId, url: safeUrl(page.url()) }));
      page.on('load', () => log.record('lifecycle', 'load', { pageId, url: safeUrl(page.url()) }));
      page.on('crash', () => log.record('error', 'renderer-crash', { pageId }));
      page.on('close', () => log.record('lifecycle', 'page-close', { pageId }));
      pendingAttachments.set(page, _observeCDP(context, page, log, pageId).then(session => { if (session) sessions.add(session); }));
    };
    context.on('page', onPage);
    for (const page of context.pages()) onPage(page);
    context.on('close', () => { if (!finished) void stop('browser-closed'); });
    let page = context.pages()[0];
    if (!page) page = await context.newPage();
    onPage(page);
    await pendingAttachments.get(page);
    try
    {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      log.record('lifecycle', 'initial-navigation-complete', { pageId: opened.get(page), url: safeUrl(page.url()) });
    }
    catch (error)
    {
      // Keep Chromium open for the human to inspect and retry manually.
      log.record('error', 'initial-navigation-failed', { pageId: opened.get(page), errorType: error.name, messageLength: error.message?.length });
    }
    return { context, page, outputDir: log.root, stop };
  }
  catch (error)
  {
    log.record('error', 'session-start-failed', { errorType: error.name, messageLength: error.message?.length });
    await stop('startup-failed');
    throw error;
  }
}
