import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import { zipFiles } from './snapshot-export.mjs';

const execFileAsync = promisify(execFile);
const technicalFiles = [
  'conversation.raw.json.gz', 'VISIBLE_MESSAGES.jsonl', 'TURN_SURFACES.jsonl',
  'TRANSCRIPT.md', 'NON_TEXT_PARTS.json', 'MEDIA.json', 'FILES.json',
  'AUDIT.json', 'ACQUISITION.json', 'README.md', 'SHA256SUMS'
];

function assertion(condition, code)
{
  if (!condition) throw new Error(code);
}

function escapeHtml(value)
{
  return String(value).replace(/[&<>"']/g, match =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match]);
}

function hash(bytes)
{
  return createHash('sha256').update(bytes).digest('hex');
}

function safeMediaPath(source)
{
  let decoded;
  try { decoded = decodeURIComponent(source); }
  catch { return null; }
  if (!/^(media|files)\/[^/]+$/u.test(decoded) ||
      decoded.includes('\\') || decoded.includes('..') ||
      /[\x00-\x1f?#]/u.test(decoded))
    return null;
  return decoded;
}

function renderHtml(markdown, title, available)
{
  const renderer = new MarkdownIt({
    html: false, linkify: true, breaks: false, typographer: false
  });
  const standardImage = renderer.renderer.rules.image;
  renderer.renderer.rules.image = (tokens, index, options, env, self) =>
  {
    const src = tokens[index].attrGet('src') || '';
    const local = safeMediaPath(src);
    if (!local || !available.has(local))
      return '<span class="unavailable">[Immagine non disponibile offline: ' +
        escapeHtml(src) + ']</span>';
    return standardImage(tokens, index, options, env, self);
  };
  const body = renderer.render(markdown);
  const css = [
    '@page{size:A4;margin:15mm 13mm}',
    ':root{font-family:system-ui,Arial,sans-serif;color:#20232a}',
    'body{max-width:940px;margin:0 auto;padding:32px;line-height:1.55}',
    'h1,h2,h3{line-height:1.25;break-after:avoid}',
    'h1{border-bottom:2px solid #dedede;padding-bottom:12px}',
    'h2{border-top:1px solid #ddd;padding-top:18px;margin-top:28px}',
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f7;padding:12px;border-radius:6px}',
    'code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}',
    'table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}',
    'th,td{border:1px solid #bbb;padding:6px 9px;text-align:left}',
    'img{max-width:100%;height:auto;object-fit:contain;break-inside:avoid}',
    'blockquote{border-left:3px solid #aaa;padding-left:12px;color:#454545}',
    'a{overflow-wrap:anywhere;color:#0758a3}',
    '.unavailable{color:#933;padding:2px 6px;border:1px dashed #b99}',
    '@media print{body{margin:0;padding:0;max-width:none}a{color:inherit}pre,blockquote,img{break-inside:avoid}}'
  ].join('\n');
  return '<!doctype html>\n<html lang="it"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><style>' + css +
    '</style></head><body><main>' + body + '</main></body></html>\n';
}

async function knownFiles(directory)
{
  const result = [];
  async function visit(relative)
  {
    const base = path.join(directory, relative);
    for (const item of await fs.readdir(base, { withFileTypes: true }))
    {
      const child = path.posix.join(relative, item.name);
      if (item.isDirectory()) await visit(child);
      else
      {
        assertion(item.isFile(), 'publication.unsupported-archive-entry');
        result.push(child);
      }
    }
  }
  await visit('');
  return result.sort();
}

async function renderPdfWithChromium(htmlFile, pdfFile)
{
  const executable = process.env.WEB_CONTROL_BROWSER_EXECUTABLE || 'chromium';
  const profile = await fs.mkdtemp(path.join(path.dirname(htmlFile), '.print-profile-'));
  try
  {
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--no-default-browser-check', '--disable-background-networking',
      '--allow-file-access-from-files', '--no-pdf-header-footer',
      '--virtual-time-budget=8000',
      '--user-data-dir=' + profile,
      '--print-to-pdf=' + pdfFile,
      pathToFileURL(htmlFile).href
    ];
    await execFileAsync(executable, args, {
      timeout: 120000, maxBuffer: 2 * 1024 * 1024
    });
  }
  catch (error)
  {
    const diagnostic = error.code === 'ENOENT'
      ? 'publication.chromium-not-found'
      : error.killed ? 'publication.pdf-render-timeout'
        : 'publication.pdf-render-failed';
    throw new Error(diagnostic + ': ' + executable);
  }
  finally
  {
    await fs.rm(profile, { recursive: true, force: true });
  }
}

async function verifyPdf(pdfFile)
{
  const bytes = await fs.readFile(pdfFile);
  assertion(bytes.length > 100 && bytes.subarray(0, 5).toString() === '%PDF-' &&
    bytes.subarray(-2048).includes(Buffer.from('%%EOF')),
  'publication.pdf-invalid');
}

function assetSummary(media, files)
{
  const list = ['## Allegati e contenuti multimediali', ''];
  for (const [kind, entries] of [['Immagine', media], ['File', files]])
  {
    for (const item of entries)
    {
      const name = String(item.file_name || item.file_id ||
        item.asset_pointer || item.sandbox_uri || kind).replace(/[\r\n]/g, ' ');
      if (item.status === 'downloaded' && item.local_path)
      {
        const local = safeMediaPath(item.local_path);
        assertion(Boolean(local), 'publication.asset-path-invalid');
        list.push('- ' + kind + ': [' + name.replace(/[[\]\\]/g, '\\$&') +
          '](<' + local + '>)');
      }
      else
        list.push('- ' + kind + ': ' + name + ' — **' +
          (item.status === 'deferred-authenticated' ?
            'non accessibile dal link pubblico; richiede fase autenticata' :
            'non scaricato') + '**');
    }
  }
  if (list.length === 2) list.push('Nessun allegato rilevato.');
  return list.join('\n') + '\n';
}

export async function publishArchive(directory, archive, options = {})
{
  const root = path.resolve(directory);
  const outputZip = path.resolve(archive);
  const audit = JSON.parse(await fs.readFile(path.join(root, 'AUDIT.json'), 'utf8'));
  const acquisition = JSON.parse(await fs.readFile(path.join(root, 'ACQUISITION.json'), 'utf8'));
  const media = JSON.parse(await fs.readFile(path.join(root, 'MEDIA.json'), 'utf8'));
  const files = JSON.parse(await fs.readFile(path.join(root, 'FILES.json'), 'utf8'));
  const original = await fs.readFile(path.join(root, 'TRANSCRIPT.md'), 'utf8');
  const available = new Set();

  for (const item of [...media, ...files])
  {
    if (item.status !== 'downloaded') continue;
    const relative = safeMediaPath(item.local_path || '');
    assertion(Boolean(relative), 'publication.asset-path-invalid');
    await fs.access(path.join(root, relative));
    available.add(relative);
  }

  const title = audit.conversation.title;
  const heading = original.indexOf('\n## ');
  assertion(heading !== -1 && audit.transcript.visible_messages > 0,
    'publication.transcript-not-readable');
  const prefix = [
    '# ' + title, '',
    '> Archivio di una conversazione ChatGPT condivisa pubblicamente.',
    '> Sorgente: ' + acquisition.source,
    '> Messaggi visibili: ' + audit.transcript.visible_messages + '.',
    '> Le immagini e i file pubblici recuperati sono locali; i contenuti non accessibili sono segnalati.',
    '',
    '---', ''
  ].join('\n');
  const markdown = prefix + original.slice(heading + 1).trimEnd() + '\n\n' +
    assetSummary(media, files);

  const friendlyFile = path.join(root, 'README.md');
  const htmlFile = path.join(root, 'conversation.html');
  const pdfFile = path.join(root, 'conversation.pdf');
  const dataDir = path.join(root, 'data');
  assertion(!(await fs.stat(dataDir).then(() => true, () => false)),
    'publication.already-published');

  // Move the original technical README out of the way without discarding it.
  await fs.mkdir(dataDir, { mode: 0o700 });
  await fs.rename(friendlyFile, path.join(dataDir, 'EXPORT-README.md'));
  await fs.writeFile(friendlyFile, markdown, { flag: 'wx', mode: 0o600 });
  await fs.writeFile(htmlFile, renderHtml(markdown, title, available),
    { flag: 'wx', mode: 0o600 });
  const renderer = options.renderPdf || renderPdfWithChromium;
  await renderer(htmlFile, pdfFile);
  await verifyPdf(pdfFile);

  // Preserve the source evidence, while keeping the GitHub landing page simple.
  for (const name of technicalFiles.filter(x => x !== 'README.md' && x !== 'SHA256SUMS'))
    await fs.rename(path.join(root, name), path.join(dataDir, name));
  await fs.rm(path.join(root, 'SHA256SUMS'));

  const names = await knownFiles(root);
  const items = await Promise.all(names.map(async name =>
    [name, await fs.readFile(path.join(root, name))]));
  const checksums = Buffer.from(items.map(([name, bytes]) =>
    hash(bytes) + '  ' + name).join('\n') + '\n');
  await fs.writeFile(path.join(dataDir, 'SHA256SUMS'), checksums, {
    flag: 'wx', mode: 0o600
  });
  const packaged = [...items, ['data/SHA256SUMS', checksums]];
  const replacement = outputZip + '.publication-' + process.pid + '.tmp';
  try
  {
    await fs.writeFile(replacement, zipFiles(packaged), { flag: 'wx', mode: 0o600 });
    await fs.rename(replacement, outputZip);
  }
  finally
  {
    await fs.rm(replacement, { force: true });
  }
  return {
    directory: root,
    zip: outputZip,
    markdown: friendlyFile,
    html: htmlFile,
    pdf: pdfFile,
    published: true,
    htmlFidelityVerified: false,
    fullFidelityReleaseAccepted: false
  };
}
