'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectOfflineLinkControls} from '../inspect-offline-link-controls.mjs';

function fixture(html,fn)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-link-controls-'));
  try{
    fs.writeFileSync(path.join(root,'index.html'),html,{mode:0o600});
    return fn(root);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('records multi-source native details and unhandled single citations separately',()=>
{
  const html='<!doctype html><html><head>'+
    '<meta http-equiv="Content-Security-Policy" content="'+
    "default-src 'none'; script-src 'none'; img-src 'self' data:;"+
    '"><style>.ico{background:url(https://host.example/private-icon.png)}</style>'+
    '</head><body><div data-turn-id-container="assistant-turn">'+
    '<div data-testid="conversation-turn-4">'+
    '<details class="poc068-source-details" data-poc068-ordinal="4" '+
    'data-poc068-index="1"><summary><span>OpenAI</span><span>+1</span>'+
    '</summary><div class="poc068-source-links">'+
    '<a href="https://private.example/item-1">Original link A</a>'+
    '<a href="https://private.example/item-2">Original link B</a>'+
    '</div></details>'+
    '<button aria-haspopup="dialog" aria-expanded="false">Fonti</button>'+
    '<button aria-haspopup="dialog">Single citation</button>'+ 
    '<a role="link">A citation without a destination</a>'+
    '<img src="https://cdn.example/assets/private-favicon.png">'+
    '<img src="./icons/missing-icon.svg">'+
    '</div></div></body></html>';
  fixture(html,root=>{
    const report=inspectOfflineLinkControls(root);
    assert.equal(report.sourceDetails,1);
    assert.equal(report.sourceLinks,2);
    assert.equal(report.linksMissingIcons,2);
    assert.equal(report.standaloneSourcesCount,1);
    assert.equal(report.singleCitationCandidatesCount,1);
    assert.equal(report.anchorsWithoutHref,1);
    assert.equal(report.hasScriptBlocking,true);
    assert.equal(report.imageSelfAllowed,true);
    assert.equal(report.imageReferences.remote,1);
    assert.equal(report.imageReferences['local-missing'],1);
    assert.equal(report.cssUrlReferences.remote,1);
    assert.equal(report.sourceDetailsInventory[0].ordinal,4);
    assert.equal(report.sourceDetailsInventory[0].summaryPresent,true);
    const serialized=JSON.stringify(report);
    assert.ok(!serialized.includes('private.example'));
    assert.ok(!serialized.includes('item-1'));
    assert.ok(!serialized.includes('private-favicon'));
    assert.ok(!serialized.includes('Original link'));
  });
});
test('missing resources can be distinguished from captured local icon files',()=>
{
  fixture('<html><body><img src="./assets/favicon.png">'+
    '<img src="data:image/png;base64,eA=="></body></html>',root=>{
    fs.mkdirSync(path.join(root,'assets'));
    fs.writeFileSync(path.join(root,'assets','favicon.png'),'placeholder');
    const result=inspectOfflineLinkControls(root);
    assert.equal(result.imageReferences.local,1);
    assert.equal(result.imageReferences.data,1);
    assert.equal(result.sourceLinks,0);
    assert.equal(result.standaloneSourcesCount,0);
  });
});
