'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {localize} from '../../localize-rendered-resources.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(),'rumiai-resource-localize-'));
const cumulative = path.join(temp,'cumulative'), archive = path.join(temp,'web-analyze');
const resourceRoot = path.join(archive,'resources');
fs.mkdirSync(cumulative);fs.mkdirSync(resourceRoot,{recursive:true});
const csp = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; " +
  "style-src 'unsafe-inline'; font-src data:; frame-src 'none'; object-src 'none'; " +
  "form-action 'none'; base-uri 'none'";
const html = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' +
  csp + '"></head><body><main id="cumulative-turns">' +
  '<div data-turn-id-container="turn-1"><img src="https://chatgpt.com/cdn/assets/i.png">' +
  '<svg><use href="/cdn/assets/sprites.svg#test"></use></svg>' +
  '<img src="https://no-snapshot.invalid/missing.png">' +
  '<img src="https://www.google.com/s2/favicons?domain=example.org&amp;sz=64">' +
  '<a href="https://example.org">link</a>' +
  '</div></main></body></html>';
fs.writeFileSync(path.join(cumulative,'index.html'),html);
fs.writeFileSync(path.join(cumulative,'audit.json'),'{"turns":[]}\n');
fs.writeFileSync(path.join(cumulative,'resource-references.json'),'[]\n');
const records=[];
function resource(url,type,mime,extension,bytes,extra={}) {
  const data=Buffer.from(bytes);
  const sha=crypto.createHash('sha256').update(data).digest('hex');
  const file='resources/'+sha+extension;
  fs.writeFileSync(path.join(archive,file),data);
  records.push({status:'saved',url,resourceType:type,mimeType:mime,file,
    sha256:sha,bytes:data.length,...extra});
  return {file,sha};
}
const pic=resource('https://chatgpt.com/cdn/assets/i.png','Image','image/png','.png','fakeimage-payload');
const svg=resource('https://chatgpt.com/cdn/assets/sprites.svg','Other','image/svg+xml','.svg',
  '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="test"><foreignObject width="1" height="1"><div xmlns="http://www.w3.org/1999/xhtml">static</div></foreignObject></symbol></svg>');
const font=resource('https://chatgpt.com/cdn/assets/f.woff2','Font','application/octet-stream','.woff2',
  'wOF2fake_font_fixture');
const css=resource('https://chatgpt.com/cdn/assets/root.css','Stylesheet','text/css','.css',
  '@import "https://external.invalid/extra.css"; .test{background:url("./i.png")}.font{src:url("./f.woff2")}.remote{background:url("https://external.invalid/tracker")}' );
records.push({status:'redirect-no-body',
  url:'https://www.google.com/s2/favicons?domain=example.org&sz=64',
  resourceType:'Image',httpStatus:301,session:'test-session',requestId:'favicon-1'});
const favicon=resource('https://t2.gstatic.com/faviconV2?client=TEST','Image','image/png',
  '.png','favicon-binary-example',{session:'test-session',requestId:'favicon-1'});
resource('https://chatgpt.com/private-api/token','Fetch','application/json','.json','{"secret":"fake"}');
fs.writeFileSync(path.join(archive,'resources.jsonl'),records.map(x=>JSON.stringify(x)).join('\n')+'\n');
try{
  const out=path.join(temp,'output');
  const summary=localize(cumulative,archive,out);
  assert.equal(summary.stylesheets,1);
  assert.equal(summary.staticFiles,5);
  assert.equal(summary.mediaReferencesMatched,3);
  assert.equal(summary.resolvedRedirectAliases,1);
  const view=fs.readFileSync(path.join(out,'index.html'),'utf8');
  assert(view.includes('assets/'+pic.sha+'.png'));
  assert(view.includes('assets/'+svg.sha+'.svg#test'));
  assert(view.includes('assets/'+favicon.sha+'.png'));
  assert(view.includes('assets/'+css.sha+'.css'));
  assert(view.includes('img-src \'self\' data:'));
  assert(view.includes("script-src 'none'"));
  assert(view.includes('<a href="https://example.org">'));
  const localCss=fs.readFileSync(path.join(out,'assets',css.sha+'.css'),'utf8');
  assert(localCss.includes('url("./'+pic.sha+'.png")'));
  assert(localCss.includes('url("./'+font.sha+'.woff2")'));
  assert(!localCss.includes('https://external.invalid'));
  assert(!localCss.includes('@import'));
  assert(!fs.existsSync(path.join(out,'assets',records.at(-1).sha256+'.json')));
  const audit=JSON.parse(fs.readFileSync(path.join(out,'localization-audit.json'),'utf8'));
  assert(audit.unresolvedReferences.some(x=>x.includes('no-snapshot.invalid')));
  assert(!audit.unresolvedReferences.some(x=>x.includes('www.google.com/s2/favicons')));
  assert(audit.unresolvedReferences.some(x=>x.includes('external.invalid')));
  assert.throws(()=>localize(cumulative,archive,out),/already exists/);
  const fontPath=path.join(archive,font.file);
  fs.appendFileSync(fontPath,'tampered');
  const failed=path.join(temp,'invalid-output');
  assert.throws(()=>localize(cumulative,archive,failed),/integrity failure/);
  assert(!fs.existsSync(failed));
  console.log('PASS: first-party CSS/fonts/media; sprite fragments, no remote scripts, CSP, unresolved audit, SHA-256');
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}
