// Application UI is separate from the reusable jsc compiler and loader.
(function() {
 'use strict';
 const runtime=globalThis.JscRuntime;
 const load=document.getElementById('load'),patch=document.getElementById('patch');
 const tap=document.getElementById('tap'),output=document.getElementById('result');
 const metrics=globalThis.workflowMetrics={taps:0,disposals:0,last:null};
 const greeting=runtime.require('app').greeting;
 const initialOptional=runtime.revision('optional');
 let active=null,busy=false;
 function snapshot(){
  return {greeting,mode:initialOptional?'embedded':'network',
   version:active?.version??null,registered:runtime.state().registered,
   active:runtime.state().active,taps:metrics.taps,disposals:metrics.disposals,last:metrics.last,
   optionalRevision:runtime.revision('optional')};
 }
 function show(){output.textContent=JSON.stringify(snapshot(),null,2);}
 async function guarded(action){
  if(busy)throw Error('operation already running');
  busy=true;
  load.disabled=true;patch.disabled=true;tap.disabled=true;
  try{return await action();}
  finally{busy=false;load.disabled=active!==null;patch.disabled=active===null;tap.disabled=active===null;show();}
 }
 async function loadOptional(){
  return guarded(async()=>{
   if(active)throw Error('optional module already active');
   if(runtime.revision('optional')===0)
    await runtime.loadScript('./optional.js',{expect:'optional'});
   active=runtime.require('optional');
   return snapshot();
  });
 }
 async function applyPatch(){
  return guarded(async()=>{
   if(!active)throw Error('load optional module first');
   await runtime.loadScript('./patch.js',{expect:'optional'});
   // Existing exports are not live bindings. Always reacquire after replacement.
   active=runtime.require('optional');
   return snapshot();
  });
 }
 function useOptional(){
  if(!active||busy)throw Error('optional module not available');
  tap.click();
  return snapshot();
 }
 load.addEventListener('click',()=>loadOptional().catch(e=>output.textContent='ERROR '+e.message));
 patch.addEventListener('click',()=>applyPatch().catch(e=>output.textContent='ERROR '+e.message));
 const demo=Object.freeze({loadOptional,applyPatch,useOptional,snapshot});
 globalThis.WorkflowDemo=demo;
 show();
 if(new URLSearchParams(location.search).has('selftest')){
  (async()=>{
   try{
    const initial=snapshot();
    if(initial.active!==2||initial.taps!==0||initial.version!==null||initial.registered!==(initialOptional?3:2))
     throw Error('initial graph not lazy');
    const v1=await loadOptional();
    if(v1.version!=='v1'||v1.active!==3)throw Error('optional activation failed');
    if(useOptional().taps!==1||metrics.last!=='v1')throw Error('v1 listener failed');
    const v2=await applyPatch();
    if(v2.version!=='v2'||v2.disposals!==1||v2.active!==3)throw Error('v1 disposal/v2 activation failed');
    if(useOptional().taps!==2||metrics.last!=='v2')throw Error('stale or duplicated listener');
    if(runtime.revision('optional')!==(initialOptional?2:2))throw Error('unexpected revision');
    output.textContent='PASS WORKFLOW '+JSON.stringify(snapshot());
   }catch(error){output.textContent='FAIL WORKFLOW '+error.stack;}
  })();
 }
})();
