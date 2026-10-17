#!/usr/bin/env node
// Experimental two-site, human-guided observation and bounded automatic replay.
// Intentionally NOT an installed web-control command or a production exporter.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const runProcess = promisify(execFile);
const entrypoint = fileURLToPath(import.meta.url);
const binding = '__rumiaiTrialObservation';
const sites = [
  { name: 'amazon-wishlist',
    url: 'https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?ref_=list_d_wl_lfu_nav_3' },
  { name: 'chatgpt-share',
    url: 'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' }
];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function errorId(error) {
  return String(error?.code || error?.message || 'unknown')
    .replace(/https?:\/\/\S+/g, '[url]').slice(0, 140);
}

async function saveJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

export function replayableAction(action) {
  if (action?.kind === 'scroll' &&
      typeof action.selector === 'string' &&
      Number.isFinite(action.top) && action.top >= 0)
    return true;
  if (action?.kind === 'click' && typeof action.selector === 'string' &&
      (action.target === 'summary' ||
       (action.target === 'button' && action.expandable === true)))
    return true;
  return false;
}

export function consolidateActions(events) {
  const result = [];
  for (const event of events) {
    if (!['scroll', 'click', 'key-activation', 'input-change'].includes(event.kind)) continue;
    // Preserve every distinct scroll checkpoint: an intermediate location
    // may be the only moment when a virtualized page exposes those items.
    const last = result[result.length - 1];
    if (event.kind === 'scroll' && last?.kind === 'scroll' &&
        last.selector === event.selector && last.top === event.top) continue;
    result.push(event);
  }
  return result;
}

// The injected observer records element identities and scroll geometry,
// not field values, cookies, HTML, request bodies or user-entered text.
// Click replay is limited to native summary/expandable buttons.
const observerScript = String.raw`
(() => {
  if (window.__rumiaiTrialInstalled) return;
  window.__rumiaiTrialInstalled = true;
  function cssPath(element) {
    if (element === document.documentElement) return 'html';
    if (element === document.body) return 'body';
    const parts = [];
    for (let el = element; el && el.nodeType === 1 && parts.length < 12;
         el = el.parentElement) {
      const tag = el.localName;
      if (el.id && CSS.escape) {
        const withId = '#' + CSS.escape(el.id);
        if (document.querySelectorAll(withId).length === 1) return withId;
      }
      const siblings = el.parentElement
        ? Array.from(el.parentElement.children).filter(x => x.localName === tag)
        : [];
      const suffix = siblings.length > 1
        ? ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')' : '';
      parts.unshift(tag + suffix);
      const candidate = parts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch {}
    }
    return parts.join(' > ');
  }
  function send(value) {
    try { window.__rumiaiTrialObservation(JSON.stringify(value)); } catch {}
  }
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const el = event.target instanceof Element ? event.target : null;
    const target = el?.closest('summary,button,a,[role="button"],[aria-expanded]') || el;
    if (!target || target.closest('[contenteditable="true"],[type="password"]')) return;
    send({ kind:'click', selector:cssPath(target), target:target.localName,
      expandable:target.getAttribute('aria-expanded') !== null,
      at:Date.now() });
  }, true);
  const recent = new WeakMap();
  document.addEventListener('scroll', event => {
    if (!event.isTrusted) return;
    const el = event.target === document ? document.scrollingElement
      : event.target;
    if (!el || el.nodeType !== 1) return;
    let info = recent.get(el);
    if (!info) { info = { last:0, timer:null }; recent.set(el, info); }
    function sample() {
      info.last = Date.now();
      send({ kind:'scroll',
        selector:el === document.scrollingElement ? 'html' : cssPath(el),
        top:Math.max(0, Math.round(el.scrollTop)), at:Date.now() });
    }
    clearTimeout(info.timer);
    if (Date.now() - info.last >= 600) sample();
    info.timer = setTimeout(sample, 450);
  }, true);
  document.addEventListener('change', event => {
    if (!event.isTrusted) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el?.matches('input,select,textarea')) return;
    // Record only the existence of a form change. Never record values.
    send({ kind:'input-change', target:el.localName, at:Date.now() });
  }, true);
  document.addEventListener('keyup', event => {
    if (!event.isTrusted || event.key !== 'Enter') return;
    const el = event.target instanceof Element ? event.target : null;
    if (el?.matches('input,textarea,[contenteditable]')) return;
    // Informational only: DOM event recording is not a full keyboard replay.
    send({ kind:'key-activation', at:Date.now() });
  }, true);
})()
`;

class WebControl {
  constructor(command) { this.command = command; }
  async call(...args) {
    // Command is a single explicit executable, not an evaluated shell string.
    const result = await runProcess(this.command, args, {
      timeout: 180000, maxBuffer: 96 * 1024 * 1024
    });
    return JSON.parse(result.stdout);
  }
  async send(session, method, params = {}) {
    const answer = await this.call('debug', 'session', 'send', session, method,
      JSON.stringify(params));
    return answer.result;
  }
  async cdp(page, method, params = {}) {
    return this.call('debug', 'cdp', page, method, JSON.stringify(params));
  }
}

async function fingerprint(client, page) {
  try {
    const r = await client.cdp(page, 'Runtime.evaluate', {
      expression:'JSON.stringify({nodes:document.querySelectorAll("*").length,' +
        'textLength:document.body?.textContent?.length||0,' +
        'images:document.images.length,scroll:Math.round(window.scrollY),' +
        'height:document.documentElement.scrollHeight})',
      returnByValue:true
    });
    return r.result?.value || null;
  } catch { return null; }
}

async function captureState(client, page, folder, label) {
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const beforeFingerprint = await fingerprint(client, page);
  const checks = [];
  for (const format of ['html', 'mhtml', 'screenshot']) {
    try {
      const info = await client.call('page', 'capture', page, folder, format);
      checks.push({ format, status: 'captured',
        file: path.basename(info.files[format]) });
    } catch (error) {
      checks.push({ format, status: 'error', diagnostic: errorId(error) });
    }
  }
  try {
    const snapshot = await client.cdp(page, 'DOMSnapshot.captureSnapshot', {
      computedStyles: ['display', 'visibility', 'position', 'color',
        'background-color', 'font-size'],
      includeDOMRects: true, includePaintOrder: true
    });
    await saveJson(path.join(folder, 'dom-snapshot.json'), snapshot);
    checks.push({ format: 'dom-snapshot', status: 'captured',
      file: 'dom-snapshot.json' });
  } catch (error) {
    checks.push({ format: 'dom-snapshot', status: 'error',
      diagnostic: errorId(error) });
  }
  const fileNames = (await fs.readdir(folder)).filter(name =>
    name.startsWith('page.') || name === 'dom-snapshot.json');
  const hashes = {};
  for (const name of fileNames)
    hashes[name] = sha(await fs.readFile(path.join(folder, name)));
  const afterFingerprint = await fingerprint(client, page);
  const captureWindowStable = beforeFingerprint !== null &&
    beforeFingerprint === afterFingerprint;
  const result = { label, capturedAt: new Date().toISOString(), checks, hashes,
    beforeFingerprint, afterFingerprint, captureWindowStable,
    allFormatsCaptured: checks.length === 4 &&
      checks.every(entry => entry.status === 'captured') };
  await saveJson(path.join(folder, 'evidence.json'), result);
  return result;
}

async function settle(client, page) {
  // This is a heuristic, not proof that a site is finished rendering.
  let previous = '';
  let stable = 0;
  for (let i = 0; i < 15; i++) {
    const snapshot = await client.cdp(page, 'Runtime.evaluate', {
      expression: 'JSON.stringify({text:document.body?.textContent?.length||0,' +
        'nodes:document.querySelectorAll("*").length,' +
        'images:document.images.length,' +
        'height:document.documentElement.scrollHeight,' +
        'scroll:Math.round(window.scrollY)})',
      returnByValue: true
    });
    const current = snapshot.result?.value || '';
    if (current === previous) stable++;
    else stable = 0;
    if (stable >= 2) return { settledHeuristically: true, fingerprint: current };
    previous = current;
    await sleep(350);
  }
  return { settledHeuristically: false, fingerprint: previous };
}

async function recordDemonstration(client, session, question) {
  await client.send(session, 'Runtime.enable');
  await client.send(session, 'Page.enable');
  await client.send(session, 'Runtime.addBinding', { name: binding });
  await client.send(session, 'Page.addScriptToEvaluateOnNewDocument', {
    source: observerScript
  });
  await client.send(session, 'Runtime.evaluate', {
    expression: observerScript
  });
  const recorded = [];
  let stopping = false;
  let cursor = 0;
  let overflow = false;
  const polling = (async () => {
    while (!stopping) {
      try {
        const response = await client.call('debug', 'session', 'events',
          session, String(cursor), '100', '300');
        for (const item of response.events || []) {
          cursor = item.sequence;
          if (item.method !== 'Runtime.bindingCalled' ||
              item.params?.name !== binding) continue;
          try {
            const value = JSON.parse(item.params.payload);
            if (['click','scroll','key-activation','input-change'].includes(value.kind))
              recorded.push(value);
          } catch {}
        }
      } catch (error) {
        overflow = true;
        stopping = true;
        process.stderr.write('observation.events-unavailable: ' +
          errorId(error) + '\n');
      }
    }
  })();
  try {
    await question('Interagisci con la pagina nel browser; premi INVIO qui quando hai finito.\n');
  } finally {
    stopping = true;
    await polling;
  }
  return { events: recorded, overflow };
}

async function replayAction(client, page, action) {
  if (!replayableAction(action))
    return { status: 'skipped-unsafe-or-unreplayable' };
  if (action.kind === 'scroll') {
    const expr = '(() => {const el=document.querySelector(' +
      JSON.stringify(action.selector) + ');if(!el)return false;' +
      'el.scrollTop=' + JSON.stringify(action.top) + ';return true})()';
    const result = await client.cdp(page, 'Runtime.evaluate', {
      expression: expr, returnByValue: true
    });
    return { status: result.result?.value === true ? 'executed' :
      'target-unavailable' };
  }
  // Check DOM semantics again on replay; do not trust the label logged during
  // demonstration. Then use native web-control click (trusted browser input).
  const expr = '(() => {const el=document.querySelector(' +
    JSON.stringify(action.selector) + ');return !!el && (' +
    'el.localName==="summary" || (el.localName==="button" && ' +
    'el.hasAttribute("aria-expanded") && !el.closest("form")));})()';
  const check = await client.cdp(page, 'Runtime.evaluate', {
    expression: expr, returnByValue: true
  });
  if (check.result?.value !== true)
    return { status: 'target-unavailable-or-not-safe' };
  await client.call('page', 'click', page, action.selector);
  return { status: 'executed' };
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, char =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

async function writeReview(output, siteName, steps) {
  const refs = [
    { label:'Dimostrazione iniziale', dir:'manual-initial' },
    { label:'Dimostrazione finale', dir:'manual-final' },
    ...steps.filter(step => step.capture).map(step => ({
      label:'Replay ' + step.index + ': ' + step.kind +
        (step.result ? ' (' + step.result.status + ')' : ''),
      dir:'replay/' + String(step.index).padStart(4, '0')
    }))
  ];
  const cards = refs.map(ref => {
    const folder = ref.dir;
    return '<article><h2>' + htmlEscape(ref.label) +
      '</h2><img src="' + folder + '/page.png" alt="Screenshot">' +
      '<p><a href="' + folder + '/page.mhtml">MHTML</a> · ' +
      '<a href="' + folder + '/page.html">HTML</a> · ' +
      '<a href="' + folder + '/dom-snapshot.json">DOM/CSS</a> · ' +
      '<a href="' + folder + '/evidence.json">Checksums</a></p></article>';
  }).join('\n');
  const html = '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + htmlEscape(siteName) +
    ' — stati osservati</title><style>' +
    'body{font:16px system-ui;margin:2rem auto;max-width:1100px;padding:0 1rem}' +
    'article{border:1px solid #ccc;border-radius:8px;margin:20px 0;padding:18px}' +
    'img{width:100%;height:auto;display:block;object-fit:contain}' +
    'a{color:#175a96}h2{font-size:1.2rem}' +
    '</style></head><body><h1>' + htmlEscape(siteName) +
    '</h1><p>Collage di stati osservati: non rappresenta una ricostruzione ' +
    'interattiva unica. I singoli MHTML vanno verificati separatamente.</p>' +
    cards + '</body></html>\n';
  await fs.writeFile(path.join(output, 'review.html'), html,
    { flag:'wx', encoding:'utf8', mode:0o600 });
}

async function writeSiteAnalysis(output, steps) {
  const states = [];
  for (const step of steps) {
    const folder = path.join(output, 'replay',
      String(step.index).padStart(4, '0'));
    const file = path.join(folder, 'dom-snapshot.json');
    let snapshot;
    try { snapshot = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch { states.push({ index:step.index, captured:false }); continue; }
    const documents = snapshot.documents || [];
    states.push({
      index:step.index, captured:true,
      documentCount:documents.length,
      domNodeCount:documents.reduce((n, doc) =>
        n + (doc.nodes?.nodeType?.length || 0), 0),
      layoutBoxCount:documents.reduce((n, doc) =>
        n + (doc.layout?.nodeIndex?.length || 0), 0),
      sourceFile:'replay/' + String(step.index).padStart(4,'0') +
        '/dom-snapshot.json'
    });
  }
  const transitions = states.slice(1).map((current, index) => ({
    from:states[index].index, to:current.index,
    changeInNodeCount:current.captured && states[index].captured
      ? current.domNodeCount - states[index].domNodeCount : null
  }));
  await saveJson(path.join(output, 'site-analysis.json'), {
    description:'Generic CDP layout evidence for specialized-exporter research',
    states, transitions, behaviorInferred:false,
    specializedExporterImplemented:false,
    limitations:'Node/layout counts are evidence, not proof of lazy loading or completeness.'
  });
}

async function runSite(client, site, output, question) {
  const pageInfo = await client.call('page', 'new');
  const page = pageInfo.id;
  let session;
  const report = { site: site.name, url: site.url,
    startedAt: new Date().toISOString(), source: 'real PWC browser' };
  try {
    const navigation = await client.call('page', 'navigate', page, site.url);
    const landing = new URL(navigation.url || site.url);
    report.landing = { path: landing.origin + landing.pathname,
      status: navigation.status ?? null };
    if (/\/(?:ap\/signin|signin|login|auth\/login)(?:\/|$)/i.test(landing.pathname))
      throw new Error('observation.login-wall-no-authenticated-capture');
    report.manualInitial = await captureState(client, page,
      path.join(output, 'manual-initial'), 'manual-initial');
    const debuggerInfo = await client.call('debug', 'session', 'open', page);
    session = debuggerInfo.session;
    process.stdout.write('\nPagina aperta: ' + site.name +
      '\nOra mostra manualmente i contenuti lazy/espandibili.\n');
    const observation = await recordDemonstration(client, session, question);
    report.observation = { eventCount: observation.events.length,
      overflow: observation.overflow };
    await saveJson(path.join(output, 'demonstration.json'),
      { site: site.name, events: observation.events, overflow: observation.overflow });
    await client.call('debug', 'session', 'close', session);
    session = null;
    report.manualFinal = await captureState(client, page,
      path.join(output, 'manual-final'), 'manual-final');

    // Fresh browser page and fresh navigation; no assumption of identical
    // server/session state. Preserves the original manual page until cleanup.
    const replayInfo = await client.call('page', 'new');
    const replayPage = replayInfo.id;
    try {
      await client.call('page', 'navigate', replayPage, site.url);
      const actions = consolidateActions(observation.events);
      const steps = [];
      const baseline = await captureState(client, replayPage,
        path.join(output, 'replay', '0000'), 'replay-baseline');
      steps.push({ index: 0, kind: 'baseline', capture: baseline });
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        let result;
        try { result = await replayAction(client, replayPage, action); }
        catch (error) { result = { status: 'error', diagnostic: errorId(error) }; }
        const stable = result.status === 'executed'
          ? await settle(client, replayPage).catch(() =>
            ({ settledHeuristically: false })) : null;
        // Skipped actions remain in replay-steps.json, but do not cause
        // duplicate heavyweight archives of the same unchanged page.
        const capture = result.status === 'executed'
          ? await captureState(client, replayPage,
            path.join(output, 'replay', String(i + 1).padStart(4, '0')),
            'after-' + action.kind)
          : null;
        steps.push({ index: i + 1, kind: action.kind, action, result,
          stable, capture });
      }
      report.replay = { total: actions.length,
        executed: steps.filter(x => x.result?.status === 'executed').length,
        skipped: steps.filter(x => x.result?.status !== 'executed' && x.result).length,
        allCaptured: steps.every(x => !x.capture || x.capture.allFormatsCaptured),
        allCaptureWindowsStable: steps.every(x => !x.capture || x.capture.captureWindowStable),
        steps: steps.map(x => ({ index: x.index, kind: x.kind,
          status: x.result?.status || 'baseline',
          captured: x.capture?.allFormatsCaptured ?? false,
          settled: x.stable?.settledHeuristically ?? null,
          stableCapture: x.capture?.captureWindowStable ?? null })) };
      await saveJson(path.join(output, 'replay-steps.json'), steps);
      await writeReview(output, site.name, steps);
      await writeSiteAnalysis(output, steps);
    } finally {
      await client.call('page', 'close', replayPage).catch(() => {});
    }
    report.captureTransportComplete = !observation.overflow &&
      report.replay.skipped === 0 && report.replay.allCaptured &&
      report.replay.allCaptureWindowsStable &&
      report.manualInitial.allFormatsCaptured &&
      report.manualFinal.allFormatsCaptured &&
      report.manualInitial.captureWindowStable &&
      report.manualFinal.captureWindowStable;
    report.accepted = false;
    // This is only a machine evidence gate: no visual replay/MHTML fidelity
    // or site-specific exporter has been accepted.
    report.visualFidelityVerified = false;
    report.completePageCoverageVerified = false;
  } catch (error) {
    report.error = errorId(error);
    report.accepted = false;
    report.captureTransportComplete = false;
  } finally {
    if (session) await client.call('debug', 'session', 'close', session).catch(() => {});
    await client.call('page', 'close', page).catch(() => {});
    report.completedAt = new Date().toISOString();
    await saveJson(path.join(output, 'report.json'), report);
  }
  return report;
}

export async function main(args = process.argv.slice(2), client = new WebControl(
  process.env.WEB_CONTROL_CMD || 'web-control')) {
  if (args.length !== 1 || args[0] === '--help') {
    process.stderr.write('usage: node experiments/two-site-observation.mjs <explicit-project-output-dir>\n');
    return 2;
  }
  const output = path.resolve(args[0]);
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  process.umask(0o077);
  const status = await client.call('status');
  process.stdout.write('Provider status: ' +
    JSON.stringify({ browserRunning: status.browserRunning,
      headless: status.headless }) + '\n');
  if (status.headless === true) {
    process.stderr.write('observation.visible-browser-required\n');
    return 3;
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const results = [];
  try {
    for (const site of sites) {
      const folder = path.join(output, site.name);
      if (await fs.stat(folder).then(() => true, () => false)) {
        results.push({ site: site.name, captureTransportComplete: false,
          error: 'observation.output-already-exists' });
        continue;
      }
      await fs.mkdir(folder, { mode: 0o700 });
      const result = await runSite(client, site, folder,
        prompt => readline.question(prompt));
      results.push({ site: result.site,
        captureTransportComplete: result.captureTransportComplete === true,
        error: result.error || null, replay: result.replay ? {
          total: result.replay.total, executed: result.replay.executed,
          skipped: result.replay.skipped } : null });
      process.stdout.write('RESULT ' + JSON.stringify(results.at(-1)) + '\n');
    }
  } finally {
    readline.close();
  }
  await saveJson(path.join(output, 'summary.json'), {
    results, fullFidelityAccepted: false, siteSpecialistExporterBuilt: false
  });
  return results.every(x => x.captureTransportComplete) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === entrypoint)
  process.exitCode = await main().catch(error => {
    process.stderr.write('observation.failure: ' + errorId(error) + '\n');
    return 1;
  });
