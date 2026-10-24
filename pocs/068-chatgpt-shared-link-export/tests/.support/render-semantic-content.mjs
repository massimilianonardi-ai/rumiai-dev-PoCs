'use strict';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderSemanticTree,renderSemanticMessage,createSemanticStats}
  from '../../render-semantic-content.mjs';

const html='<section data-message-id="secret-id"><div data-testid="message-content">'+
  '<div class="markdown"><h3>Titolo</h3><p>Testo <strong>forte</strong> '+
  '<em>corsivo</em> <u>sottolineato</u> <del>cancellato</del> '+
  '<a href="https://source.example.test/article?id=42">fonte esterna</a>.</p>'+
  '<ul><li>Uno</li><li>Due</li></ul>'+
  '<table><thead><tr><th>Campo</th></tr></thead><tbody><tr><td>Valore</td></tr></tbody></table>'+
  '<pre><code>if (a < b) return c;</code></pre>'+
  '<span class="katex"><span class="katex-mathml">'+
  '<math display="block"><semantics><mrow><mfrac><mi>a</mi><mi>b</mi></mfrac></mrow>'+
  '<annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math>'+
  '</span><span class="katex-html" aria-hidden="true">duplicate visual</span></span>'+
  '<p><a href="https://journal.example.test/paper" aria-label="Journal"><img '+
  'width="16" height="16" src="https://journal.example.test/favicon.png"></a> '+
  'Citazione con <a href="https://source.example.test/second"><img width="16" height="16" '+
  'src="https://site.example.test/icon.png">Nome della fonte</a></p>'+
  '<img src="https://image.example.test/full.png" alt="Figura principale">'+
  '<img width="20" height="20" src="https://site.example.test/other.png">'+
  '<script>window.evil=1</script><button onclick="evil()">Copia</button>'+
  '<a href="javascript:alert(1)">non eseguibile</a>'+
  '<a href="data:text/html,<script>bad</script>">data unsafe</a>'+
  '<iframe src="https://other.test"></iframe>'+
  '</div></div></section>';
const {document}=parseHTML(html);
const message=document.querySelector('[data-message-id]');
const stats=createSemanticStats();
const imageFor=img => img.getAttribute('alt')==='Figura principale' ?
  {status:'verified-request-body',body:{hash:'fake-hash',mime:'image/png',
    bytes:Buffer.from('image-bytes')},usedSourceFallback:false} :
  {status:'not-captured'};
const output=renderSemanticMessage(message,imageFor,stats);
const dom=parseHTML('<!doctype html><html><body>'+output+'</body></html>').document;
assert.equal(dom.querySelectorAll('h3').length,1);
assert.equal(dom.querySelectorAll('strong').length,1);
assert.equal(dom.querySelectorAll('em').length,1);
assert.equal(dom.querySelectorAll('u').length,1);
assert.equal(dom.querySelectorAll('del').length,1);
assert.equal(dom.querySelectorAll('li').length,2);
assert.equal(dom.querySelectorAll('table td').length,1);
assert.equal(dom.querySelectorAll('pre code').length,1);
assert.equal(dom.querySelectorAll('math mfrac').length,1);
assert(!output.includes('duplicate visual'),'KaTeX visual duplicate leaked');
assert(!output.includes('\\\\frac{a}{b}'),'Rendered MathML must not duplicate annotation');
assert.equal(dom.querySelectorAll('a[href^="https:"]').length,3);
assert(output.includes('journal.example.test/paper'));
assert(output.includes('target="_blank"'));
assert(output.includes('rel="noopener noreferrer"'));
assert.equal(dom.querySelectorAll('figure img').length,1);
assert.equal(dom.querySelectorAll('img').length,1);
assert(output.includes('data:image/png;base64,'));
for(const bad of ['javascript:','data:text/html','window.evil','onclick=',
  '<script','<iframe','favicon.png','other.png','secret-id','<style'])
  assert(!output.includes(bad),'Unsafe or decorative captured markup leaked: '+bad);
assert.equal(stats.mathPreserved,1);
assert.equal(stats.linkedSources,3);
assert.equal(stats.contentImageOccurrences,1);
assert.equal(stats.unmatchedContentImages,0);
assert(stats.suppressedDecorativeImages>=3);
const fallbackDoc=parseHTML('<div><span class="katex" data-latex="x^2">x</span></div>')
  .document.querySelector('div');
const fallbackStats=createSemanticStats();
const fallback=renderSemanticTree(fallbackDoc,()=>null,fallbackStats);
assert(fallback.includes('x^2'));
assert.equal(fallbackStats.mathFallback,1);
const unsupportedDoc=parseHTML('<span class="katex">no mathml</span>').document
  .querySelector('span');
const unsupportedStats=createSemanticStats();
const unsupported=renderSemanticTree(unsupportedDoc,()=>null,unsupportedStats);
assert(unsupported.includes('Formula non ricostruibile'));
assert.equal(unsupportedStats.mathUnavailable,1);
console.log('PASS: semantic HTML, MathML, TeX fallback, source links without giant icons, inert markup');
