'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {renderSameSessionStyled} from '../render-same-session-styled.mjs';
import {restoreSourceDisclosures,sourceDisclosureCss}
  from '../offline-source-controls.mjs';
import {sourceGroupSignatures} from '../inspect-source-group-identity.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const originalDiagram='<svg id="accepted-diagram"><path d="M2 2"/></svg>';
const html='<div data-turn-id-container="assistant-turn">'+
  '<div data-testid="conversation-turn-2" data-message-id="assistant-message">'+
  '<p>Consider this independent research evidence and the exact original '+
  'source attribution in the following sentence before the citation badge. '+
  '<button class="source-trigger" aria-haspopup="dialog" aria-expanded="false">'+
  '<span class="source-label">OpenAI</span> <span>+1</span></button> '+
  'Then discuss a second independent research topic with many details.</p>'+
  originalDiagram+'<table><tr><td>Cost</td></tr></table>'+
  '</div></div>';
function store(root,name,actions=false,incomplete=false)
{
  const directory=path.join(root,name);
  fs.mkdirSync(path.join(directory,'turns'),{recursive:true});
  const bytes=Buffer.from(html),digest=sha(bytes);
  fs.writeFileSync(path.join(directory,'turns',digest+'.html'),bytes);
  const rows=[{kind:'turn.snapshot',sequence:1,turnId:'assistant-turn',
    messageIds:['assistant-message'],sha256:digest,bytes:bytes.length,
    file:'turns/'+digest+'.html'},
    // The styled source capture predates the source-card count observer.
    // It is valid identity evidence, but not source-count/URL evidence.
    {kind:'interaction.source-hover',sequence:2,
      ordinal:2,index:0,...(name==='styled'?{}:{expectedSources:2})}];
  if(actions)rows.push({kind:'interaction.trusted-source-card-intents',
    ordinal:2,groupIndex:0,expectedSources:2,
    attempts:(incomplete?[0]:[0,1]).map(index=>({
      index,status:'dispatched',
      windowOpen:['https://example.org/source-'+index+'?safe=1'],
      anchorClick:[]
    }))});
  if(name==='styled')
  {
    const css=Buffer.from('.source-trigger{font-weight:600}');
    const cssDigest=sha(css);
    fs.mkdirSync(path.join(directory,'static'));
    fs.writeFileSync(path.join(directory,'static',cssDigest+'.css'),css);
    rows.push({kind:'network.static-body',sequence:3,status:'saved',
      mimeType:'text/css',originalUrl:'https://cdn.oaistatic.com/source.css',
      file:'static/'+cssDigest+'.css',sha256:cssDigest,bytes:css.length});
  }
  fs.writeFileSync(path.join(directory,'events.jsonl'),
    rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  return directory;
}
function fixture(callback)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-source-replay-'));
  try{
    const styled=store(root,'styled');
    const first=store(root,'first');
    const second=store(root,'second',true);
    return callback({root,styled,first,second});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('native disclosure preserves original source label and untouched assistant markup',()=>
{
  const group={index:0,expectedSources:2,complete:true,
    targets:['https://example.com/source-one','https://example.net/source-two']};
  const reference=sourceGroupSignatures(html);
  const result=restoreSourceDisclosures(html,2,[group],reference);
  assert.equal(result.converted,1);
  assert.equal(result.links,2);
  assert.ok(result.html.includes(originalDiagram));
  assert.ok(result.html.includes('<table><tr><td>Cost</td></tr></table>'));
  assert.match(result.html,/class="source-trigger"/);
  const document=parseHTML(result.html).document;
  assert.equal(document.querySelectorAll('details.poc068-source-details').length,1);
  assert.equal(document.querySelectorAll('details summary').length,1);
  assert.equal(document.querySelectorAll('details a[href]').length,2);
  assert.ok(!document.querySelector('details').hasAttribute('open'));
  assert.ok(!result.html.includes('<script'));
  assert.ok(!sourceDisclosureCss.includes('writing-block-editor'));
});
test('styled source mode is opt-in, preserves accepted diagram and keeps CSP inert',()=>
 fixture(({root,styled,first,second})=>{
   const normal=path.join(root,'normal');
   const normalResult=renderSameSessionStyled(styled,normal);
   assert.equal(normalResult.restoredSources,0);
   const normalHtml=fs.readFileSync(path.join(normal,'index.html'),'utf8');
   assert.ok(normalHtml.includes('aria-haspopup="dialog"'));
   assert.ok(!normalHtml.includes('poc068-source-controls'));

   const out=path.join(root,'with-links');
   // Legacy source-hover without expectedSources in the styled capture must
   // not be interpreted as navigation evidence. Its hashed DOM content still
   // participates in the cross-capture identity check.
   const result=renderSameSessionStyled(styled,out,[first,second]);
   assert.equal(result.restoredSources,1);
   assert.equal(result.sourceLinks,2);
   assert.equal(result.sourceIdentityStableGroups,1);
   const text=fs.readFileSync(path.join(out,'index.html'),'utf8');
   const document=parseHTML(text).document;
   const anchors=[...document.querySelectorAll('.poc068-source-links>a')];
   assert.equal(anchors.length,2);
   assert.equal(anchors[0].getAttribute('href'),
     'https://example.org/source-0?safe=1');
   assert.equal(anchors[1].getAttribute('rel'),'noopener noreferrer');
   assert.equal(document.querySelectorAll('details.poc068-source-details').length,1);
   assert.ok(text.includes(originalDiagram),'accepted diagram remains identical');
   assert.ok(text.includes('<table><tr><td>Cost</td></tr></table>'));
   assert.ok(text.includes("script-src 'none'"));
   assert.ok(text.includes('poc068-source-controls'));
   assert.equal(fs.statSync(path.join(out,'index.html')).mode&0o004,0);
 })
);
test('missing or ambiguous per-card target refuses output with no partial archive',()=>
 fixture(({root,styled,first})=>{
   const incomplete=store(root,'incomplete',true,true);
   const out=path.join(root,'refused');
   assert.throws(()=>renderSameSessionStyled(styled,out,[first,incomplete]),
     /identity\/provenance incomplete/);
   assert.equal(fs.existsSync(out),false);
 })
);
test('identity and source group cardinality mismatch fails closed',()=>
{
  const group={index:0,expectedSources:2,complete:true,
    targets:['https://example.org/a','https://example.org/b']};
  const reference=sourceGroupSignatures(html);
  assert.throws(()=>restoreSourceDisclosures(html.replace('citation badge',
    'modified text evidence'),2,[group],reference),
    /differs from trusted group context/);
  assert.equal(restoreSourceDisclosures(html,2,[],reference).html,html);
});
