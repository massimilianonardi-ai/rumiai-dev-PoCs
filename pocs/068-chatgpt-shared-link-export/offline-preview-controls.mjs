'use strict';
// Native HTML/CSS show-more controls, scoped to individual archived user turns.
import {parseHTML} from 'linkedom';

const normalize=text=>String(text||'').normalize('NFKC')
  .replace(/\s+/g,' ').trim().toLowerCase();

export const previewToggleCss=[
'[data-poc068-preview]>.poc068-toggle{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important}',
'[data-poc068-preview]>.poc068-label{display:inline-flex;align-items:center;gap:.4em;cursor:pointer}',
'[data-poc068-preview]>.poc068-label .poc068-less{display:none!important}',
'[data-poc068-preview]:has(>.poc068-toggle:checked)>.poc068-label .poc068-more{display:none!important}',
'[data-poc068-preview]:has(>.poc068-toggle:checked)>.poc068-label .poc068-less{display:inline!important}',
'[data-poc068-preview]>.poc068-toggle:focus-visible~.poc068-label{outline:2px solid currentColor;outline-offset:3px}',
'[data-poc068-preview]:has(>.poc068-toggle:not(:checked))>:is(div,section,article){max-height:14rem!important;overflow:hidden!important;mask-image:linear-gradient(to bottom,black 75%,transparent)!important}',
'[data-poc068-preview]:has(>.poc068-toggle:checked)>:is(div,section,article){max-height:none!important;overflow:visible!important;mask-image:none!important}',
'#cumulative-turns .overflow-hidden:has([data-poc068-preview]>.poc068-toggle:checked){max-height:none!important;height:auto!important;overflow:visible!important;mask-image:none!important}',
'[data-poc068-preview]:has(>.poc068-toggle:checked) :is([class*="line-clamp"],[class*="overflow-hidden"],[style*="line-clamp"]){max-height:none!important;overflow:visible!important;-webkit-line-clamp:unset!important;mask-image:none!important}'
].join('\n');

export function restoreUserPreviewControls(snapshotHtml,ordinal)
{
  if (!snapshotHtml.includes('data-can-expand'))
    return {html:snapshotHtml,converted:0,initiallyExpanded:0};
  const {document}=parseHTML(snapshotHtml);
  const root=document.querySelector('[data-turn-id-container]');
  if(!root)throw Error('Expected isolated captured turn');
  let converted=0,initiallyExpanded=0;
  for(const preview of root.querySelectorAll('[data-can-expand]'))
  {
    const button=[...preview.querySelectorAll(
      'button[data-conversation-preview-interactive]')]
      .find(node=>node.closest('[data-can-expand]')===preview);
    if(!button)continue;
    const spans=[...button.querySelectorAll('span')]
      .filter(span=>span.children.length===0).map(span=>normalize(span.textContent));
    if(!spans.some(label=>/^(mostra di più|mostra di piu|show more)$/.test(label)))
      continue;
    const english=spans.includes('show more');
    const expanded=preview.hasAttribute('data-expanded') ||
      button.getAttribute('aria-expanded')==='true';
    const id='poc068-preview-'+ordinal+'-'+converted;
    const toggle=document.createElement('input');
    toggle.setAttribute('type','checkbox');
    toggle.setAttribute('class','poc068-toggle');
    toggle.setAttribute('id',id);
    toggle.setAttribute('aria-label',english?'Show full message':'Mostra il messaggio completo');
    if(expanded){toggle.setAttribute('checked','');initiallyExpanded++;}
    preview.insertBefore(toggle,preview.firstChild);
    const label=document.createElement('label');
    label.setAttribute('for',id);
    label.setAttribute('class',(
      (button.getAttribute('class')||'')+' poc068-label').trim());
    if(button.hasAttribute('style'))
      label.setAttribute('style',button.getAttribute('style'));
    const icon=button.querySelector('svg');
    if(icon)label.appendChild(icon.cloneNode(true));
    for(const [cls,text] of [
      ['poc068-more',english?'Show more':'Mostra di più'],
      ['poc068-less',english?'Show less':'Mostra meno']
    ]){
      const span=document.createElement('span');
      span.setAttribute('class',cls);
      span.textContent=text;
      label.appendChild(span);
    }
    button.replaceWith(label);
    preview.setAttribute('data-poc068-preview','');
    converted++;
  }
  return {html:converted?root.outerHTML:snapshotHtml,converted,initiallyExpanded};
}
