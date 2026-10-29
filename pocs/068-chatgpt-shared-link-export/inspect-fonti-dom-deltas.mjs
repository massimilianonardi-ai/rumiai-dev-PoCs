'use strict';
// Read-only structural comparison of four private React "Fonti" click
// snapshots. No transcript, URLs, HTML attributes or messages are emitted.
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';

function parseMarkup(markup)
{
  if(typeof markup!=='string'||!markup||markup.length>524288)
    return null;
  const {document}=parseHTML(
    '<div data-poc068-fonti-root="1">'+markup+'</div>');
  return document.querySelector('[data-poc068-fonti-root]');
}
const norm=value=>String(value||'').normalize('NFKC')
  .replace(/\s+/g,' ').trim();
function shape(markup)
{
  const root=parseMarkup(markup);
  if(!root)return null;
  const count=selector=>root.querySelectorAll(selector).length;
  const text=norm(root.textContent);
  const buttons=[...root.querySelectorAll('button')].filter(node=>
    /^(fonti|sources)$/i.test(norm(node.textContent))||
    /^(fonti|sources)$/i.test(norm(node.getAttribute('aria-label'))));
  return {
    text,
    textChars:text.length,
    elements:count('*'),
    links:count('a[href]'),
    buttons:count('button'),
    images:count('img'),
    listItems:count('li'),
    lists:count('ol,ul'),
    sections:count('section,[role="region"],[role="dialog"]'),
    disclosure:count('details,[aria-expanded="true"]'),
    fontiExpanded:buttons.filter(button=>
      button.getAttribute('aria-expanded')==='true').length,
    fontiButtons:buttons.length
  };
}
export function inspectFontiDeltas(captureDir)
{
  const events=fs.readFileSync(path.join(path.resolve(captureDir),'events.jsonl'),
    'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const rows=events.filter(row=>row.kind==='interaction.remaining-control-intent'&&
    row.controlKind==='fonti');
  const groups=new Map();
  for(const row of rows)
  {
    const ordinal=row.ordinal;
    if(![2,4,6,8].includes(ordinal)||row.index!==0)
      throw Error('Unexpected Fonti identity in private capture');
    if(!groups.has(ordinal))groups.set(ordinal,[]);
    groups.get(ordinal).push(row);
  }
  const report=[];
  for(const ordinal of [2,4,6,8])
  {
    const samples=groups.get(ordinal)||[];
    const dispatched=samples.filter(x=>x.status==='dispatched');
    if(dispatched.length>1)
      throw Error('Ambiguous repeated Fonti click');
    const event=dispatched[0]||samples.at(-1);
    const before=shape(event?.turnBeforeHtml);
    const after=shape(event?.turnAfterHtml);
    report.push({
      ordinal,attempts:samples.length,
      status:event?.status||'not-observed',
      capturesComplete:!!before&&!!after&&!event?.turnTruncated,
      reportedTurnChanged:!!event?.turnChanged,
      textChanged:!!before&&!!after&&before.text!==after.text,
      textCharDelta:before&&after?after.textChars-before.textChars:null,
      elementDelta:before&&after?after.elements-before.elements:null,
      linkDelta:before&&after?after.links-before.links:null,
      imageDelta:before&&after?after.images-before.images:null,
      listItemDelta:before&&after?after.listItems-before.listItems:null,
      listDelta:before&&after?after.lists-before.lists:null,
      buttonDelta:before&&after?after.buttons-before.buttons:null,
      sectionOrRegionDelta:before&&after?after.sections-before.sections:null,
      disclosureDelta:before&&after?after.disclosure-before.disclosure:null,
      fontiExpandedBefore:before?.fontiExpanded??null,
      fontiExpandedAfter:after?.fontiExpanded??null,
      fontiButtonsBefore:before?.fontiButtons??null,
      fontiButtonsAfter:after?.fontiButtons??null,
      popupObserved:!!event?.panelObserved
    });
  }
  return {status:'private-safe-fonti-dom-deltas',fonti:report,
    limits:[
      'A turn DOM mutation may be incidental; it is not proof of expanded Fonti content',
      'Panels created in an external React portal may not appear inside the assistant turn',
      'All text, URL strings, class names, IDs, DOM markup and private source paths are omitted',
      'No offline archive or private capture is modified'
    ]};
}
if(process.argv[1]&&path.resolve(process.argv[1])===
   path.resolve(new URL(import.meta.url).pathname))
{
  if(process.argv.length!==3){
    console.error('Usage: node inspect-fonti-dom-deltas.mjs <private-remaining-capture-dir>');
    process.exitCode=2;
  }else{
    try{console.log(JSON.stringify(inspectFontiDeltas(process.argv[2]),null,2));}
    catch(error){
      console.error('Fonti DOM comparison failed: '+error.message);
      process.exitCode=1;
    }
  }
}
