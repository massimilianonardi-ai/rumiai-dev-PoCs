'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';
import {restoreUserPreviewControls,previewToggleCss}
  from '../offline-preview-controls.mjs';
import {renderSameSessionStyled} from '../render-same-session-styled.mjs';

const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const userTurn=expanded=>'<div data-turn-id-container="user-turn">' +
  '<div data-testid="conversation-turn-0" data-message-id="user-message">' +
  '<div data-can-expand="true" '+(expanded?'data-expanded="true"':'data-collapsed="true"')+'>' +
  '<div class="overflow-hidden"><p>Full message text stays present in DOM.</p></div>' +
  '<button data-conversation-preview-interactive aria-expanded="'+expanded+'">' +
  '<svg width="16"><path d="M0 0h1"/></svg><span>Mostra di più</span><span>Mostra meno</span>' +
  '</button></div></div></div>';

test('native checkbox and label replace React button on an isolated user turn',()=>
{
  const out=restoreUserPreviewControls(userTurn(false),0);
  assert.equal(out.converted,1);
  assert.equal(out.initiallyExpanded,0);
  assert.equal(out.sourceExpanded,0);
  const {document}=parseHTML(out.html);
  assert.equal(document.querySelectorAll('button').length,0);
  assert.equal(document.querySelectorAll('input[type="checkbox"]').length,1);
  assert.equal(document.querySelectorAll('label[for="poc068-preview-0-0"]').length,1);
  assert.equal(document.querySelectorAll('label svg').length,1);
  assert.match(out.html,/Full message text stays present in DOM/);
  assert.match(previewToggleCss,/:has\(>\.poc068-toggle:checked\)/);
  assert.match(previewToggleCss,/\.poc068-less/);
  const openSource=restoreUserPreviewControls(userTurn(true),0);
  assert.equal(openSource.sourceExpanded,1);
  assert.equal(openSource.initiallyExpanded,0);
  const openDocument=parseHTML(openSource.html).document;
  const checkbox=openDocument.querySelector('input.poc068-toggle');
  assert.equal(checkbox.hasAttribute('checked'),false,
    'archived preview must start closed even if the source snapshot is expanded');
  const preview=openDocument.querySelector('[data-poc068-preview]');
  assert.equal(preview.hasAttribute('data-expanded'),false);
  assert.equal(preview.getAttribute('data-collapsed'),'true');
});

test('styled archive prefers verified expanded user snapshot without touching assistant diagram',()=>
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-preview-'));
  try
  {
    const capture=path.join(root,'capture');
    fs.mkdirSync(path.join(capture,'turns'),{recursive:true});
    fs.mkdirSync(path.join(capture,'static'));
    const expanded=userTurn(true);
    const collapsed=userTurn(false);
    const diagram='<div data-turn-id-container="assistant-turn">' +
      '<div data-testid="conversation-turn-1" data-message-id="assistant-message">' +
      '<svg id="accepted-diagram"><path d="M2 2"/></svg>' +
      '<div style="--writing-block-editor-pl:0px">Scrittura - example text</div>' +
      '</div></div>';
    const records=[];
    for(const [html,turnId,messageId,sequence] of [
      [expanded,'user-turn','user-message',1],
      [collapsed,'user-turn','user-message',2],
      [diagram,'assistant-turn','assistant-message',3]
    ]){
      const bytes=Buffer.from(html),digest=hash(bytes);
      fs.writeFileSync(path.join(capture,'turns',digest+'.html'),bytes);
      records.push({kind:'turn.snapshot',sequence,turnId,messageIds:[messageId],
        file:'turns/'+digest+'.html',sha256:digest,bytes:bytes.length});
    }
    const css=Buffer.from('table{border-top:1px solid currentColor}');
    const cssHash=hash(css);
    fs.writeFileSync(path.join(capture,'static',cssHash+'.css'),css);
    records.push({kind:'network.static-body',sequence:4,status:'saved',
      mimeType:'text/css',originalUrl:'https://cdn.oaistatic.com/preview-test.css',
      file:'static/'+cssHash+'.css',sha256:cssHash,bytes:css.length});
    fs.writeFileSync(path.join(capture,'events.jsonl'),
      records.map(r=>JSON.stringify(r)).join('\n')+'\n');
    const output=path.join(root,'output');
    const result=renderSameSessionStyled(capture,output);
    assert.equal(result.capturedTurnCount,2);
    assert.equal(result.restoredPreviews,1);
    assert.equal(result.initiallyExpandedPreviews,0);
    assert.equal(result.sourceExpandedPreviews,1);
    const html=fs.readFileSync(path.join(output,'index.html'),'utf8');
    assert.ok(html.includes(diagram),'accepted assistant graphic stays byte-identical');
    const archived=parseHTML(html).document;
    assert.equal(archived.querySelector('input.poc068-toggle').hasAttribute('checked'),
      false,'preview is initially closed but content must remain present');
    assert.equal(archived.querySelector('[data-poc068-preview]').hasAttribute('data-expanded'),
      false);
    assert.match(html,/poc068-preview-controls/);
    assert.ok(!html.includes('padding-inline-start:1rem!important'),
      'original CSS wins; do not recreate editor spacing with arbitrary overrides');
    assert.ok(html.includes('--writing-block-editor-pl:0px'));
    assert.match(html,/script-src 'none'/);
    assert.ok(!html.includes('td,th{border:1px solid #bbb;padding:6px}'));
  }
  finally {fs.rmSync(root,{recursive:true,force:true});}
});
