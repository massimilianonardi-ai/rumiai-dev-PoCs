import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, safeUrl, sanitize } from '../src/log.mjs';

test('redacts auth fields and URL query/hash', () =>
{
  assert.equal(safeUrl('https://user:pass@example.org/a?token=secret&x=1#section'), 'https://example.org/a?token=%5Bredacted%5D&x=%5Bredacted%5D#[redacted]');
  assert.equal(sanitize({ name: 'https://example.org/resource?q=private' }).name, 'https://example.org/resource?q=%5Bredacted%5D');
  assert.deepEqual(sanitize({ cookie: 'abc', request: { authorization: 'Bearer abc', url: 'https://a.test/?k=abc' } }),
    { cookie: '[redacted]', request: { authorization: '[redacted]', url: 'https://a.test/?k=%5Bredacted%5D' } });
});

test('writes ordered isolated streams and refuses overwrite', async () =>
{
  const base = await mkdtemp(join(tmpdir(), 'web-analyze-test-'));
  const folder = join(base, 'run');
  try
  {
    const log = await EventLog.create(folder);
    log.record('interaction', 'click', { x: 4 });
    log.record('network', 'request', { url: 'https://a.test/?token=abc' });
    const summary = await log.finish({ stopReason: 'test' });
    assert.equal(summary.totalEvents, 2);
    const records = JSON.parse((await readFile(join(folder, 'interaction.jsonl'), 'utf8')).trim());
    assert.equal(records.sequence, 1);
    assert.equal(records.event, 'click');
    assert.equal((await stat(folder)).mode & 0o777, 0o700);
    assert.equal((await stat(join(folder, 'network.jsonl'))).mode & 0o777, 0o600);
    await assert.rejects(() => EventLog.create(folder), /EEXIST/);
  }
  finally
  {
    await rm(base, { recursive: true, force: true });
  }
});
