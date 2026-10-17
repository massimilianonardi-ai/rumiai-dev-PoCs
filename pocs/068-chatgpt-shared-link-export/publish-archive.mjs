import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import { zipFiles } from './snapshot-export.mjs';
import { buildChronologicalPublication, timelineMarkdown } from './chronological-publication.mjs';

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

function renderHtml(markdown, title, source, available, events, unplaced)
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
  const body = events.map(event =>
  {
    if (event.kind === 'message')
      return '<section class="message"><h2>' + escapeHtml(event.label) +
        '</h2>' + renderer.render(event.markdown || '') + '</section>';
    if (event.kind === 'attachment')
      return '<section class="attachment">' + renderer.render(event.markdown) +
        '</section>';
    const heading = event.kind === 'thinking'
      ? 'Thinking / attività intermedia' +
        (event.publicCommentary ? ' visibile' : ' — contenuto non disponibile')
      : 'Attività tecnica';
    return '<details class="activity"><summary>' + escapeHtml(heading) +
      ' (nodi ' + event.ordinal + '–' + event.endOrdinal + ')</summary>' +
      renderer.render(event.markdown) + '</details>';
  }).join('\n') + (unplaced.length
    ? '<section class="unavailable"><h2>Elementi senza posizione verificata</h2>' +
      '<p>Vedere data/MEDIA.json e data/FILES.json. ' +
      'Non sono stati spostati alla fine della conversazione.</p></section>' : '');
  const css = [
    '@page{size:A4;margin:15mm 13mm}',
    ':root{font-family:system-ui,Arial,sans-serif;color:#20232a}',
    'body{max-width:940px;margin:0 auto;padding:32px;line-height:1.55}',
    'h1,h2,h3{line-height:1.25;break-after:avoid}',
    'h1{border-bottom:2px solid #dedede;padding-bottom:12px}',
    'h2{border-top:1px solid #ddd;padding-top:18px;margin-top:28px}',
    '.message{padding-bottom:12px}.attachment{padding:4px 0 18px}',
    'details.activity{margin:8px 0;padding:9px 12px;border:1px solid #ddd;border-radius:8px;background:#f8fafc}',
    'details.activity summary{cursor:pointer;font-size:.9rem;color:#526277}',
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f7;padding:12px;border-radius:6px}',
    'code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}',
    'table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}',
    'th,td{border:1px solid #bbb;padding:6px 9px;text-align:left}',
    'img{max-width:100%;height:auto;object-fit:contain;break-inside:avoid}',
    'blockquote{border-left:3px solid #aaa;padding-left:12px;color:#454545}',
    'a{overflow-wrap:anywhere;color:#0758a3}',
    '.unavailable{color:#933;padding:2px 6px;border:1px dashed #b99}',
    '@media print{body{margin:0;padding:0;max-width:none}a{color:inherit}pre,blockquote,img{break-inside:avoid}details.activity{display:block}}'
  ].join('\n');
  return '<!doctype html>\n<html lang="it"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><style>' + css +
    '</style></head><body><header><h1>' + escapeHtml(title) + '</h1>' +
    '<p>Origine: <a href="' + escapeHtml(source) + '">' + escapeHtml(source) +
    '</a></p></header><main>' + body + '</main></body></html>\n';
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
  const printFile = path.join(path.dirname(htmlFile),
    '.print-view-' + process.pid + '.html');
  try
  {
    // An interactive HTML keeps details collapsed. The archival PDF needs
    // visible public commentary printed, so expand disclosures only in the
    // transient local print view without changing conversation.html.
    const html = await fs.readFile(htmlFile, 'utf8');
    await fs.writeFile(printFile,
      html.replaceAll('<details class="activity">',
        '<details class="activity" open>'), { mode: 0o600, flag: 'wx' });
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--no-default-browser-check', '--disable-background-networking',
      '--allow-file-access-from-files', '--no-pdf-header-footer',
      '--virtual-time-budget=8000',
      '--user-data-dir=' + profile,
      '--print-to-pdf=' + pdfFile,
      pathToFileURL(printFile).href
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
    await fs.rm(printFile, { force: true });
  }
}

async function verifyPdf(pdfFile)
{
  const bytes = await fs.readFile(pdfFile);
  assertion(bytes.length > 100 && bytes.subarray(0, 5).toString() === '%PDF-' &&
    bytes.subarray(-2048).includes(Buffer.from('%%EOF')),
  'publication.pdf-invalid');
}


export async function publishArchive(directory, archive, options = {})
{
  const root = path.resolve(directory);
  const outputZip = path.resolve(archive);
  const audit = JSON.parse(await fs.readFile(path.join(root, 'AUDIT.json'), 'utf8'));
  const acquisition = JSON.parse(await fs.readFile(path.join(root, 'ACQUISITION.json'), 'utf8'));
  const media = JSON.parse(await fs.readFile(path.join(root, 'MEDIA.json'), 'utf8'));
  const files = JSON.parse(await fs.readFile(path.join(root, 'FILES.json'), 'utf8'));
  const visible = (await fs.readFile(path.join(root, 'VISIBLE_MESSAGES.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  const turns = (await fs.readFile(path.join(root, 'TURN_SURFACES.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
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
  assertion(audit.transcript.visible_messages > 0 &&
    visible.length === audit.transcript.visible_messages,
    'publication.transcript-not-readable');
  const chronology = buildChronologicalPublication(visible, audit, turns, media, files);
  const markdown = timelineMarkdown(chronology.events, title,
    acquisition.source, visible.length, chronology.unplaced)
    .replaceAll('vedi NON_TEXT_PARTS.json',
      'vedi [dettagli dei contenuti](data/NON_TEXT_PARTS.json)')
    .replaceAll('vedi VISIBLE_MESSAGES.jsonl',
      'vedi [messaggi strutturati](data/VISIBLE_MESSAGES.jsonl)');

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
  await fs.writeFile(htmlFile, renderHtml(markdown, title, acquisition.source,
    available, chronology.events, chronology.unplaced),
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
    chronologyUnplaced: chronology.unplaced,
    chronologyPlacementVerified: chronology.unplaced.length === 0,
    htmlFidelityVerified: false,
    fullFidelityReleaseAccepted: false
  };
}
