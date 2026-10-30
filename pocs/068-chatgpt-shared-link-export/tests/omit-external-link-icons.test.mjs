'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {omitExternalLinkIcons} from '../omit-external-link-icons.mjs';

function fixture(body,run)
{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-icons-'));
  const html='<!doctype html><html><head>'+
    '<meta content="script-src \u0027none\u0027">'+
    '<style>.original{color:inherit}</style></head><body>'+
    '<main id="cumulative-turns">'+body+'</main></body></html>';
  fs.writeFileSync(path.join(dir,'index.html'),html);
  try{return run(dir,html);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('omits only citation and external-link icons, preserves surrounding HTML bytes',()=>
 fixture('<div aria-haspopup="dialog"><span>Source +1</span>'+
   '<img src="https://example.net/citation.png"></div>'+
   '<a href="https://external.example/article">Article'+
   '<img width="16" height="16" src="https://example.net/link.png"></a>'+
   '<img src="https://www.google.com/s2/favicons?domain=x">'+
   '<p>Diagram <img src="https://example.net/diagram.png" width="600" height="500"></p>',
   (dir,html)=>{
     const report=omitExternalLinkIcons(dir);
     assert.deepEqual(report,{omitted:3,preserved:1});
     const after=fs.readFileSync(path.join(dir,'index.html'),'utf8');
     assert.equal(after,html
       .replace('<img src="https://example.net/citation.png">','')
       .replace('<img width="16" height="16" src="https://example.net/link.png">','')
       .replace('<img src="https://www.google.com/s2/favicons?domain=x">',''));
     assert.match(after,/https:\/\/example.net\/diagram.png/);
   })
);
test('content images in normal linked media remain intact',()=>
 fixture('<a href="https://example.net/full"><img width="640" height="480" '+
   'src="https://example.net/content.png"></a>'+
   '<img src="/images/ecosystem/apps/github/icon.png">',
   (dir,html)=>{
     assert.deepEqual(omitExternalLinkIcons(dir),{omitted:0,preserved:2});
     assert.equal(fs.readFileSync(path.join(dir,'index.html'),'utf8'),html);
   })
);
test('known Google favicon tags are removed even when not nested in an anchor',()=>
 fixture('<img src="https://t0.gstatic.com/faviconV2?url=example.net">'+
   '<a href="https://external.example"><img class="source-icon" '+
   'src="https://external.example/brand.png"></a>',
   dir=>{
     assert.deepEqual(omitExternalLinkIcons(dir),{omitted:2,preserved:0});
   })
);
test('refuses to edit HTML without the script-blocking policy',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-icons-csp-'));
  try{
    const file=path.join(dir,'index.html');
    const html='<html><img src="https://www.google.com/s2/favicons"></html>';
    fs.writeFileSync(file,html);
    assert.throws(()=>omitExternalLinkIcons(dir),/script-blocked/);
    assert.equal(fs.readFileSync(file,'utf8'),html);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
