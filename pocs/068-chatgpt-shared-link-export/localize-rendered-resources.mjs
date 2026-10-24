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
  if (row.resourceType === 'Font') {
    if (row.mimeType === 'application/octet-stream' && /\.woff2(?:\?|$)/.test(row.url || ''))
      return '.woff2';
    if (/^font\/(woff2?|ttf|otf)$/.test(row.mimeType || ''))
      return row.mimeType === 'font/woff2' ? '.woff2' : row.mimeType === 'font/woff' ? '.woff' : '.bin';
  }
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
    return 'url("./' + path.posix.basename(match.filename) + fragment + '")';
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

function urlPath(url) {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}

// Only a source-HTML <img src> is eligible, never a CSS URL, user hyperlink,
// srcset candidate or other third-party binary. A single archived path/body
// is still provisional because altered query values may change image content.
function provisionalImageChoices(html, rows, choices) {
  const sources = new Map();
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const attr = /(?:^|\s)src\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag[0]);
    if (!attr) continue;
    const url = key(attr[2].replace(/&amp;/g, '&'));
    if (!url || choices.has(url) || allowedHost(new URL(url).hostname)) continue;
    sources.set(url, null);
  }
  if (!sources.size) throw Error('Image preview contains no unmatched third-party img src');
  if (sources.size > 25) throw Error('Image preview exceeds bounded external PNG candidate limit');
  const byPath = new Map();
  for (const row of rows) {
    if (row.status !== 'saved' || row.mimeType !== 'image/png' ||
        row.resourceType !== 'Image' && row.resourceType !== 'Other') continue;
    const url = key(row.url || '');
    if (!url || allowedHost(new URL(url).hostname)) continue;
    const id = urlPath(url);
    if (!byPath.has(id)) byPath.set(id, []);
    byPath.get(id).push({row,url});
  }
  const provisional = [];
  for (const url of sources.keys()) {
    const candidates = byPath.get(urlPath(url)) || [];
    const bodies = new Set(candidates.map(x => x.row.sha256));
    if (bodies.size !== 1) throw Error('No unique verified PNG body for one image-preview reference');
    const candidate = candidates[0];
    if (new Set(candidates.map(x => x.url)).size !== 1)
      throw Error('Image-preview candidate has multiple archived URLs for one body');
    const entry = {row:candidate.row,filename:'assets/'+candidate.row.sha256+'.png',
      ext:'.png',url:candidate.url};
    choices.set(url,entry);
    provisional.push({sourceUrlHash:sha(Buffer.from(url)), candidateBodySha256:candidate.row.sha256,
      asset:entry.filename, evidence:'same-origin-path-only', identityVerified:false});
  }
  if (new Set(provisional.map(x => x.candidateBodySha256)).size !== provisional.length)
    throw Error('Distinct image-preview references reuse the same PNG body');
  return provisional;
}

function parseIndex(filename) {
  return fs.readFileSync(filename, 'utf8').split(/\r?\n/).filter(Boolean).map((row, i) => {
    try {return JSON.parse(row);} catch {throw Error('Invalid resources JSONL row ' + (i + 1));}
  });
}
export function localize(cumulativeDir, resourceDir, targetDir, options = {}) {
  const provisionalImagePath = options.provisionalImagePath === true;
  const cumulative = path.resolve(cumulativeDir), archive = path.resolve(resourceDir);
  const output = path.resolve(targetDir);
  for (const root of [cumulative, archive])
    if (output === root || output.startsWith(root + path.sep))
      throw Error('Output must be outside all input directories');
  if (fs.existsSync(output)) throw Error('Output already exists: ' + output);
  const sourceHtml = fs.readFileSync(path.join(cumulative, 'index.html'), 'utf8');
  const sourceAudit = fs.readFileSync(path.join(cumulative, 'audit.json'));
  const sourceEvidence = JSON.parse(sourceAudit.toString('utf8'));
  if (provisionalImagePath &&
      (sourceEvidence.status !== 'provisional-image-preview-assembly' ||
       sourceEvidence.provisionalImagePreview !== true ||
       !(sourceEvidence.unidentifiedImageTurns > 0)))
    throw Error('Provisional image localization requires an explicitly assembled image preview');
  const sourceRefs = fs.readFileSync(path.join(cumulative, 'resource-references.json'));
  if (!sourceHtml.includes("script-src 'none'") || !sourceHtml.includes('id="cumulative-turns"'))
    throw Error('Input is not the inert cumulative DOM');
  const index = parseIndex(path.join(archive, 'resources.jsonl'));
  const choices = new Map(), styles = [];
  // A recorded redirect establishes identity even when the original DOM URL
  // differs from the final downloaded URL (e.g. Google's favicon service).
  // Only the exact, same-session/same-request 301 chain is trusted here.
  const redirects = new Map();
  for (const row of index) {
    if (row.status !== 'redirect-no-body' ||
        !/^https:\/\/www\.google\.com\/s2\/favicons(?:\?|$)/.test(row.url || ''))
      continue;
    const request = String(row.session) + ':' + String(row.requestId);
    const urls = redirects.get(request) || [];
    urls.push(row.url);
    redirects.set(request, urls);
  }
  let redirectAliases = 0;
  let ignored = 0;
  for (const row of index) {
    if (row.status !== 'saved' || typeof row.url !== 'string' || !row.sha256) continue;
    const ext = allowedType(row);
    const url = key(row.url);
    if (!ext || !url) {ignored++;continue;}
    const originalHostAllowed = allowedHost(new URL(url).hostname);
    const isFavicon = row.resourceType === 'Image' && row.mimeType === 'image/png' &&
      /^https:\/\/t[0-9]\.gstatic\.com\/faviconV2(?:\?|$)/.test(url);
    const aliasNames = isFavicon ?
      redirects.get(String(row.session) + ':' + String(row.requestId)) || [] : [];
    if (!originalHostAllowed && !aliasNames.length) {ignored++;continue;}
    if (choices.has(url)) continue;
    const entry = {row, filename: 'assets/' + row.sha256 + ext, ext, url};
    choices.set(url, entry);
    for (const name of aliasNames) {
      const originalUrl = key(name);
      if (originalUrl && !choices.has(originalUrl)) {
        choices.set(originalUrl, entry);
        redirectAliases++;
      }
    }
    if (ext === '.css') styles.push(entry);
  }
  const provisionalCandidates = provisionalImagePath ?
    provisionalImageChoices(sourceHtml, index, choices) : [];
  const unresolved = new Set(), matched = new Set();
  const prepared = new Map(), stylesheetFiles = [], copied = [];
  // Verify all candidates before creating output: corrupt input cannot create partial output.
  for (const entry of new Set(choices.values())) {
    let content = safeResourceFile(archive, entry.row);
    if (provisionalCandidates.some(x => x.candidateBodySha256 === entry.row.sha256) &&
        !content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      throw Error('Image-preview candidate is not a PNG');
    if (entry.ext === '.woff2' && content.toString('ascii', 0, 4) !== 'wOF2')
      throw Error('Invalid WOFF2 signature in indexed font');
    if (entry.ext === '.css') {
      // Browser-origin @import strings are not required for this frozen document;
      // stripping them prevents local-file imports from escaping the asset pack.
      const noImports = content.toString('utf8').replace(
        /@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/gi,
        '/* blocked CSS import */');
      const edited = rewriteCss(noImports, entry.url, choices, unresolved);
      content = Buffer.from(edited, 'utf8');
    }
    if (entry.ext === '.svg' &&
        /<script\b|<iframe\b|<object\b|<embed\b|\bon[a-z]+\s*=|javascript:/i.test(content.toString('utf8')))
      throw Error('SVG with executable content rejected');
    prepared.set(entry.filename, content);
    copied.push({originalUrl: entry.url, originalSha256: entry.row.sha256,
      localFile: entry.filename, bytes: content.length,
      modifiedCss: entry.ext === '.css'});
  }
  for (const entry of styles) stylesheetFiles.push(entry.filename);
  let html = rewriteMarkup(sourceHtml, choices, unresolved, matched);
  if (provisionalCandidates.some(candidate =>
      ![...matched].some(url => sha(Buffer.from(url)) === candidate.sourceUrlHash)))
    throw Error('Image-preview candidate was not localized');
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
  const report = {status:provisionalImagePath ? 'offline-image-preview-provisional' :
      'offline-localized-static-assets', stylesheets:styles.length,
    provisionalImageCandidates:provisionalCandidates,
    staticFiles:prepared.size, mediaReferencesMatched:matched.size,
    resolvedRedirectAliases:redirectAliases, unresolvedReferences:[...unresolved].sort(), ignoredNonStaticOrNonFirstParty:ignored,
    limitations:['Original React/JavaScript deliberately disabled',
      'Referenced assets not in CDP archive remain unavailable',
      'Original document/body context and theme may affect CSS',
      'No inference about complete RAW message coverage',
      ...(provisionalImagePath ? ['Third-party PNG substitutions were chosen by unique URL origin/path only',
        'Changed query parameters may imply different images; preview associations are not proven'] : [])]};
  fs.writeFileSync(path.join(output, 'localization-audit.json'),
    JSON.stringify(report, null, 2) + '\n', {flag:'wx', mode:0o600});
  return {output, stylesheets:styles.length, staticFiles:prepared.size,
    mediaReferencesMatched:matched.size, resolvedRedirectAliases:redirectAliases,
    unresolved:unresolved.size, ignored,
    provisionalImageCandidates:provisionalCandidates.length};
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [cumulative, resources, output, flag] = process.argv.slice(2);
  if (!cumulative || !resources || !output ||
      (flag !== undefined && flag !== '--provisional-image-path') ||
      process.argv.length !== (flag ? 6 : 5)) {
    console.error('Usage: node localize-rendered-resources.mjs <cumulative-dir> <web-analyze-dir> <new-output-dir> [--provisional-image-path]');
    process.exitCode = 2;
  } else {
    try {console.log(JSON.stringify(localize(cumulative,resources,output,
      {provisionalImagePath:flag === '--provisional-image-path'}), null, 2));}
    catch(error) {console.error(error.message); process.exitCode=1;}
  }
}
