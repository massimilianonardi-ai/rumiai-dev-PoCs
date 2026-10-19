import { mkdir, open, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SENSITIVE = /(?:password|passwd|secret|token|auth|cookie|session|api[-_]?key|csrf|jwt|bearer|signature|credential|authorization|set-cookie)/i;

export function safeUrl(value)
{
  if (typeof value !== 'string') return null;
  try
  {
    const url = new URL(value);
    if (!['http:', 'https:', 'about:', 'blob:', 'data:', 'file:'].includes(url.protocol)) return '[non-http-url]';
    if (url.protocol === 'data:' || url.protocol === 'blob:') return `[${url.protocol.slice(0, -1)}-url]`;
    if (url.username || url.password) { url.username = ''; url.password = ''; }
    for (const key of url.searchParams.keys()) url.searchParams.set(key, '[redacted]');
    url.hash = url.hash ? '#[redacted]' : '';
    return url.toString();
  }
  catch
  {
    return '[invalid-url]';
  }
}

function _truncate(value, max = 250)
{
  return String(value).slice(0, max);
}

export function sanitize(value, key = '', depth = 0)
{
  if (SENSITIVE.test(key)) return '[redacted]';
  if (depth > 8) return '[depth-limit]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string')
  {
    if (/url|href|origin|documenturl/i.test(key) || /^https?:\/\//i.test(value)) return safeUrl(value);
    return _truncate(value);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, key, depth + 1));
  if (typeof value !== 'object') return String(value);
  const result = {};
  for (const [name, item] of Object.entries(value).slice(0, 100)) result[name] = sanitize(item, name, depth + 1);
  return result;
}

export class EventLog
{
  constructor(root, streams)
  {
    this.root = root;
    this.streams = streams;
    this.handles = new Map();
    this.counts = {};
    this.sequence = 0;
    this.started = performance.now();
    this.pending = Promise.resolve();
    this.closed = false;
    this.failure = null;
    this.queuedWrites = 0;
    this.dropped = {};
  }

  static async create(root)
  {
    const output = resolve(root);
    await mkdir(output, { mode: 0o700 }); // Refuse to overwrite an existing evidence run.
    const log = new EventLog(output, ['lifecycle', 'interaction', 'dom', 'network', 'console', 'performance', 'error']);
    try
    {
      for (const stream of log.streams) log.handles.set(stream, await open(join(output, `${stream}.jsonl`), 'wx', 0o600));
      return log;
    }
    catch (error)
    {
      await log.close();
      throw error;
    }
  }

  record(stream, event, data = {})
  {
    if (this.closed || this.failure) return;
    if (!this.handles.has(stream)) throw new Error(`unknown event stream: ${stream}`);
    if (this.queuedWrites >= 20000)
    {
      this.dropped[stream] = (this.dropped[stream] ?? 0) + 1;
      return;
    }
    this.queuedWrites++;
    const row = JSON.stringify
    ({
      sequence: ++this.sequence,
      time: new Date().toISOString(),
      elapsedMs: +(performance.now() - this.started).toFixed(3),
      event,
      data: sanitize(data)
    }) + '\n';
    this.counts[stream] = (this.counts[stream] ?? 0) + 1;
    this.pending = this.pending.then(async () =>
    {
      try { await this.handles.get(stream).write(row); }
      finally { this.queuedWrites--; }
    }).catch(error => { this.failure = error; });
  }

  async finish(summary)
  {
    await this.pending;
    await this.close();
    const document = { ...summary, totalEvents: this.sequence, counts: this.counts, dropped: this.dropped, logError: this.failure?.message ?? null };
    await writeFile(join(this.root, 'summary.json'), JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (this.failure) throw this.failure;
    return document;
  }

  async close()
  {
    if (this.closed) return;
    this.closed = true;
    await this.pending;
    await Promise.all([...this.handles.values()].map(handle => handle.close()));
  }
}
