#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AcquisitionError, captureStructuredSnapshot, shareUrl } from './snapshot-acquire.mjs';
import { exportSnapshot } from './snapshot-export.mjs';

const execFileAsync = promisify(execFile);
const WEB_CONTROL = process.env.WEB_CONTROL_CMD || 'web-control';
const MAX_BUFFER = 128 * 1024 * 1024;
const entrypoint = fileURLToPath(import.meta.url);

export async function webControl(...args) {
  let response;
  try {
    response = await execFileAsync(WEB_CONTROL, args, { maxBuffer: MAX_BUFFER, timeout: 60000 });
  } catch (cause) {
    // Retain only the provider's first diagnostic identity/message line. Never
    // persist raw CDP params, browser HTML, signed URLs or stdout payloads.
    const line = String(cause?.stderr || '').split('\n')
      .map((value) => value.trim()).find(Boolean) || '';
    const safe = line
      .replace(/https?:\/\/\S+/g, '[url]')
      .replace(/([?&](?:token|key|auth|sig|signature)=)[^&\\s]+/gi, '$1[redacted]')
      .slice(0, 240);
    const error = new Error('share.web-control-command-failed: ' +
      args.slice(0, 3).join(' ') + (safe ? ': ' + safe : ''));
    error.operation = args.slice(0, 3).join(' ');
    error.providerDiagnostic = safe || null;
    throw error;
  }
  try { return JSON.parse(response.stdout); }
  catch { throw new Error('share.web-control-invalid-json: provider returned malformed JSON'); }
}

async function controllerReady() {
  try { await webControl('status'); return; }
  catch {
    try {
      await execFileAsync('srv', ['start', 'web-control'], { timeout: 60000, maxBuffer: 1024 * 1024 });
      await webControl('status');
    } catch {
      throw new Error('share.controller-unavailable: start web-control provider service before exporting');
    }
  }
}

async function failureRecord(folder, error) {
  const item = {
    status: 'incomplete',
    error: error instanceof AcquisitionError ? error.code : 'share.export-failed',
    phase: error.stats?.phase || 'initialization',
    operation: error.stats?.operation || null,
    providerDiagnostic: error.stats?.providerDiagnostic || null,
    hookFound: Boolean(error.stats?.hookFound),
    inspectedResponses: error.stats?.inspectedResponses || 0,
    scriptCount: error.stats?.scriptCount || 0,
    observedJsonShapes: error.stats?.jsonShapes || [],
    sourceAttempts: error.stats?.sourceAttempts || [],
    assetAttempts: error.stats?.assetAttempts || [],
    fileAttempts: error.stats?.fileAttempts || [],
    rendererImageCandidates: error.stats?.rendererImageCandidates || 0,
    rendererImageResources: error.stats?.rendererImageResources || 0,
    rendererImageOccurrences: error.stats?.rendererImageOccurrences || 0,
    rendererImageFetch: error.stats?.rendererImageFetch || null,
    generatedImageDom: error.stats?.generatedImageDom || null
  };
  for (let n = 1; n < 100000; n++) {
    const file = path.join(folder, 'share-debug-diagnostic-' + String(n).padStart(4, '0') + '.json');
    try {
      await fs.writeFile(file, JSON.stringify(item, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      return file;
    } catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
  }
  throw new Error('share.diagnostic-exhausted: could not allocate a failure record');
}

export async function exportSharedLink(input, directory, seconds = 20, controller = webControl) {
  const url = shareUrl(input);
  await controllerReadyIfRequired(controller);
  const { snapshot, assets = [], files = [], method, stats } =
    await captureStructuredSnapshot(controller, url, { seconds });
  const result = await exportSnapshot(snapshot, {
    display_title: snapshot.title || 'Shared conversation',
    source_created_at: snapshot.create_time
  }, directory, url, method, assets, files);
  return {
    ...result,
    rendererImageCandidates: stats?.rendererImageCandidates ?? 0,
    rendererImageResources: stats?.rendererImageResources ?? 0,
    rendererImageOccurrences: stats?.rendererImageOccurrences ?? 0,
    rendererImageFetch: stats?.rendererImageFetch ?? null,
    generatedImageDom: stats?.generatedImageDom ?? null
  };
}

async function controllerReadyIfRequired(control) {
  if (control === webControl) await controllerReady();
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length < 1 || argv.length > 4 || argv.some(a => a === '--help') ||
      (argv.length >= 3 && argv[argv.length - 2] !== '--seconds')) {
    process.stderr.write('usage: node export-share.mjs <https://chatgpt.com/share/id> [output-dir] [--seconds N]\n');
    return 2;
  }
  let seconds = 20;
  if (argv.includes('--seconds')) {
    const index = argv.indexOf('--seconds');
    seconds = Number(argv[index + 1]);
    argv = argv.slice(0, index);
  }
  const output = path.resolve(argv[1] || './archive');
  process.umask(0o077);
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  try {
    const result = await exportSharedLink(argv[0], output, seconds);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    const diagnostic = await failureRecord(output, error);
    process.stderr.write(String(error.code || error.message).split('\n')[0].slice(0, 180) +
      '\nDiagnostic: ' + diagnostic + '\n');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === entrypoint)
  process.exitCode = await main();
