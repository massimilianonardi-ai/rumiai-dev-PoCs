import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { publishArchive } from '../publish-archive.mjs';
import { main as extractMain } from '../chatgpt-extract.mjs';

function zipContents(bytes)
{
  const entries = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50)
  {
    const compressed = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, inflateRawSync(bytes.subarray(start, start + compressed)));
    offset = start + compressed;
  }
  return entries;
}

test('publication produces GitHub Markdown, offline HTML, PDF and complete ZIP', async () =>
{
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-publication-test-'));
  try
  {
    const directory = path.join(root, 'Conversation');
    await fs.mkdir(path.join(directory, 'media'), { recursive: true });
    await fs.mkdir(path.join(directory, 'files'), { recursive: true });
    await fs.writeFile(path.join(directory, 'media', '001-test.png'), Buffer.from('image'));
    await fs.writeFile(path.join(directory, 'files', '001-a.txt'), 'attachment');
    await fs.writeFile(path.join(directory, 'AUDIT.json'), JSON.stringify({
      conversation: { title: 'Example & conversation' },
      transcript: { visible_messages: 2 }
    }));
    await fs.writeFile(path.join(directory, 'ACQUISITION.json'), JSON.stringify({
      source: 'https://chatgpt.com/share/6ad13a5b-e9f0-83eb-8519-9e2d8c8097f3'
    }));
    await fs.writeFile(path.join(directory, 'MEDIA.json'), JSON.stringify([
      { file_id: 'test', status: 'downloaded', local_path: 'media/001-test.png' },
      { file_id: 'user-upload', status: 'deferred-authenticated' }
    ]));
    await fs.writeFile(path.join(directory, 'FILES.json'), JSON.stringify([
      { file_name: 'a.txt', status: 'downloaded', local_path: 'files/001-a.txt' }
    ]));
    await fs.writeFile(path.join(directory, 'TRANSCRIPT.md'),
      '# Example & conversation\n\nConversation ID: a\n\n<!-- metadata -->\n\n' +
      '## USER\n\n![test](media/001-test.png)\n\n' +
      '[immagine non scaricata; vedi NON_TEXT_PARTS.json]\n\n' +
      '## ASSISTANT\n\n**Hello**\n\n~~~js\nconst x = 2;\n~~~\n\n' +
      '| A | B |\n|---|---|\n| 1 | 2 |\n\n');
    for (const filename of ['conversation.raw.json.gz','VISIBLE_MESSAGES.jsonl',
      'TURN_SURFACES.jsonl','NON_TEXT_PARTS.json','SHA256SUMS'])
      await fs.writeFile(path.join(directory, filename), 'fixture');
    await fs.writeFile(path.join(directory, 'README.md'), '# Technical export\n');
    const archive = path.join(root, 'Conversation.zip');
    await fs.writeFile(archive, 'previous ZIP');

    const outcome = await publishArchive(directory, archive, {
      async renderPdf(htmlFile, pdfFile)
      {
        const html = await fs.readFile(htmlFile, 'utf8');
        assert.match(html, /<strong>Hello<\/strong>/);
        assert.match(html, /<table>/);
        assert.match(html, /src="media\/001-test.png"/);
        await fs.writeFile(pdfFile, '%PDF-1.7\n' + 'x'.repeat(256) + '\n%%EOF\n');
      }
    });

    assert.equal(outcome.published, true);
    assert.equal(outcome.htmlFidelityVerified, false);
    const markdown = await fs.readFile(outcome.markdown, 'utf8');
    assert.match(markdown, /^# Example & conversation/);
    assert.match(markdown, /!\[test\]\(media\/001-test.png\)/);
    assert.match(markdown, /files\/001-a.txt/);
    assert.match(markdown, /richiede fase autenticata/);
    assert.match(markdown, /data\/NON_TEXT_PARTS\.json/);
    const html = await fs.readFile(outcome.html, 'utf8');
    assert.match(html, /media\/001-test.png/);
    assert.doesNotMatch(html, /<script/i);
    const entries = zipContents(await fs.readFile(archive));
    for (const item of ['README.md', 'conversation.html', 'conversation.pdf',
      'media/001-test.png','files/001-a.txt','data/TRANSCRIPT.md',
      'data/AUDIT.json','data/EXPORT-README.md','data/SHA256SUMS'])
      assert.equal(entries.has(item), true, item + ' not in ZIP');
    assert.equal((await fs.readFile(path.join(directory, 'data', 'SHA256SUMS'), 'utf8'))
      .includes('conversation.pdf'), true);
  }
  finally
  {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('chatgpt-extract uses the requested directory and publishes only after extraction', async () =>
{
  const calls = [];
  const exit = await extractMain(['https://chatgpt.com/share/example', '/tmp/project-exports'],
    async (url, directory, seconds) =>
    {
      calls.push(['extract', url, directory, seconds]);
      return { directory: directory + '/archive', zip: directory + '/archive.zip',
        imagesPublicUnresolved: 0, filesMissing: 0,
        cleanup: { verified: true, pagePresent: false } };
    },
    async (directory, zip) =>
    {
      calls.push(['publish', directory, zip]);
      return { published: true };
    });
  assert.equal(exit, 0);
  assert.equal(calls[0][0], 'extract');
  assert.equal(calls[0][2], '/tmp/project-exports');
  assert.equal(calls[0][3], 30);
  assert.equal(calls[1][0], 'publish');
  assert.equal(calls[1][2], '/tmp/project-exports/archive.zip');
});
