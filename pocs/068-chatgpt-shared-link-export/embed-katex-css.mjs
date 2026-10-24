'use strict';
// Trusted, pinned KaTeX stylesheet packaged with local WOFF2 fonts.
// The generated transcript embeds every required font and needs no network.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const version='0.16.25';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),
  'node_modules','katex');

export function embeddedKatexCss()
{
  let pkg,css;
  try
  {
    pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
    css=fs.readFileSync(path.join(root,'dist','katex.min.css'),'utf8');
  }
  catch
  {
    throw Error('KaTeX CSS/fonts unavailable: run npm install in the PoC directory');
  }
  if(pkg.version!==version)
    throw Error('KaTeX dependency version differs from pinned '+version);
  if(css.length<10000 || css.length>500000 || !css.includes('@font-face'))
    throw Error('KaTeX stylesheet size or content invalid');
  let total=0,fontFaces=0;
  const resolved=css.replace(/@font-face\s*\{[^}]*\}/g,block=>
  {
    const match=/url\(["']?fonts\/(KaTeX_[A-Za-z0-9-]+\.woff2)["']?\)/.exec(block);
    const source=/src\s*:[^;]+;/i;
    if(!match || !source.test(block))
      throw Error('KaTeX font-face lacks a local WOFF2 source: '+block.slice(0,200));
    const file=path.join(root,'dist','fonts',match[1]);
    const bytes=fs.readFileSync(file);
    if(bytes.length<100 || bytes.length>400000)
      throw Error('KaTeX WOFF2 font size invalid');
    total+=bytes.length;
    if(total>8000000) throw Error('KaTeX embedded font total too large');
    fontFaces++;
    return block.replace(source,'src:url("data:font/woff2;base64,'+
      bytes.toString('base64')+'") format("woff2");');
  });
  if(fontFaces<8 || !resolved.includes('.katex') ||
      /url\(\s*["']?fonts\//.test(resolved) ||
      /@import\b|<\/style/i.test(resolved))
    throw Error('KaTeX CSS failed offline self-containment checks');
  return resolved;
}
