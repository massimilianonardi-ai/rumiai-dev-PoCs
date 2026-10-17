import { markdownMessage } from './snapshot-export.mjs';

const THINKING = new Set(['internal_reasoning', 'assistant_analysis', 'thinking_preamble']);
const TECHNICAL = new Set(['assistant_tool_invocation', 'tool_traffic']);
const REDACTED = 'The output of this plugin was redacted.';

function note(value)
{
  return String(value).replace(/[\r\n]/g, ' ').trim();
}

function linkLabel(item)
{
  return note(item.file_name || item.original_file_name ||
    item.file_id || item.sandbox_uri || item.asset_pointer || 'Allegato')
    .replace(/[[\]\\]/g, '\\$&');
}

function localFile(item)
{
  return item.status === 'downloaded' && typeof item.local_path === 'string'
    ? item.local_path : null;
}

function linkText(item, image)
{
  const local = localFile(item);
  if (local)
    return image ? '![immagine](' + local + ')' :
      '[Allegato: ' + linkLabel(item) + '](<' + local + '>)';
  return image ? '[Immagine non disponibile dal link pubblico: ' +
      linkLabel(item) + ']' : '[Allegato non disponibile dal link pubblico: ' +
      linkLabel(item) + ']';
}

function containsInlineImage(message, item)
{
  const parts = message.message?.content?.parts;
  const pointers = item.asset_pointers || [item.asset_pointer];
  return Array.isArray(parts) && parts.some(part =>
    part?.content_type === 'image_asset_pointer' &&
    pointers.includes(part.asset_pointer));
}

function containsInlineFile(message, item)
{
  const text = message.text || '';
  return typeof item.sandbox_uri === 'string' &&
    text.includes(item.sandbox_uri);
}

function referenceOrdinals(item, visible, file)
{
  const result = new Set();
  for (const ref of item.references || [])
    if (Number.isInteger(ref.ordinal)) result.add(ref.ordinal);
  if (file && Number.isInteger(item.ordinal)) result.add(item.ordinal);
  if (file && !result.size && item.message_id)
  {
    for (const message of visible)
      if (message.message_id === item.message_id)
        result.add(message.ordinal);
  }
  if (file && !result.size && typeof item.sandbox_uri === 'string')
    for (const message of visible)
      if (containsInlineFile(message, item)) result.add(message.ordinal);
  return [...result].sort((a, b) => a - b);
}

/**
 * Readable nodes follow the source active-branch order. Hidden chain-of-thought
 * text and raw private tool payloads are never promoted to visible content.
 */
export function buildChronologicalPublication(visible, audit, turns, media, files)
{
  const messages = new Map(visible.map(item => [item.ordinal, item]));
  const sourceNodes = [...audit.nodes].sort((a, b) => a.ordinal - b.ordinal);
  const nodes = new Set(sourceNodes.map(item => item.ordinal));
  const mediaPointers = new Map();
  const fileUris = new Map();
  for (const item of media)
    for (const ptr of item.asset_pointers || [item.asset_pointer])
      if (ptr && localFile(item)) mediaPointers.set(ptr, item.local_path);
  for (const item of files)
    if (item.sandbox_uri && localFile(item))
      fileUris.set(item.sandbox_uri, item.local_path);

  const attachments = new Map();
  const unplaced = [];
  for (const [image, items] of [[true, media], [false, files]])
  {
    for (const item of items)
    {
      const ordinals = referenceOrdinals(item, visible, !image);
      const anchored = ordinals.filter(ordinal => nodes.has(ordinal));
      if (!anchored.length)
      {
        unplaced.push({ type: image ? 'image' : 'file',
          identity: note(item.file_id || item.file_name || item.asset_pointer ||
            item.sandbox_uri || 'unknown') });
        continue;
      }
      for (const ordinal of anchored)
      {
        const message = messages.get(ordinal);
        if (message && (image ? containsInlineImage(message, item) :
          containsInlineFile(message, item)))
          continue;
        if (!attachments.has(ordinal)) attachments.set(ordinal, []);
        attachments.get(ordinal).push({ kind: 'attachment', ordinal,
          image, markdown: linkText(item, image) });
      }
    }
  }

  const publicActivity = new Map();
  for (const turn of turns)
    for (const entry of turn.activities || [])
      if (entry.kind === 'assistant_commentary' &&
        typeof entry.text === 'string' && entry.text.trim() &&
        entry.text.trim() !== REDACTED)
        publicActivity.set(entry.ordinal, entry.text);

  const events = [];
  let group = null;
  function flush()
  {
    if (!group) return;
    events.push({ kind: group.kind, ordinal: group.ordinal,
      endOrdinal: group.endOrdinal, count: group.count,
      markdown: group.kind === 'thinking'
        ? 'La condivisione non espone il contenuto interno del thinking.'
        : 'Passaggio tecnico registrato; dettagli nell’archivio strutturato.' });
    group = null;
  }
  function groupTechnical(kind, ordinal)
  {
    if (group && group.kind === kind && group.endOrdinal + 1 === ordinal)
    {
      group.count++;
      group.endOrdinal = ordinal;
    }
    else
    {
      flush();
      group = { kind, ordinal, endOrdinal: ordinal, count: 1 };
    }
  }

  for (const node of sourceNodes)
  {
    const ordinal = node.ordinal;
    const visibleMessage = messages.get(ordinal);
    const attached = attachments.get(ordinal) || [];
    const commentary = publicActivity.get(ordinal);
    if (visibleMessage)
    {
      flush();
      const label = visibleMessage.role === 'user' ? 'UTENTE' :
        visibleMessage.channel === 'commentary' ?
          'ASSISTENTE — commentary' : 'ASSISTENTE';
      events.push({ kind: 'message', ordinal, label,
        markdown: markdownMessage(visibleMessage, mediaPointers, fileUris) });
    }
    else if (commentary)
    {
      flush();
      events.push({ kind: 'thinking', ordinal, endOrdinal: ordinal,
        count: 1, markdown: commentary, publicCommentary: true });
    }
    else if (THINKING.has(node.classification))
      groupTechnical('thinking', ordinal);
    else if (TECHNICAL.has(node.classification))
      groupTechnical('technical', ordinal);
    else if (!attached.length) flush();

    if (attached.length)
    {
      flush();
      events.push(...attached);
    }
  }
  flush();
  return { events, unplaced };
}

export function timelineMarkdown(events, title, source, messageCount, unplaced)
{
  const result = [
    '# ' + title,
    '',
    '> Archivio della sequenza attiva della conversazione condivisa.',
    '> Sorgente: ' + source,
    '> Messaggi testuali visibili: ' + messageCount + '.',
    '> Immagini, file e attività intermedie sono posizionati secondo i nodi originali.',
    '',
    '---',
    ''
  ];
  for (const event of events)
  {
    if (event.kind === 'message')
      result.push('## ' + event.label, '', event.markdown || '', '');
    else if (event.kind === 'attachment')
      result.push(event.markdown, '');
    else if (event.kind === 'thinking')
      result.push('> **Thinking / attività intermedia' +
        (event.publicCommentary ? ' visibile' : ' (contenuto non disponibile)') +
        '** — nodi ' + event.ordinal + '–' + event.endOrdinal, '',
        event.publicCommentary ? event.markdown : '', '');
    else
      result.push('> *Passaggio tecnico nella cronologia (nodi ' +
        event.ordinal + '–' + event.endOrdinal + '); dettagli in data/AUDIT.json.*',
        '');
  }
  if (unplaced.length)
  {
    result.push('## Contenuti senza collocazione verificata', '',
      '**Attenzione:** alcuni elementi non hanno un riferimento cronologico ' +
      'affidabile; non sono stati spostati arbitrariamente alla fine del dialogo.',
      '', 'Consultare data/MEDIA.json e data/FILES.json.', '');
  }
  return result.join('\n') + '\n';
}
