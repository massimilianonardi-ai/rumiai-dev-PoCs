// Evidence boundary for the original ChatGPT rendering resources.
// Browser-fetched assets and message references are different sets.
// Do NOT mark an asset as exported solely because a URL/pointer exists.
const knownMime=(mime,re)=>re.test((mime||'').toLowerCase());
export function auditRenderingEvidence(model,assetRecords=[],richStates=[]){
  const resources=(model?.visible||[]).flatMap(item=>
    (item.resources?.references||[]).map(r=>({
      messageId:item.messageId,kind:r.kind,value:r.value,
      path:r.path})));
  const fetched=assetRecords.filter(x=>x.file&&x.sha256&&x.bytes>0);
  const canonical=value=>{
    try{const u=new URL(value);return u.origin+u.pathname;}
    catch{return null;}
  };
  const available=new Set(fetched.map(x=>canonical(x.url)).filter(Boolean));
  const audited=resources.map(ref=>{
    const target=canonical(ref.value);
    return {messageId:ref.messageId,path:ref.path,
      referenceKind:ref.kind,uriScheme:(ref.value.match(/^[\w+.-]+:/)||[])[0]||null,
      localAssetMatched:target!==null&&available.has(target),
      // Resolvable pointer existence ≠ actual bytes are present.
      resolution:target&&available.has(target)?'browser-resource-captured':
        'unresolved-reference'};
  });
  const byMime={
    stylesheets:fetched.filter(x=>knownMime(x.mime,/text\/css/)).length,
    images:fetched.filter(x=>knownMime(x.mime,/^image\//)).length,
    fonts:fetched.filter(x=>knownMime(x.mime,/^(?:font\/|application\/font)/)).length,
    audio:fetched.filter(x=>knownMime(x.mime,/^audio\//)).length,
    video:fetched.filter(x=>knownMime(x.mime,/^video\//)).length,
    attachments:fetched.filter(x=>knownMime(x.mime,/application\/pdf|octet-stream/)).length
  };
  const rich={
    tables:0,svgs:0,canvas:0,imagesInDom:0,
    overflow:0,unavailableCanvas:0
  };
  for(const state of richStates){
    if(state.fragmentTruncated||state.styleSheetTruncated||
       state.canvasTruncated)rich.overflow++;
    for(const item of state.fragments||[]){
      if(item.tag==='table')rich.tables++;
      if(item.tag==='svg')rich.svgs++;
      if(item.tag==='canvas')rich.canvas++;
      if(item.tag==='img')rich.imagesInDom++;
    }
    for(const c of state.canvases||[])
      if(c.status!=='captured')rich.unavailableCanvas++;
  }
  return {sourceMessageCount:model?.visible?.length||0,
    indexedReferences:audited.length,
    resolvedByLoadedBrowserResource:audited.filter(x=>x.localAssetMatched).length,
    unresolvedReferences:audited.filter(x=>!x.localAssetMatched).length,
    assetsFetched:fetched.length,byMime,rich,
    references:audited,
    completeRenderingVerified:false,
    note:'CSS/layout, referenced images and attachments need independent byte and visual verification; DOM presence is not a complete export.'};
}
