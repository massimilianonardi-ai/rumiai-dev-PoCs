#!/usr/bin/env node
// Assemble a navigable visual collage from original screenshot evidence.
// Never parse or rewrite native MHTML, CSS, or archived DOM.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collageHtml} from './collage.mjs';
import {manualSourceReviewHtml} from './manual-review.mjs';

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
  if(await fs.realpath(folder)!==folder)
    throw Error('collage.run-symlink-not-allowed');
  if(path.dirname(folder)!==actual)
    throw Error('collage.run-outside-poc');
  const results=[];
  for(const site of sites) {
    const dir=path.join(folder,site);
    if(await fs.realpath(dir)!==dir)
      throw Error('collage.site-symlink-not-allowed');
    const states=path.join(dir,'states');
    try{
      if(await fs.realpath(states)!==states)
        throw Error('collage.states-symlink-not-allowed');
    }catch(e){if(e.code!=='ENOENT')throw e;}
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
    try{
      const prior=await fs.lstat(destination);
      if(!prior.isFile()||prior.isSymbolicLink())
        throw Error('collage.destination-is-not-a-regular-file');
    }catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.writeFile(destination,contents,{flag:'w',mode:0o600});
    // For virtualized ChatGPT the original human-controlled screenshots
    // are the authoritative visual evidence. Render a separate read-only
    // review from existing private PNGs/JSON; do not touch the MHTML.
    let manualReview=null;
    if(site==='chatgpt-share'){
      const manual=path.join(dir,'manual');
      try{
        if(await fs.realpath(manual)!==manual)
          throw Error('collage.manual-symlink-not-allowed');
        const manifestFile=path.join(manual,'manifest.json');
        if(await fs.realpath(manifestFile)!==manifestFile)
          throw Error('collage.manual-manifest-symlink-not-allowed');
        const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
        const names=(manifest.frameIds||[])
          .filter(id=>typeof id==='string'&&/^[0-9]{4,6}$/.test(id));
        const frames=[];
        for(const id of names){
          const metadata=path.join(manual,id+'.json');
          const screenshot=path.join(manual,id+'.png');
          if(await fs.realpath(metadata)!==metadata||
             await fs.realpath(screenshot)!==screenshot)
            throw Error('collage.manual-frame-symlink-not-allowed');
          const frame=JSON.parse(await fs.readFile(metadata,'utf8'));
          if(frame.id!==id)throw Error('collage.manual-frame-id-mismatch');
          frames.push(frame);
        }
        let report=null;
        try{
          const reportFile=path.join(dir,'report.json');
          if(await fs.realpath(reportFile)!==reportFile)
            throw Error('collage.report-symlink-not-allowed');
          report=JSON.parse(await fs.readFile(reportFile,'utf8'));
        }catch(e){if(e.code!=='ENOENT')throw e;}
        const destinationManual=path.join(manual,'source-review.html');
        try{
          const prior=await fs.lstat(destinationManual);
          if(!prior.isFile()||prior.isSymbolicLink())
            throw Error('collage.manual-destination-not-regular-file');
        }catch(e){if(e.code!=='ENOENT')throw e;}
        await fs.writeFile(destinationManual,
          manualSourceReviewHtml(manifest,frames,report),
          {flag:'w',mode:0o600});
        manualReview=destinationManual;
      }catch(e){
        if(e.code!=='ENOENT')throw e;
      }
    }
    results.push({site,states:captures.length,
      collage:destination,manualReview});
  }
  return results;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  generate(process.argv[2]).then(items=>{
    for(const item of items){
      console.log('[COLLAGE] '+item.site+
        ' '+item.states+' stati: '+item.collage);
      if(item.manualReview)
        console.log('[SORGENTE MANUALE] '+item.manualReview);
    }
  }).catch(e=>{console.error('[ERRORE] '+e.message);process.exitCode=1;});
