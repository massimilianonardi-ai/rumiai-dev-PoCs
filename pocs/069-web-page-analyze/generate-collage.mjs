#!/usr/bin/env node
// Assemble a navigable visual collage from original screenshot evidence.
// Never parse or rewrite native MHTML, CSS, or archived DOM.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collageHtml} from './collage.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const sites=['amazon-wishlist','chatgpt-share'];
export async function generate(run) {
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(run))
    throw Error('collage.invalid-run-name');
  const evidence=path.join(root,'evidence');
  const actual=await fs.realpath(evidence);
  if(actual!==path.join(await fs.realpath(root),'evidence'))
    throw Error('collage.evidence-root-escaped');
  const folder=path.join(actual,run);
  if(path.dirname(await fs.realpath(folder))!==actual)
    throw Error('collage.run-outside-poc');
  const results=[];
  for(const site of sites) {
    const dir=path.join(folder,site);
    const states=path.join(dir,'states');
    const names=(await fs.readdir(states,{withFileTypes:true})
      .catch(e=>e.code==='ENOENT'?[]:Promise.reject(e)))
      .filter(e=>e.isDirectory()&&/^\d{4,6}$/.test(e.name))
      .map(e=>e.name).sort();
    const captures=[];
    for(const name of names) {
      try {
        const record=path.join(states,name,'capture.json');
        const png=path.join(states,name,'original.png');
        const [r,p]=await Promise.all([fs.realpath(record),fs.realpath(png)]);
        if(!r.startsWith(states+path.sep)||
           !p.startsWith(states+path.sep))continue;
        const capture=JSON.parse(await fs.readFile(r,'utf8'));
        captures.push({id:name,capture});
      } catch(e) {
        if(e.code!=='ENOENT') throw e;
      }
    }
    const destination=path.join(dir,'collage.html');
    const contents=collageHtml(site,captures);
    await fs.writeFile(destination,contents,{flag:'w',mode:0o600});
    results.push({site,states:captures.length,
      collage:destination});
  }
  return results;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  generate(process.argv[2]).then(items=>{
    for(const item of items)console.log('[COLLAGE] '+item.site+
      ' '+item.states+' stati: '+item.collage);
  }).catch(e=>{console.error('[ERRORE] '+e.message);process.exitCode=1;});
