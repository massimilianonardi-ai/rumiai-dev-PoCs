'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {restoreSingletonCitationHtml,materializeSingletonCitations}
  from '../restore-singleton-citations.mjs';
import {inspectFontiDeltas} from '../inspect-fonti-dom-deltas.mjs';

const counts=new Map([[2,1],[4,2],[6,3],[8,2]]);
function fixture(testBody)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-singleton-'));
  const source=path.join(root,'source'),previous=path.join(root,'before'),
    current=path.join(root,'after'),output=path.join(root,'restored');
  for(const dir of [source,previous,current])fs.mkdirSync(dir);
  fs.mkdirSync(path.join(source,'assets'));
  fs.writeFileSync(path.join(source,'assets','accepted-icon.png'),'private-accepted-icon');
  const old=[],now=[],turns=[];
  for(const [ordinal,count] of counts)
  {
    const items=[];
    for(let index=0;index<count;index++)
    {
      const title='Citation '+ordinal+'-'+index;
      const original='<span aria-haspopup="dialog" title="'+title+'">'+
        '<img alt="Source '+ordinal+'-'+index+
        '" src="https://example.net/icon?g='+ordinal+'&amp;i='+index+'">'+
        '<span>Site '+ordinal+'-'+index+'</span></span>';
      const localized=original.replace(
        /src="https:\/\/example.net\/icon\?g=[^"]+"/,
        'src="./assets/accepted-icon.png"');
      items.push(localized);
      const shared={kind:'interaction.remaining-control-intent',
        ordinal,index,controlKind:'singleton',status:'dispatched',
        controlHtml:original,panelObserved:true,panelButtons:1,
        panelAnchors:0,opened:[],anchors:[],popupCardStatus:'dispatched',
        contextTruncated:false,turnTruncated:false,panelTruncated:false};
      old.push({...shared,popupCardStatus:'not-probed'});
      now.push({...shared,popupCardOpened:[
        'https://example.org/private-citation/'+ordinal+'/'+index]});
    }
    turns.push('<article data-turn-id-container="assistant-'+ordinal+'">'+
      '<div data-testid="conversation-turn-'+ordinal+'">'+items.join('')+
      '<button>Fonti</button></div></article>');
  }
  const detail='<details class="poc068-source-details"><summary>OpenAI +1</summary>'+
    '<div class="poc068-source-links"><a href="https://example.org/c">C</a></div></details>';
  const detailHtml=detail.repeat(8);
  const extraLinks='<div class="poc068-source-links">'+
    '<a href="https://example.org/more">Other</a>'.repeat(11)+'</div>';
  const html='<!doctype html><html><head>'+
    '<meta http-equiv="Content-Security-Policy" content="'+
    "script-src 'none'; img-src 'self' data:;"+
    '"></head><body><main id="cumulative-turns">'+
    detailHtml+extraLinks+turns.join('')+'</main></body></html>';
  fs.writeFileSync(path.join(source,'index.html'),html);
  fs.writeFileSync(path.join(previous,'events.jsonl'),
    old.map(JSON.stringify).join('\n')+'\n');
  fs.writeFileSync(path.join(current,'events.jsonl'),
    now.map(JSON.stringify).join('\n')+'\n');
  try{return testBody({root,source,previous,current,output,html,old,now});}
  finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('eight second-click URLs restore eight direct anchors while preserving every original control byte',()=>
  fixture(({source,previous,current,output,html})=>{
    const result=restoreSingletonCitationHtml(html,previous,current);
    assert.equal(result.restoredSingletons,8);
    assert.equal(result.sourceTargetsVerified,8);
    assert.equal((result.html.match(/class="poc068-singleton-restored"/g)||[]).length,8);
    assert.ok(result.html.includes('<img alt="Source 6-2" src="./assets/accepted-icon.png">'));
    assert.ok(result.html.includes("script-src 'none'"));
    assert.equal((result.html.match(/<details class="poc068-source-details"/g)||[]).length,8);
    assert.ok(result.html.includes('<button>Fonti</button>'));
    const doc=parseHTML(result.html).document;
    const newLinks=[...doc.querySelectorAll('a.poc068-singleton-restored')];
    assert.equal(newLinks.length,8);
    assert.equal(newLinks[0].getAttribute('href'),
      'https://example.org/private-citation/2/0');
    assert.equal(newLinks.at(-1).getAttribute('href'),
      'https://example.org/private-citation/8/1');
    assert.equal(doc.querySelectorAll('.poc068-source-links a[href]').length,19);
    const committed=materializeSingletonCitations(source,output,previous,current);
    assert.equal(committed.restoredSingletons,8);
    assert.equal(committed.existingMultiSourceDetails,8);
    assert.equal(committed.existingMultiSourceLinks,19);
    assert.equal(fs.readFileSync(path.join(source,'index.html'),'utf8'),html);
    assert.ok(fs.existsSync(path.join(output,'assets','accepted-icon.png')));
    assert.equal(fs.statSync(path.join(output,'index.html')).mode&0o077,0);
    assert.throws(()=>materializeSingletonCitations(output,
      path.join(source,'again'),previous,current),/already restored/);
  })
);
test('missing, duplicate and conflicting singleton navigation evidence fail before output creation',()=>
  fixture(({source,previous,current,output,now})=>{
    for(const variant of ['missing','duplicate','invalid','wrong-cardinality'])
    {
      const mutated=now.map(row=>({...row}));
      if(variant==='missing')mutated.pop();
      if(variant==='duplicate')mutated.push({...mutated[0]});
      if(variant==='invalid')mutated[0].popupCardOpened=['http://example.org/private'];
      if(variant==='wrong-cardinality')mutated[0].panelButtons=2;
      fs.writeFileSync(path.join(current,'events.jsonl'),
        mutated.map(JSON.stringify).join('\n'));
      assert.throws(()=>materializeSingletonCitations(
        source,output,previous,current));
      assert.equal(fs.existsSync(output),false);
    }
  })
);
test('turn identity and original visible citation markup must match archive',()=>
  fixture(({html,previous,current})=>{
    const mutated=html.replace('Site 6-1','different-site-6-1');
    assert.throws(()=>restoreSingletonCitationHtml(
      mutated,previous,current),/identity mismatch/);
  })
);
test('Fonti comparison returns only structural differences and no private text',()=>
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-fonti-'));
  try
  {
    const rows=[2,4,6,8].map(ordinal=>{
      const before='<article><button>Fonti</button><p>Private passage</p></article>';
      const after=ordinal===2||ordinal===6?
        '<article><button aria-expanded="true">Fonti</button>'+
          '<p>Private passage</p><section role="region">'+
          '<a href="https://private.example/sensitive">Private link</a>'+
          '</section></article>':before;
      return {kind:'interaction.remaining-control-intent',controlKind:'fonti',
        status:'dispatched',ordinal,index:0,
        turnBeforeHtml:before,turnAfterHtml:after,
        turnChanged:before!==after,panelObserved:false};
    });
    fs.writeFileSync(path.join(root,'events.jsonl'),
      rows.map(JSON.stringify).join('\n'));
    const report=inspectFontiDeltas(root);
    assert.deepEqual(report.fonti.map(x=>x.linkDelta),[1,0,1,0]);
    assert.deepEqual(report.fonti.map(x=>x.textChanged),[true,false,true,false]);
    assert.deepEqual(report.fonti.map(x=>x.fontiExpandedAfter),[1,0,1,0]);
    assert.ok(!JSON.stringify(report).includes('Private'));
    assert.ok(!JSON.stringify(report).includes('private.example'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
