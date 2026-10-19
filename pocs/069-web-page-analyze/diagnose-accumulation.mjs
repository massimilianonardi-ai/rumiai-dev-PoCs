#!/usr/bin/env node
// Read-only, privacy-minimized post-mortem for a PRIVATE accumulation.
// Never opens the original conversation HTML, assets, full stream or profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runDirectory} from './accumulate.mjs';

export function resourceErrorClass(value){
  const error=String(value||'');
  if(/timeout/i.test(error))return 'resource-body-timeout';
  if(/ERR_CERT|certificate/i.test(error))return 'resource-certificate-error';
  if(/ERR_ABORTED|aborted/i.test(error))return 'resource-aborted';
  if(/Target closed|Page closed|browser has been closed/i.test(error))
    return 'browser-closed-before-resource-read';
  if(/protocol error|CDP/i.test(error))return 'browser-protocol-error';
  if(/EACCES|permission denied/i.test(error))return 'resource-storage-permission';
  if(/EEXIST|already exists/i.test(error))return 'resource-file-exists';
  return 'other-resource-error';
}
export function summarizeAccumulation(m){
  const errors={};
  for(const item of m.resourcesErrors||[]){
    const kind=resourceErrorClass(item.error);
    errors[kind]=(errors[kind]||0)+1;
  }
  const r=m.continuity||{};
  const nav=m.navigation||{};
  return {status:m.status||'missing',
    source:m.source?'shared-link-run':'missing',
    steps:m.steps??null,stopReason:m.stopReason||null,
    automaticStopReason:m.automaticStopReason||m.stopReason||null,
    turns:r.distinct??null,components:r.orderComponents??null,
    remounts:r.remounts??null,orderingCycles:r.orderCycle??null,
    firstMountedWindowLength:r.firstFrame?.length??null,
    lastMountedWindowLength:r.lastFrame?.length??null,
    progress:{
      initialTurns:nav.initialTurns??null,
      autoWheelAttempts:nav.attempts??m.steps??null,
      stepsWithNewIdentities:nav.newIdentitySteps??null,
      stepsWithDOMChanges:nav.domChangeSteps??null,
      manualRequested:nav.manual!==undefined,
      manualUsed:nav.manual?.used??null,
      humanReportedEnd:nav.manual?.confirmed===true
    },
    resources:m.resources||{},
    resourceErrorClasses:errors,
    failuresRecorded:(m.resourcesErrors||[]).length,
    unresolvedCssCount:(m.unresolvedCss||[]).length,
    unresolvedMedia:m.unresolvedMedia??null,
    unresolvedAttachments:m.unresolvedAttachments??null,
    unresolvedSrcset:m.unresolvedSrcset??null,
    completeExportVerified:false,
    reason:'No verified first/last message and continuous rich-media coverage'
  };
}
async function run(name){
  const run=runDirectory(name);
  if(await fs.realpath(run)!==run)throw Error('diagnose.run-symlink');
  const filename=path.join(run,'manifest.json');
  if(await fs.realpath(filename)!==filename)
    throw Error('diagnose.manifest-symlink');
  const manifest=JSON.parse(await fs.readFile(filename,'utf8'));
  process.stdout.write('[ACCUMULAZIONE-DIAGNOSI] '+
    JSON.stringify(summarizeAccumulation(manifest))+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  run(process.argv[2]).catch(e=>{
    process.stderr.write('[ERRORE] '+String(e.message||e)+'\n');
    process.exitCode=1;
  });
}
