import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { publishArchive } from '../publish-archive.mjs';
import { main as extractMain } from '../chatgpt-extract.mjs';
import { buildChronologicalPublication } from '../chronological-publication.mjs';
import { rebuildOne } from '../rebuild-publication.mjs';

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
      transcript: { visible_messages: 2 },
      nodes: [
        { ordinal: 1, classification: 'visible_candidate' },
        { ordinal: 2, classification: 'internal_reasoning' },
        { ordinal: 3, classification: 'zero_weight' },
        { ordinal: 4, classification: 'visible_candidate' },
        { ordinal: 5, classification: 'tool_traffic' }
      ]
    }));
    await fs.writeFile(path.join(directory, 'ACQUISITION.json'), JSON.stringify({
      source: 'https://chatgpt.com/share/6ad13a5b-e9f0-83eb-8519-9e2d8c8097f3'
    }));
    await fs.writeFile(path.join(directory, 'MEDIA.json'), JSON.stringify([
      { file_id: 'test', status: 'downloaded', local_path: 'media/001-test.png',
        references: [{ ordinal: 3 }] },
      { file_id: 'user-upload', status: 'deferred-authenticated',
        references: [{ ordinal: 1 }] }
    ]));
    await fs.writeFile(path.join(directory, 'FILES.json'), JSON.stringify([
      { file_name: 'a.txt', status: 'downloaded', local_path: 'files/001-a.txt', ordinal: 5 }
    ]));
    await fs.writeFile(path.join(directory, 'TRANSCRIPT.md'),
      '# Example & conversation\n\nConversation ID: a\n\n<!-- metadata -->\n\n' +
      '## USER\n\n![test](media/001-test.png)\n\n' +
      '[immagine non scaricata; vedi NON_TEXT_PARTS.json]\n\n' +
      '## ASSISTANT\n\n**Hello**\n\n~~~js\nconst x = 2;\n~~~\n\n' +
      '| A | B |\n|---|---|\n| 1 | 2 |\n\n');
    await fs.writeFile(path.join(directory, 'VISIBLE_MESSAGES.jsonl'),
      [
        { ordinal: 1, role: 'user', text: 'Create an image',
          message: { content: { parts: ['Create an image'] } } },
        { ordinal: 4, role: 'assistant', text: '**Hello**',
          message: { content: { parts: [
            '**Hello**\n\n~~~js\nconst x = 2;\n~~~\n\n' +
            '| A | B |\n|---|---|\n| 1 | 2 |'
          ] } } }
      ].map(item => JSON.stringify(item)).join('\n') + '\n');
    await fs.writeFile(path.join(directory, 'TURN_SURFACES.jsonl'),
      JSON.stringify({ index: 0, activities: [] }) + '\n');
    for (const filename of ['conversation.raw.json.gz','NON_TEXT_PARTS.json','SHA256SUMS'])
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
    assert.match(markdown, /!\[immagine\]\(media\/001-test.png\)/);
    assert.match(markdown, /files\/001-a.txt/);
    assert.match(markdown, /non scaricabile senza autenticazione/);
    assert.match(markdown, /Thinking/);
    const first = markdown.indexOf('## UTENTE');
    const image = markdown.indexOf('![immagine](media/001-test.png)');
    const last = markdown.indexOf('## ASSISTENTE\n');
    const file = markdown.indexOf('files/001-a.txt');
    assert.ok(first < image && image < last && last < file,
      'chronology must preserve generated image and attachment positions');
    const html = await fs.readFile(outcome.html, 'utf8');
    assert.match(html, /media\/001-test.png/);
    assert.match(html, /<details class="activity">/);
    assert.doesNotMatch(html, /<script/i);
    const entries = zipContents(await fs.readFile(archive));
    for (const item of ['README.md', 'conversation.html', 'conversation.pdf',
      'media/001-test.png','files/001-a.txt','data/TRANSCRIPT.md',
      'data/AUDIT.json','data/EXPORT-README.md','data/SHA256SUMS'])
      assert.equal(entries.has(item), true, item + ' not in ZIP');
    assert.equal((await fs.readFile(path.join(directory, 'data', 'SHA256SUMS'), 'utf8'))
      .includes('conversation.pdf'), true);
    const before = await fs.readFile(outcome.markdown, 'utf8');
    const rebuilt = await rebuildOne(directory, path.join(root, 'reconstructed'),
      (input, zip) => publishArchive(input, zip, {
        async renderPdf(htmlPath, pdfPath)
        {
          assert.match(await fs.readFile(htmlPath, 'utf8'),
            /<details class="activity">/);
          await fs.writeFile(pdfPath,
            '%PDF-1.7\n' + 'x'.repeat(256) + '\n%%EOF\n');
        }
      }));
    assert.equal(await fs.readFile(rebuilt.markdown, 'utf8'), before);
    assert.equal(await fs.readFile(outcome.markdown, 'utf8'), before);
    assert.notEqual(rebuilt.directory, outcome.directory);

  }
  finally
  {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('public commentary stays positioned and hidden thinking text is not exposed', () =>
{
  const visible = [
    { ordinal: 1, role: 'user', text: 'Question', message: {
      content: { parts: ['Question'] } } },
    { ordinal: 5, role: 'assistant', text: 'Answer', message: {
      content: { parts: ['Answer'] } } }
  ];
  const audit = { nodes: [
    { ordinal: 1, classification: 'visible_candidate' },
    { ordinal: 2, classification: 'internal_reasoning' },
    { ordinal: 3, classification: 'assistant_commentary' },
    { ordinal: 4, classification: 'tool_traffic' },
    { ordinal: 5, classification: 'visible_candidate' }
  ] };
  const turns = [{ activities: [
    { ordinal: 3, kind: 'assistant_commentary',
      text: 'Public progress summary' }
  ] }];
  const result = buildChronologicalPublication(visible, audit, turns, [], []);
  assert.deepEqual(result.events.map(item => item.ordinal), [1, 2, 3, 4, 5]);
  assert.equal(result.events[1].kind, 'thinking');
  assert.equal(result.events[2].publicCommentary, true);
  assert.match(result.events[2].markdown, /Public progress summary/);
  assert.doesNotMatch(JSON.stringify(result.events), /private chain-of-thought/i);
});

test('unknown media location is not invented as the last conversation turn', () =>
{
  const visible = [{ ordinal: 1, role: 'user', text: 'Hello',
    message: { content: { parts: ['Hello'] } } }];
  const audit = { nodes: [{ ordinal: 1, classification: 'visible_candidate' }] };
  const result = buildChronologicalPublication(visible, audit, [],
    [{ file_id: 'unlocated', status: 'downloaded',
      local_path: 'media/unknown.png', references: [] }], []);
  assert.equal(result.unplaced.length, 1);
  assert.equal(result.events.filter(item => item.kind === 'attachment').length, 0);
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
