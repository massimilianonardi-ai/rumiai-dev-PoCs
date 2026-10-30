#!/usr/bin/env node
'use strict';
// Offline ChatGPT share export. The original citation controls are preserved
// visually, but external citation destinations are never a completeness gate.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderSameSessionStyled} from './render-same-session-styled.mjs';
import {localizeExactCapturedImages} from './localize-exact-captured-images.mjs';
import {inspectOfflineLinkControls} from './inspect-offline-link-controls.mjs';
import {readCapturedChatMetadata} from './share-metadata.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));

export function validatedShareUrl(input)
{
  if(typeof input!=='string'||input.length>2048)
    throw Error('A public ChatGPT shared URL is required');
  let parsed;
  try{parsed=new URL(input);}catch{throw Error('Invalid shared URL');}
  if(parsed.protocol!=='https:'||parsed.hostname!=='chatgpt.com'||
     parsed.port||parsed.username||parsed.password||parsed.search||
     parsed.hash||!/^\/share\/[a-z0-9-]{16,128}$/i.test(parsed.pathname))
    throw Error('Expected https://chatgpt.com/share/<share-id> without query or fragment');
  return parsed.href;
}

function privateOutputPath(outputName)
{
  if(typeof outputName!=='string'||!outputName.trim())
    throw Error('A new output directory is required');
  const output=path.resolve(outputName);
  if(fs.existsSync(output))
    throw Error('Output already exists; never overwrite an archive');
  const parent=path.dirname(output);
  if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())
    throw Error('Output parent directory must exist');
  return output;
}

async function runCapture(url,directory,flags)
{
  const logDir=path.dirname(directory),label=path.basename(directory);
  const stdout=fs.openSync(path.join(logDir,label+'.stdout.log'),'wx',0o600);
  const stderr=fs.openSync(path.join(logDir,label+'.stderr.log'),'wx',0o600);
  try
  {
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,
        [path.join(root,'render-probe.mjs'),url,directory,
          '--headless','--sweep',...flags],
        {cwd:root,stdio:['ignore',stdout,stderr]});
      child.once('error',reject);
      child.once('exit',(exitCode,signal)=>{
        if(signal)reject(Error('Capture interrupted by signal'));
        else resolve(exitCode);
      });
    });
    if(code!==0){
      const error=Error('Chromium capture '+label+' failed with exit '+code+
        '; private diagnostic log retained');
      error.captureExitCode=code;
      throw error;
    }
    const audit=JSON.parse(fs.readFileSync(
      path.join(directory,'summary.json'),'utf8'));
    if(!audit.counts||audit.counts['sweep.finished']!==1||
       !Number.isSafeInteger(audit.uniqueTurnSnapshots)||
       audit.uniqueTurnSnapshots<=0)
      throw Error('Incomplete conversation sweep for '+label);
    return audit;
  }finally{fs.closeSync(stdout);fs.closeSync(stderr);}
}

const realOperations={
  capture:runCapture,
  metadata:readCapturedChatMetadata,
  render:renderSameSessionStyled,
  localize:localizeExactCapturedImages,
  inspect:inspectOfflineLinkControls
};

export async function exportOfflineShare(urlInput,outputName,options={})
{
  const url=validatedShareUrl(urlInput);
  const output=privateOutputPath(outputName);
  const keepEvidence=options.keepEvidence===true;
  const ops={...realOperations,...(options.operations||{})};
  const progress=typeof options.progress==='function'?options.progress:()=>{};
  const stage=fs.mkdtempSync(path.join(path.dirname(output),'.poc068-export-'));
  fs.chmodSync(stage,0o700);
  let published=false;
  try
  {
    const capture=async(name,flags)=>{
      for(let attempt=0;attempt<2;attempt++){
        const label=attempt?name+'-readiness-retry':name;
        const directory=path.join(stage,label);
        progress('Capturing '+label);
        try{
          await ops.capture(url,directory,flags);
          return directory;
        }catch(error){
          if(attempt===0&&error.captureExitCode===3){
            progress('Conversation DOM not ready; retrying isolated Chrome profile');
            continue;
          }
          throw error;
        }
      }
      throw Error('Conversation DOM could not be captured');
    };

    const base=await capture('original',[
      '--observe-interactions','--capture-static-bodies',
      '--capture-image-bodies']);
    const metadata=options.withMetadata===true?ops.metadata(base,url):null;
    const styled=path.join(stage,'styled');
    progress('Rendering original HTML and CSS; citation targets are optional');
    // Without trusted source-target evidence, the renderer retains the
    // original citation controls and CSS; it does not fabricate links.
    const rendering=ops.render(base,styled);
    if(!Number.isSafeInteger(rendering.capturedTurnCount)||
       rendering.capturedTurnCount<=0)
      throw Error('Original conversation render has no captured turns');

    const final=path.join(stage,'archive');
    let checked=ops.inspect(styled);
    if(checked.hasScriptBlocking!==true)
      throw Error('Original scripts must remain blocked');
    if((checked.imageReferences?.remote||0)>0)
    {
      let completed=false;
      let captures=[base];
      for(let attempt=0;attempt<2 && !completed;attempt++)
      {
        try{
          progress('Localizing exact captured image resources');
          ops.localize(styled,final,captures);
          completed=true;
        }catch(error){
          if(attempt!==0||
             !/Unmatched remote image reference/.test(String(error.message)))
            throw error;
          captures=[...captures,await capture('more-images',[
            '--capture-image-bodies'])];
        }
      }
      if(!completed)throw Error('Original image bytes are incomplete');
    }
    else
    {
      // No external image resources: reuse the already localized CSS/fonts.
      fs.cpSync(styled,final,{recursive:true,force:false,errorOnExist:true});
    }

    checked=ops.inspect(final);
    if(checked.hasScriptBlocking!==true||
       (checked.imageReferences?.remote||0)>0||
       (checked.imageReferences?.outside||0)>0||
       (checked.imageReferences?.['local-missing']||0)>0)
      throw Error('Final offline HTML or local images failed structural audit');
    fs.renameSync(final,output);
    published=true;
    return {status:'private-offline-export-created',output,
      ...(metadata?{metadata}:{}),
      restoredGroups:0,groupLinks:0,singletonLinks:0,
      remoteImages:0,originalScriptsDisabled:true,
      evidenceDirectory:keepEvidence?stage:null,
      limitations:[
        'Citation controls retain their visual representation; target URLs and click behavior are not guaranteed',
        'Original site JavaScript is disabled in the offline archive',
        'Visible HTML capture does not certify completeness of the RAW conversation'
      ]};
  }
  catch(error){
    error.privateEvidenceDirectory=stage;
    throw error;
  }
  finally{
    if(published&&!keepEvidence)
      fs.rmSync(stage,{recursive:true,force:true});
  }
}

function usage()
{
  console.error('Usage: node export-offline.mjs <https://chatgpt.com/share/ID> <new-private-output-dir> [--keep-evidence] [--with-metadata]');
}

if(process.argv[1]&&path.resolve(process.argv[1])===
   path.resolve(fileURLToPath(import.meta.url)))
{
  const args=process.argv.slice(2),flags=args.slice(2);
  if(args.length<2||args.length>4||
     flags.some(x=>!['--keep-evidence','--with-metadata'].includes(x))||
     new Set(flags).size!==flags.length){
    usage();process.exitCode=2;
  }else{
    exportOfflineShare(args[0],args[1],{
      keepEvidence:flags.includes('--keep-evidence'),
      withMetadata:flags.includes('--with-metadata'),
      progress:message=>console.error('[offline-export] '+message)
    }).then(result=>console.log(JSON.stringify(result,null,2)),
      error=>{
        console.error('[offline-export] '+error.message);
        if(error.privateEvidenceDirectory)
          console.error('[offline-export] Private diagnostics: '+
            error.privateEvidenceDirectory);
        process.exitCode=1;
      });
  }
}
