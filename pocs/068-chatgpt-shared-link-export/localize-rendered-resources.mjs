'use strict';
// Offline, opt-in resource localization for the inert PoC 068 cumulative DOM.
// Only copies verified first-party static styles, fonts and images. Never executes JS.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const allowedHost = name => ['chatgpt.com', 'oaistatic.com', 'openai.com']
  .some(domain => name === domain || name.endsWith('.' + domain));
const allowedType = row => {
  if (row.resourceType === 'Stylesheet' && row.mimeType === 'text/css') return '.css';
  if (row.resourceType === 'Font' && /^font\/(woff2?|ttf|otf)$/.test(row.mimeType || ''))
    return row.mimeType === 'font/woff2' ? '.woff2' : row.mimeType === 'font/woff' ? '.woff' : '.bin';
  if (['Image', 'Other'].includes(row.resourceType)) {
    return ({'image/png':'.png', 'image/jpeg':'.jpg', 'image/webp':'.webp',
      'image/gif':'.gif', 'image/svg+xml':'.svg', 'image/x-icon':'.ico',
      'image/avif':'.avif'})[row.mimeType] || null;
  }
  return null;
};
function key(value, base = 'https://chatgpt.com/') {
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch {return null;}
}
function safeResourceFile(root, row) {
  const filename = row.file || '';
  if (!/^resources\/[a-f0-9]{64}\.[a-z0-9]+$/.test(filename) ||
      !filename.includes(row.sha256)) throw Error('Invalid indexed resource file');
  const resolved = path.join(root, filename);
  if (!fs.statSync(resolved).isFile()) throw Error('Indexed resource is not a file');
  const buffer = fs.readFileSync(resolved);
  if (buffer.length > 12 * 1024 * 1024 || sha(buffer) !== row.sha256 ||
      buffer.length !== row.bytes) throw Error('Indexed resource integrity failure');
  return buffer;
}
const cssUrl = /url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi;
function rewriteCss(text, sourceUrl, choices, unresolved) {
  return text.replace(cssUrl, (whole, quote, quoted, unquoted) => {
    const value = (quoted ?? unquoted ?? '').trim();
    if (!value || value.startsWith('data:') || value.startsWith('#')) return whole;
    const resolved = key(value, sourceUrl);
    const match = resolved && choices.get(resolved);
    if (!match) {
      unresolved.add(resolved || value);
      return 'url("about:blank")';
    }
    const fragment = (() => {try {return new URL(value, sourceUrl).hash;} catch {return '';}})();
    return 'url("./' + match.filename + fragment + '")';
  });
}
function rewriteMarkup(html, choices, unresolved, matched) {
  // Restrict replacement to static-media element attributes; never rewrite user links.
  return html.replace(/<(img|image|use|source|video|audio)\b[^>]*>/gi, tag =>
    tag.replace(/\b(src|href|xlink:href|poster|srcset)\s*=\s*(["'])([\s\S]*?)\2/gi,
      (all, attr, quote, raw) => {
        const name = attr.toLowerCase();
        if (name === 'srcset') {
          return name + '=' + quote + raw.split(',').map(candidate => {
            const m = /^(\s*)(\S+)([\s\S]*)$/.exec(candidate);
            if (!m) return candidate;
            const mapped = mapReference(m[2]);
            return m[1] + (mapped || m[2]) + m[3];
          }).join(',') + quote;
        }
        const mapped = mapReference(raw);
        return name + '=' + quote + (mapped || raw) + quote;
      }));
  function mapReference(raw) {
    if (raw.startsWith('data:') || raw.startsWith('#')) return null;
    // URL ampersands can be HTML entity encoded inside attributes.
    const value = raw.replace(/&amp;/g, '&');
    const canonical = key(value);
    if (!canonical) {unresolved.add(value); return null;}
    const choice = choices.get(canonical);
    if (!choice) {unresolved.add(canonical); return null;}
    matched.add(canonical);
    const fragment = (() => {try {return new URL(value, 'https://chatgpt.com/').hash;} catch {return '';}})();
    return './' + choice.filename + fragment;
  }
}
function parseIndex(filename) {
  return fs.readFileSync(filename, 'utf8').split(/\r?\n/).filter(Boolean).map((row, i) => {
    try {return JSON.parse(row);} catch {throw Error('Invalid resources JSONL row ' + (i + 1));}
  });
}
export function localize(cumulativeDir, resourceDir, targetDir) {
  const cumulative = path.resolve(cumulativeDir), archive = path.resolve(resourceDir);
  const output = path.resolve(targetDir);
  for (const root of [cumulative, archive])
    if (output === root || output.startsWith(root + path.sep))
      throw Error('Output must be outside all input directories');
  if (fs.existsSync(output)) throw Error('Output already exists: ' + output);
  const sourceHtml = fs.readFileSync(path.join(cumulative, 'index.html'), 'utf8');
  const sourceAudit = fs.readFileSync(path.join(cumulative, 'audit.json'));
  const sourceRefs = fs.readFileSync(path.join(cumulative, 'resource-references.json'));
  if (!sourceHtml.includes("script-src 'none'") || !sourceHtml.includes('id="cumulative-turns"'))
    throw Error('Input is not the inert cumulative DOM');
  const index = parseIndex(path.join(archive, 'resources.jsonl'));
  const choices = new Map(), styles = [];
  let ignored = 0;
  for (const row of index) {
    if (row.status !== 'saved' || typeof row.url !== 'string' || !row.sha256) continue;
    const ext = allowedType(row);
    const url = key(row.url);
    if (!ext || !url || !allowedHost(new URL(url).hostname)) {ignored++;continue;}
    if (choices.has(url)) continue;
    const entry = {row, filename: 'assets/' + row.sha256 + ext, ext, url};
    choices.set(url, entry);
    if (ext === '.css') styles.push(entry);
  }
  const unresolved = new Set(), matched = new Set();
  const prepared = new Map(), stylesheetFiles = [], copied = [];
  // Verify all candidates before creating output: corrupt input cannot create partial output.
  for (const entry of choices.values()) {
    let content = safeResourceFile(archive, entry.row);
    if (entry.ext === '.css') {
      const edited = rewriteCss(content.toString('utf8'), entry.url, choices, unresolved);
      content = Buffer.from(edited, 'utf8');
    }
    if (entry.ext === '.svg' && /<script\b|onload\s*=/i.test(content.toString('utf8')))
      throw Error('SVG with executable content rejected');
    prepared.set(entry.filename, content);
    copied.push({originalUrl: entry.url, originalSha256: entry.row.sha256,
      localFile: entry.filename, bytes: content.length,
      modifiedCss: entry.ext === '.css'});
  }
  for (const entry of styles) stylesheetFiles.push(entry.filename);
  let html = rewriteMarkup(sourceHtml, choices, unresolved, matched);
  html = html.replace("img-src data: blob:", "img-src 'self' data: blob:")
    .replace("style-src 'unsafe-inline'", "style-src 'self' 'unsafe-inline'")
    .replace("font-src data:", "font-src 'self' data:");
  const links = stylesheetFiles.map(filename => '<link rel="stylesheet" href="./' +
    filename + '">').join('');
  html = html.replace('</head>', links + '</head>');
  if (html === sourceHtml || !html.includes("script-src 'none'"))
    throw Error('Unexpected offline document template');
  fs.mkdirSync(path.join(output, 'assets'), {recursive:true, mode:0o700});
  for (const [filename, bytes] of prepared) {
    fs.writeFileSync(path.join(output, filename), bytes, {flag:'wx', mode:0o600});
  }
  fs.writeFileSync(path.join(output, 'index.html'), html, {flag:'wx', mode:0o600});
  fs.writeFileSync(path.join(output, 'audit.json'), sourceAudit, {flag:'wx', mode:0o600});
  fs.writeFileSync(path.join(output, 'resource-references.json'), sourceRefs, {flag:'wx', mode:0o600});
  const report = {status:'offline-localized-static-assets', stylesheets:styles.length,
    staticFiles:prepared.size, mediaReferencesMatched:matched.size,
    unresolvedReferences:[...unresolved].sort(), ignoredNonStaticOrNonFirstParty:ignored,
    limitations:['Original React/JavaScript deliberately disabled',
      'Referenced assets not in CDP archive remain unavailable',
      'Original document/body context and theme may affect CSS',
      'No inference about complete RAW message coverage']};
  fs.writeFileSync(path.join(output, 'localization-audit.json'),
    JSON.stringify(report, null, 2) + '\n', {flag:'wx', mode:0o600});
  return {output, stylesheets:styles.length, staticFiles:prepared.size,
    mediaReferencesMatched:matched.size, unresolved:unresolved.size, ignored};
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (process.argv.length !== 5) {
    console.error('Usage: node localize-rendered-resources.mjs <cumulative-dir> <web-analyze-dir> <new-output-dir>');
    process.exitCode = 2;
  } else {
    try {console.log(JSON.stringify(localize(...process.argv.slice(2)), null, 2));}
    catch(error) {console.error(error.message);process.exitCode=1;}
  }
}
