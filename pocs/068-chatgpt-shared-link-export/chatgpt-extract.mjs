#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { exportSharedLink, webControl } from './export-share.mjs';
import { publishArchive } from './publish-archive.mjs';

const entrypoint = fileURLToPath(import.meta.url);

export async function main(args = process.argv.slice(2), extract = exportSharedLink,
  publish = publishArchive)
{
  if (args.length !== 2 || args.includes('--help'))
  {
    process.stderr.write('usage: chatgpt-extract <https://chatgpt.com/share/id> <destination-directory>\n');
    process.stderr.write('Requires the running web-control 3 provider and Chromium for offline PDF rendering.\n');
    return 2;
  }
  const destination = path.resolve(args[1]);
  process.umask(0o077);
  try
  {
    if (extract === exportSharedLink && process.env.WEB_CONTROL_CMD)
    {
      // An explicitly selected isolated PWC controller must never silently
      // fall back to the installed/default srv provider.
      try { await webControl('status'); }
      catch { throw new Error('chatgpt-extract.isolated-controller-unavailable'); }
    }
    const extracted = await extract(args[0], destination, 30);
    const published = await publish(extracted.directory, extracted.zip);
    process.stdout.write(JSON.stringify({
      ...extracted, ...published,
      imagesPublicUnresolved: extracted.imagesPublicUnresolved,
      filesMissing: extracted.filesMissing,
      observationComplete: false
    }, null, 2) + '\n');
    return 0;
  }
  catch (error)
  {
    // The original extractor preserves its failure evidence under the selected
    // destination. Do not interpolate raw source payloads or signed URLs.
    const message = String(error.code || error.message || 'publication.failed')
      .replace(/https?:\/\/\S+/g, '[url]').slice(0, 240);
    process.stderr.write('chatgpt-extract: ' + message + '\n');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === entrypoint)
  process.exitCode = await main();
