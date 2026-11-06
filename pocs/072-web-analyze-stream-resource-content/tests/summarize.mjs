import fs from 'node:fs';
import path from 'node:path';

const runDir = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.statSync(runDir).isDirectory())
  throw new Error('run-directory-required');
const readJsonl = file => fs.readFileSync(path.join(runDir, file), 'utf8')
  .split('\n').filter(Boolean).map(line => JSON.parse(line));
const resources = readJsonl('resources.jsonl');
const responseOnly = resources.filter(row => row.requestProvenance === 'response-only');
const wire = readJsonl('cdp-wire.jsonl');
const commands = new Map();
const errors = new Map();
for (const row of wire)
{
  let packet;
  try { packet = JSON.parse(row.raw); } catch (_) { continue; }
  if (row.direction === 'outbound' &&
      packet.method === 'Network.streamResourceContent')
    commands.set(packet.id, true);
  else if (row.direction === 'inbound' && commands.has(packet.id))
  {
    const error = packet.error;
    const category = error ? `${error.code}:${
      /provided ID does not exists/i.test(error.message || '') ?
        'request-handle-gone' : 'other-cdp-error'}` : 'success';
    errors.set(category, (errors.get(category) || 0) + 1);
  }
}
const count = (fn) => responseOnly.filter(fn).length;
console.log(JSON.stringify({
  responseOnlyRows: responseOnly.length,
  diskCacheRows: count(row => row.fromDiskCache === true),
  savedRows: count(row => row.status === 'saved'),
  savedViaStream: count(row => row.status === 'saved' &&
    row.source === 'Network.streamResourceContent'),
  bodyUnavailable: count(row => row.status === 'body-unavailable'),
  streamStatusCounts: Object.fromEntries(responseOnly.reduce((map, row) => {
    const status = row.streamCapture?.status || 'not-attempted';
    map.set(status, (map.get(status) || 0) + 1);
    return map;
  }, new Map())),
  streamCommandResults: Object.fromEntries(errors)
}, null, 2));
