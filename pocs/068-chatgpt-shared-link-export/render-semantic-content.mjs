'use strict';
// Semantic, inert projection of captured DOM: never copy raw HTML attributes,
// source styling, executable elements, or network-backed images.
import {escapeHtml} from './render-readable-image-preview.mjs';

const blocked=new Set(['script','style','noscript','template','iframe','object',
  'embed','canvas','input','textarea','select','option','form','video','audio',
  'source','nav','svg']);
const visible=new Set(['strong','b','em','i','u','s','del','mark','p','blockquote',
  'ul','ol','li','h1','h2','h3','h4','h5','h6','pre','code','table','thead',
  'tbody','tfoot','tr','th','td','br','hr','sup','sub','small','details','summary',
  'kbd','samp','cite','q','dl','dt','dd']);
const mathTags=new Set(['math','semantics','mrow','mi','mn','mo','mtext','ms',
  'mfrac','msqrt','mroot','msub','msup','msubsup','munder','mover','munderover',
  'mtable','mtr','mtd','mspace','menclose','mpadded','mphantom','mfenced',
  'mmultiscripts','mprescripts','none','maction','mstyle']);
const mathAttrs=new Set(['display','mathvariant','displaystyle','scriptlevel',
  'stretchy','symmetric','lspace','rspace','minsize','maxsize','linethickness',
  'rowalign','columnalign','rowspan','columnspan','accent','accentunder',
  'open','close','separators','notation','width','height','depth']);
function tagOf(node)
{
  return node?.localName?.toLowerCase() || '';
}
function attrs(node,names)
{
  let result='';
  for (const key of names)
  {
    const value=node.getAttribute(key);
    if (value && value.length<160 && !/[<>"']/.test(value))
      result+=' '+key+'="'+escapeHtml(value)+'"';
  }
  return result;
}
function safeHref(value)
{
  try
  {
    if (typeof value!=='string' || value.length>4096) return null;
    const url=new URL(value);
    if (!['https:','http:'].includes(url.protocol) ||
        url.username || url.password) return null;
    return url.href;
  }
  catch {return null;}
}
function sourceLabel(href,node)
{
  const title=(node.getAttribute('aria-label') ||
    node.getAttribute('title') || '').trim();
  if (title) return title.slice(0,100);
  try {return new URL(href).hostname;}
  catch {return 'Fonte';}
}
function isIcon(img)
{
  const cls=(img.getAttribute('class')||'').toLowerCase();
  const hint=(img.getAttribute('alt')||'').toLowerCase();
  const w=Number(img.getAttribute('width'));
  const h=Number(img.getAttribute('height'));
  const src=(img.getAttribute('src')||'').toLowerCase();
  if (/\bfavicon\b|\bicon\b|\bavatar\b/.test(cls) ||
      /(?:^|\s)(?:size|h|w)-(?:2|3|4|5|6|7|8|9|10|12)(?=\s|$)/.test(cls) ||
      /favicon|logo del sito|site icon/.test(hint) ||
      /(?:favicon|\/s2\/favicons|\.ico(?:$|\?))/.test(src)) return true;
  if (w>0 && w<=48 && (!h || h<=48)) return true;
  if (h>0 && h<=48 && (!w || w<=48)) return true;
  const style=(img.getAttribute('style')||'').toLowerCase();
  return /(?:width|height)\s*:\s*(?:1[0-9]|2[0-9]|3[0-9])px/.test(style);
}
function mathElement(node)
{
  const name=tagOf(node);
  if (node.nodeType===3) return escapeHtml(node.nodeValue||'');
  if (node.nodeType!==1 || !mathTags.has(name)) return '';
  if (name==='semantics')
  {
    // Annotation contains source LaTeX as metadata; do not display it
    // alongside the MathML formula.
    return '<semantics>'+[...node.childNodes]
      .filter(x=>tagOf(x)!=='annotation' && tagOf(x)!=='annotation-xml')
      .map(mathElement).join('')+'</semantics>';
  }
  const children=[...node.childNodes].map(mathElement).join('');
  return '<'+name+attrs(node,[...mathAttrs])+'>'+children+'</'+name+'>';
}
function mathFrom(node,stats)
{
  const math=tagOf(node)==='math' ? node :
    node.querySelector?.('math');
  if (math)
  {
    stats.mathPreserved++;
    return mathElement(math);
  }
  const tex=node.getAttribute?.('data-latex') ||
    node.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent;
  if (tex)
  {
    stats.mathFallback++;
    return '<code class="math-source">'+escapeHtml(tex)+'</code>';
  }
  stats.mathUnavailable++;
  return '<span class="math-missing">[Formula non ricostruibile dallo snapshot]</span>';
}
function messageTarget(message)
{
  // A message can contain both plain-text and rich blocks as siblings.
  // Selecting the first nested .markdown would silently lose other content.
  return message.querySelector('[data-testid="message-content"]') || message;
}
export function renderSemanticMessage(message,imageFor,stats)
{
  const target=messageTarget(message);
  return renderSemanticTree(target,imageFor,stats);
}
export function renderSemanticTree(root,imageFor,stats)
{
  function childHtml(node)
  {
    return [...node.childNodes].map(render).join('');
  }
  function render(node)
  {
    if (node.nodeType===3) return escapeHtml(node.nodeValue||'');
    if (node.nodeType!==1) return '';
    const name=tagOf(node);
    if (node.getAttribute('aria-hidden')==='true' ||
        node.hasAttribute('hidden') || blocked.has(name)) return '';
    if (name==='button')
    {
      // UI controls are not conversation content; real source links can
      // occasionally appear inside a control and retain their href.
      return [...node.querySelectorAll('a[href]')].map(render).join('');
    }
    if (name==='annotation' || name==='annotation-xml' ||
        node.getAttribute('class')?.includes('katex-html')) return '';
    if (name==='math' || /\bkatex\b/.test(node.getAttribute('class')||'') ||
        name==='mjx-container')
      return mathFrom(node,stats);
    if (name==='img')
    {
      if (isIcon(node))
      {
        stats.suppressedDecorativeImages++;
        return '';
      }
      const selection=imageFor(node);
      if (selection?.status!=='verified-request-body')
      {
        stats.unmatchedContentImages++;
        return '<span class="image-not-captured">[Immagine non acquisita]</span>';
      }
      const body=selection.body;
      stats.contentImageOccurrences++;
      stats.usedBodies.add(body.hash);
      if (selection.usedSourceFallback) stats.srcFallbackAfterAbsentCurrentSrc++;
      const alt=node.getAttribute('alt')||'Immagine acquisita';
      return '<figure><img src="data:'+body.mime+';base64,'+
        body.bytes.toString('base64')+'" alt="'+escapeHtml(alt.slice(0,180))+
        '"><figcaption>Immagine locale verificata</figcaption></figure>';
    }
    if (name==='a')
    {
      const href=safeHref(node.getAttribute('href'));
      if (!href) return childHtml(node);
      const children=[...node.childNodes];
      const imageOnly=children.some(n=>tagOf(n)==='img') &&
        !node.textContent.trim();
      const iconsOnly=imageOnly &&
        children.filter(n=>tagOf(n)==='img').every(isIcon);
      if (iconsOnly)
      {
        stats.linkedSources++;
        stats.suppressedDecorativeImages+=children.filter(n=>tagOf(n)==='img').length;
        return '<a href="'+escapeHtml(href)+'" target="_blank" rel="noopener noreferrer">'+
          escapeHtml(sourceLabel(href,node))+'</a>';
      }
      stats.linkedSources++;
      return '<a href="'+escapeHtml(href)+'" target="_blank" rel="noopener noreferrer">'+
        childHtml(node)+'</a>';
    }
    if (name==='br' || name==='hr') return '<'+name+'>';
    if (visible.has(name))
    {
      let attributes='';
      if (name==='th' || name==='td') attributes=attrs(node,['colspan','rowspan']);
      if (name==='ol')
      {
        const start=Number(node.getAttribute('start'));
        if (Number.isSafeInteger(start) && start>0 && start<100000)
          attributes=' start="'+start+'"';
      }
      return '<'+name+attributes+'>'+childHtml(node)+'</'+name+'>';
    }
    if (name==='div' || name==='section' || name==='article')
    {
      const kind=/\bwhitespace-pre-wrap\b/.test(node.getAttribute('class')||'')?
        ' class="prewrap"':'';
      return '<div'+kind+'>'+childHtml(node)+'</div>';
    }
    // Span and framework wrappers carry content, never their source classes,
    // inline styles, event handlers or data attributes.
    return childHtml(node);
  }
  return render(root);
}
export function createSemanticStats()
{
  return {mathPreserved:0,mathFallback:0,mathUnavailable:0,
    linkedSources:0,suppressedDecorativeImages:0,
    contentImageOccurrences:0,unmatchedContentImages:0,
    srcFallbackAfterAbsentCurrentSrc:0,usedBodies:new Set()};
}
