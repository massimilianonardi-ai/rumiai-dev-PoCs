'use strict';
// Read-only and private-safe inspection of UI control structure in existing
// captured ChatGPT turns. Do not print text, URLs, IDs or CSS values.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const snapshotName = /^turns\/([a-f0-9]{64})\.html$/;

function normalizedText(value)
{
  return String(value || '').normalize('NFKC')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
function controlKind(value)
{
  const text = normalizedText(value);
  if (text === 'mostra di più' || text === 'mostra di piu' || text === 'show more')
    return 'expand-message';
  if (text === 'openai' || /^openai\s*\+\d+$/.test(text)) return 'source-label';
  if (/^\+\d+$/.test(text)) return 'source-count';
  return null;
}
function shape(element)
{
  const tag = element.localName;
  const classes = String(element.getAttribute('class') || '').split(/\s+/);
  const style = String(element.getAttribute('style') || '');
  const flags = ['line-clamp', 'overflow-hidden', 'max-h-', 'truncate',
    'grid', 'flex', 'group', 'popover', 'tooltip', 'cursor-pointer']
    .filter(token => classes.some(cls => cls.includes(token)));
  const props = style.split(';').map(item => item.split(':')[0].trim())
    .filter(name => /^[a-z-]{2,50}$/.test(name));
  const attrs = [...element.attributes].map(attr => attr.name)
    .filter(name => /^data-|^aria-|^role$|^title$|^href$/.test(name))
    .filter(name => name !== 'data-message-id' && name !== 'data-turn-id-container')
    .slice(0, 20);
  return {
    tag, flags, inlineProperties:[...new Set(props)].slice(0,20),
    attributeNames:attrs, children:element.children.length,
    anchors:element.querySelectorAll('a[href]').length,
    httpsAnchors:[...element.querySelectorAll('a[href]')].filter(node =>
      /^https:\/\//i.test(node.getAttribute('href') || '')).length,
    buttons:element.querySelectorAll('button').length,
    svg:element.querySelectorAll('svg').length,
    ariaExpanded:element.getAttribute('aria-expanded') === null ? null :
      element.getAttribute('aria-expanded') === 'true',
    hidden:element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true'
  };
}
function classify(root)
{
  const targets=[];
  for (const element of root.querySelectorAll('button,a,span,summary,[role="button"]'))
  {
    const kind=controlKind(element.textContent);
    if (!kind || [...element.children].some(child =>
      controlKind(child.textContent) === kind)) continue;
    const ancestors=[];
    let cursor=element;
    for (let depth=0;cursor && depth<5;depth++,cursor=cursor.parentElement)
      ancestors.push(shape(cursor));
    targets.push({kind,ancestors});
    if (targets.length>=20) break;
  }
  const text=normalizedText(root.textContent);
  return {
    controls:targets,
    messageTextCharacters:text.length,
    styledClampElements:[...root.querySelectorAll('[style]')].filter(element =>
      /(?:line-clamp|max-height|overflow)\s*:/i.test(element.getAttribute('style') || '')).length,
    sourceLinkCount:root.querySelectorAll('a[href]').length
  };
}
export function inspectStyledInteractions(capture)
{
  const events=fs.readFileSync(path.join(capture,'events.jsonl'),'utf8')
    .split(/\r?\n/).filter(Boolean).map((line,index) =>
    {
      try {return JSON.parse(line);}
      catch {throw Error('Invalid event at line '+(index+1));}
    });
  const selected=new Map();
  for (const event of events)
  {
    if(event.kind!=='turn.snapshot') continue;
    const match=snapshotName.exec(event.file || '');
    if(!match || match[1]!==event.sha256) throw Error('Unsafe snapshot file name');
    const bytes=fs.readFileSync(path.join(capture,event.file));
    if(bytes.length!==event.bytes || digest(bytes)!==event.sha256)
      throw Error('Snapshot integrity failed');
    const {document}=parseHTML(bytes.toString('utf8'));
    const root=document.querySelector('[data-turn-id-container]');
    if(!root) continue;
    const marker=root.querySelector('[data-testid^="conversation-turn-"]') ||
      (root.matches('[data-testid^="conversation-turn-"]')?root:null);
    const m=/^conversation-turn-(\d+)$/.exec(marker?.getAttribute('data-testid')||'');
    if(!m) continue;
    const ordinal=Number(m[1]);
    if(!Number.isSafeInteger(ordinal)) continue;
    const previous=selected.get(ordinal);
    if(!previous || event.sequence>previous.sequence)
      selected.set(ordinal,{sequence:event.sequence,root});
  }
  const turns=[];
  for(const [ordinal,{root}] of [...selected].sort(([a],[b])=>a-b))
  {
    const summary=classify(root);
    if(summary.controls.length) turns.push({ordinal,...summary});
  }
  return {status:'private-safe-interactions',examinedTurns:selected.size,
    turnsWithTargets:turns.length,turns,
    limitations:['Only latest captured message-qualified DOM is inspected',
      'URLs, private text, IDs and CSS values are not printed',
      'Missing links or expanded text may require a live interaction capture',
      'DOM state alone does not prove how the original React controls operate']};
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3)
  {
    console.error('Usage: node inspect-styled-interactions.mjs <private-capture-dir>');
    process.exitCode=2;
  }
  else
  {
    try {console.log(JSON.stringify(inspectStyledInteractions(path.resolve(process.argv[2])),null,2));}
    catch {console.error('Cannot inspect capture evidence');process.exitCode=1;}
  }
}
