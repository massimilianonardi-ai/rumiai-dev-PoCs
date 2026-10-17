import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ENTRYPOINT = fileURLToPath(new URL('./export-share.mjs', import.meta.url));
const SHARES =
[
  { id: '6ad13a5b-e9f0-83eb-8519-9e2d8c8097f3', kind: 'avatar', requiredImages: 3 },
  { id: '6ad093bb-2500-83eb-9edb-3f341ac567d4', kind: 'mirror', requiredFiles: 16 },
  { id: '6ad1c0b3-f42c-83eb-bfbc-4e44c80863dc', kind: 'reference' },
  { id: '6ad1c0d5-49ec-83eb-a79b-85b04b938835', kind: 'reference' },
  { id: '6ad1c0f5-7110-83eb-bc19-356d48fc1259', kind: 'reference' }
];

function digest(bytes)
{
  return createHash('sha256').update(bytes).digest('hex');
}

function requireCondition(ok, identity)
{
  if (!ok) throw new Error(identity);
}

async function readJson(filename)
{
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

async function validateChecksums(directory)
{
  const sums = (await fs.readFile(path.join(directory, 'SHA256SUMS'), 'utf8'))
    .split('\n').filter(Boolean);
  requireCondition(sums.length >= 10, 'acceptance.checksums-absent');
  for (const line of sums)
  {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    requireCondition(Boolean(match), 'acceptance.checksum-record-invalid');
    const relative = match[2];
    let bytes;
    if (relative === 'conversation.raw.json (uncompressed captured snapshot)')
      bytes = gunzipSync(await fs.readFile(path.join(directory, 'conversation.raw.json.gz')));
    else
    {
      const filename = path.resolve(directory, relative);
      requireCondition(filename.startsWith(directory + path.sep),
        'acceptance.artifact-path-escaped');
      bytes = await fs.readFile(filename);
    }
    requireCondition(digest(bytes) === match[1], 'acceptance.checksum-mismatch');
  }
  return sums.length;
}

async function validateArchive(result, share)
{
  const directory = path.resolve(result.directory);
  const acquisition = await readJson(path.join(directory, 'ACQUISITION.json'));
  const audit = await readJson(path.join(directory, 'AUDIT.json'));
  const media = await readJson(path.join(directory, 'MEDIA.json'));
  const files = await readJson(path.join(directory, 'FILES.json'));
  const checksums = await validateChecksums(directory);
  const zip = await fs.readFile(result.zip);
  requireCondition(zip.length >= 22 && zip.readUInt32LE(0) === 0x04034b50,
    'acceptance.zip-header-invalid');
  requireCondition(zip.readUInt32LE(zip.length - 22) === 0x06054b50,
    'acceptance.zip-directory-invalid');
  requireCondition(result.mappingNodes > 0 && result.messageCount > 0,
    'acceptance.structured-transcript-empty');
  requireCondition(audit.conversation.mapping_nodes === result.mappingNodes,
    'acceptance.mapping-count-mismatch');
  requireCondition(audit.transcript.visible_messages === result.messageCount,
    'acceptance.message-count-mismatch');
  requireCondition(acquisition.source.endsWith('/' + share.id),
    'acceptance.share-identity-mismatch');
  requireCondition(media.length === result.imagesReferenced,
    'acceptance.media-count-mismatch');
  requireCondition(files.length === result.filesReferenced,
    'acceptance.sandbox-count-mismatch');
  requireCondition(result.imagesPublicUnresolved === 0,
    'acceptance.public-images-unresolved');
  requireCondition(result.filesMissing === 0,
    'acceptance.sandbox-files-unresolved');
  requireCondition(result.cleanup?.verified === true &&
    result.cleanup.pagePresent === false, 'acceptance.page-cleanup-unverified');
  if (share.requiredImages !== undefined)
    requireCondition(result.imagesReferenced === share.requiredImages &&
      result.imagesDownloaded === share.requiredImages,
      'acceptance.avatar-images-incomplete');
  if (share.requiredFiles !== undefined)
    requireCondition(result.filesReferenced >= share.requiredFiles &&
      result.filesDownloaded === result.filesReferenced,
      'acceptance.mirror-files-incomplete');
  for (const item of [...media, ...files])
  {
    if (item.status === 'downloaded')
    {
      requireCondition(typeof item.local_path === 'string' &&
        /^[a-f0-9]{64}$/.test(item.sha256),
        'acceptance.download-manifest-invalid');
      const file = path.resolve(directory, item.local_path);
      requireCondition(file.startsWith(directory + path.sep),
        'acceptance.download-path-escaped');
      requireCondition(digest(await fs.readFile(file)) === item.sha256,
        'acceptance.download-hash-mismatch');
    }
  }
  return {
    title: result.title,
    mappingNodes: result.mappingNodes,
    messageCount: result.messageCount,
    imagesReferenced: result.imagesReferenced,
    imagesDownloaded: result.imagesDownloaded,
    imagesPublicUnresolved: result.imagesPublicUnresolved,
    imagesDeferredAuthenticated: result.imagesDeferredAuthenticated,
    filesReferenced: result.filesReferenced,
    filesDownloaded: result.filesDownloaded,
    filesMissing: result.filesMissing,
    checkedChecksums: checksums,
    cleanup: result.cleanup,
    archiveDirectory: directory,
    archiveZip: result.zip,
    fullFidelityComplete: false
  };
}

async function run()
{
  const args = process.argv.slice(2);
  if (args.length > 2 || args.includes('--help') || !process.env.WEB_CONTROL_CMD)
  {
    process.stderr.write('usage: WEB_CONTROL_CMD=<isolated-pwc-client> node reference-acceptance.mjs [archive-root] [seconds]\n');
    process.stderr.write('The existing PWC service must be reachable; no provider is installed or changed.\n');
    return 2;
  }
  const output = path.resolve(args[0] || './archive');
  const seconds = args[1] === undefined ? 30 : Number(args[1]);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30)
  {
    process.stderr.write('acceptance.invalid-seconds: expected 1..30\n');
    return 2;
  }
  // Check the explicitly chosen isolated client before the exporter can
  // invoke its normal provider-independent srv fallback.
  try
  {
    await execFileAsync(process.env.WEB_CONTROL_CMD, ['status'],
      { timeout: 10000, maxBuffer: 1024 * 1024 });
  }
  catch
  {
    process.stderr.write('acceptance.pwc-controller-unreachable: start the isolated PWC controller first\n');
    return 2;
  }
  process.umask(0o077);
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const results = [];
  for (const share of SHARES)
  {
    process.stderr.write('Checking share ' + share.id + '\n');
    const url = 'https://chatgpt.com/share/' + share.id;
    try
    {
      const response = await execFileAsync(process.execPath,
        [ENTRYPOINT, url, output, '--seconds', String(seconds)],
        { maxBuffer: 2 * 1024 * 1024, timeout: 15 * 60 * 1000 });
      const exported = JSON.parse(response.stdout);
      const evidence = await validateArchive(exported, share);
      results.push({ id: share.id, kind: share.kind, status: 'artifact-pass', evidence });
    }
    catch (error)
    {
      const line = String(error.stderr || '').split('\n')
        .find(value => /Diagnostic:/.test(value));
      const diagnostic = line?.trim().replace(/^Diagnostic: /, '') || null;
      results.push({
        id: share.id,
        kind: share.kind,
        status: 'error',
        error: String(error.message || error).match(/acceptance\.[a-z-]+/)?.[0] ||
          'acceptance.export-or-validation-failed',
        diagnostic
      });
    }
  }
  const result = {
    schema: 1,
    phase: 'anonymous-public-artifact-acceptance',
    expectedProvider: 'pwc-web-control via WEB_CONTROL_CMD',
    checkedAt: new Date().toISOString(),
    passed: results.filter(item => item.status === 'artifact-pass').length,
    total: SHARES.length,
    htmlFidelityVerified: false,
    physicalSiteCompletenessVerified: false,
    fullFidelityReleaseAccepted: false,
    results
  };
  const filename = path.join(output,
    'reference-acceptance-' + result.checkedAt.replace(/[:.]/g, '-') +
    '-' + String(process.pid) + '.json');
  await fs.writeFile(filename, JSON.stringify(result, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ report: filename, ...result }, null, 2) + '\n');
  return result.passed === SHARES.length ? 0 : 1;
}

process.exitCode = await run();
