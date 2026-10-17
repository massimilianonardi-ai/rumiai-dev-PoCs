#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { main as chatgptExtract } from './chatgpt-extract.mjs';

const entrypoint = fileURLToPath(import.meta.url);
const references = [
  ['RumiAI Avatar', '6ad13a5b-e9f0-83eb-8519-9e2d8c8097f3'],
  ['Mirror chat su GitHub', '6ad093bb-2500-83eb-8519-9e2d8c8097f3'],
  ['AI+CHAOS', '6ad1c0b3-f42c-83eb-bfbc-4e44c80863dc'],
  ['chat mlp evo', '6ad1c0d5-49ec-83eb-a79b-85b04b938835'],
  ['Integrare Chat e Work', '6ad1c0f5-7110-83eb-bc19-356d48fc1259']
];

export async function main(args = process.argv.slice(2), extract = chatgptExtract)
{
  if (args.length !== 1 || args.includes('--help'))
  {
    process.stderr.write('usage: node reference-publication.mjs <project-evidence-directory>\n');
    return 2;
  }
  process.umask(0o077);
  const directory = path.resolve(args[0]);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const outcomes = [];
  for (const [title, id] of references)
  {
    process.stderr.write('Publishing ' + title + ' (' + id + ')\n');
    let code = 1;
    try
    {
      code = await extract(['https://chatgpt.com/share/' + id, directory]);
    }
    catch (error)
    {
      process.stderr.write('publication.unexpected-failure: ' +
        String(error.code || error.name || 'error') + '\n');
    }
    outcomes.push({ title, id, status: code === 0 ? 'published' : 'failed' });
  }
  const report = {
    checkedAt: new Date().toISOString(),
    count: references.length,
    published: outcomes.filter(x => x.status === 'published').length,
    htmlFidelityVerified: false,
    fullFidelityReleaseAccepted: false,
    outcomes
  };
  const file = path.join(directory, 'reference-publication-' +
    report.checkedAt.replace(/[:.]/g, '-') + '-' + process.pid + '.json');
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600, flag: 'wx'
  });
  process.stdout.write(JSON.stringify({ report: file, ...report }, null, 2) + '\n');
  return report.published === references.length ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === entrypoint)
  process.exitCode = await main();
