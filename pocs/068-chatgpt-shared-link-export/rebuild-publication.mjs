#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { publishArchive } from './publish-archive.mjs';

const entrypoint = fileURLToPath(import.meta.url);
const originals = [
  'conversation.raw.json.gz', 'VISIBLE_MESSAGES.jsonl', 'TURN_SURFACES.jsonl',
  'TRANSCRIPT.md', 'NON_TEXT_PARTS.json', 'MEDIA.json', 'FILES.json',
  'AUDIT.json', 'ACQUISITION.json'
];

async function exists(filename)
{
  return fs.access(filename).then(() => true, () => false);
}

export async function rebuildOne(source, destination, publish = publishArchive)
{
  const input = path.resolve(source);
  const output = path.resolve(destination);
  const data = path.join(input, 'data');
  if (!await exists(path.join(data, 'AUDIT.json')))
    throw new Error('rebuild.source-evidence-missing');
  if (output === input || output.startsWith(input + path.sep))
    throw new Error('rebuild.destination-inside-source');
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const basename = path.basename(input);
  let directory, zip;
  for (let i = 1; ; i++)
  {
    const suffix = i === 1 ? '' : ' (' + i + ')';
    directory = path.join(output, basename + suffix);
    zip = path.join(output, basename + suffix + '.zip');
    if (await exists(zip)) continue;
    try { await fs.mkdir(directory, { mode: 0o700 }); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  for (const filename of originals)
    await fs.copyFile(path.join(data, filename), path.join(directory, filename));
  await fs.copyFile(path.join(data, 'EXPORT-README.md'),
    path.join(directory, 'README.md'));
  await fs.copyFile(path.join(data, 'SHA256SUMS'),
    path.join(directory, 'SHA256SUMS'));
  for (const name of ['media', 'files'])
  {
    if (await exists(path.join(input, name)))
      await fs.cp(path.join(input, name), path.join(directory, name), {
        recursive: true, force: false, errorOnExist: true
      });
  }
  return publish(directory, zip);
}

export async function main(args = process.argv.slice(2), rebuild = rebuildOne)
{
  if (args.length !== 2 || args.includes('--help'))
  {
    process.stderr.write('usage: node rebuild-publication.mjs <published-chat-or-collection> <project-output-dir>\n');
    return 2;
  }
  const source = path.resolve(args[0]);
  const destination = path.resolve(args[1]);
  process.umask(0o077);
  if (source === destination || destination.startsWith(source + path.sep))
  {
    process.stderr.write('rebuild.destination-inside-source\n');
    return 2;
  }
  let inputs;
  if (await exists(path.join(source, 'data', 'AUDIT.json')))
    inputs = [source];
  else
  {
    const entries = await fs.readdir(source, { withFileTypes: true });
    inputs = (await Promise.all(entries.filter(x => x.isDirectory())
      .map(async x => path.join(source, x.name))))
      .filter(() => true);
    const usable = [];
    for (const item of inputs)
      if (await exists(path.join(item, 'data', 'AUDIT.json'))) usable.push(item);
    inputs = usable;
  }
  if (!inputs.length)
  {
    process.stderr.write('rebuild.source-evidence-missing\n');
    return 2;
  }
  const results = [];
  for (const input of inputs)
  {
    try
    {
      const exported = await rebuild(input, destination);
      const complete = exported.chronologyPlacementVerified !== false;
      results.push({ source: input, output: exported.directory,
        chronologyComplete: complete, status: complete ? 'pass' : 'incomplete' });
    }
    catch (error)
    {
      results.push({ source: input, status: 'failed',
        diagnostic: String(error.code || error.message).split('\n')[0].slice(0, 120) });
    }
  }
  const report = {
    count: results.length,
    successful: results.filter(x => x.status === 'pass').length,
    htmlFidelityVerified: false,
    fullFidelityReleaseAccepted: false,
    results
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.successful === results.length ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === entrypoint)
  process.exitCode = await main();
