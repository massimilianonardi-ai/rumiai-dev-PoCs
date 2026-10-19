// Data-first conversation reconstruction. Adapted conceptually from the
// user-supplied chatgpt-export.py (macOS renderer snapshot exporter).
// This module consumes a verified mapping/current_node snapshot; it NEVER
// claims those fields exist on public shared-link pages without evidence.
// It preserves source message objects; no text-only export is "full fidelity".
const internalContent=new Set(['thoughts','reasoning_recap']);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const formatError=code=>new Error('snapshot.'+code);

export function activeBranch(snapshot){
  if(!plain(snapshot)||!plain(snapshot.mapping)||
     typeof snapshot.current_node!=='string'||!snapshot.current_node)
    throw formatError('mapping-or-current-node-missing');
  const mapping=snapshot.mapping,seen=new Set(),reverse=[];
  let id=snapshot.current_node;
  while(id){
    if(typeof id!=='string')throw formatError('invalid-node-id');
    if(seen.has(id))throw formatError('cycle');
    seen.add(id);
    const node=mapping[id];
    if(!plain(node))throw formatError('parent-chain-broken');
    reverse.push({nodeId:id,parent:node.parent??null,node});
    id=node.parent??null;
  }
  reverse.reverse();
  return reverse;
}
export function userVisibleCandidate(message){
  if(!plain(message))return {include:false,classification:'no-message'};
  const role=message.author?.role,content=message.content||{},
    type=content.content_type;
  if(role==='tool')return {include:false,classification:'tool-traffic'};
  if(role!=='user'&&role!=='assistant')
    return {include:false,classification:'internal-role'};
  if(internalContent.has(type))
    return {include:false,classification:'internal-reasoning'};
  if(role==='assistant'&&message.channel==='analysis')
    return {include:false,classification:'assistant-analysis'};
  if(role==='assistant'&&
     ![undefined,null,'','all'].includes(message.recipient))
    return {include:false,classification:'assistant-tool-invocation'};
  const strings=Array.isArray(content.parts)?
    content.parts.filter(x=>typeof x==='string'):[];
  const fallback=typeof content.text==='string'?content.text:
    typeof content.code==='string'?content.code:'';
  const hasNonText=Array.isArray(content.parts)&&
    content.parts.some(x=>typeof x!=='string');
  if(role==='assistant'&&strings.length===0&&!fallback&&!hasNonText)
    return {include:false,classification:'empty-assistant-node'};
  return {include:true,classification:'visible-candidate'};
}
export function resourceReferences(source,{maxEntries=3000}={}){
  // Inventory only, NOT asset bytes. Paths are structural JSON paths
  // (keys can be site-specific); any URL or pointer must be resolved and
  // downloaded separately with provenance and MIME checks.
  const output=[],visited=new WeakSet();
  function visit(value,path,depth){
    if(output.length>=maxEntries||depth>18||value===null)return;
    if(typeof value==='string'){
      const last=path.at(-1)||'';
      const keyHint=/image|asset|attach|file|media|video|audio|poster|thumbnail|download|url|src|plot|chart|citation|ref|pointer/i.test(last);
      const uri=/^(?:https?:\/\/|data:|blob:|file-service:|sediment:\/\/)/i.test(value);
      const imageMarkdown=/!\[[^\]]*]\(([^)]+)\)/.test(value);
      if(keyHint||uri||imageMarkdown)
        output.push({path:path.join('/'),key:last,value,
          kind:uri?'uri':imageMarkdown?'markdown-image':'reference'});
      return;
    }
    if(typeof value!=='object'||visited.has(value))return;
    visited.add(value);
    if(Array.isArray(value)){
      value.forEach((x,i)=>visit(x,path.concat(String(i)),depth+1));
    }else{
      for(const [k,v] of Object.entries(value))
        visit(v,path.concat(k),depth+1);
    }
  }
  visit(source,[],0);
  return {references:output,truncated:output.length>=maxEntries};
}
export function conversationModel(snapshot){
  const branch=activeBranch(snapshot);
  const visible=[],audit=[];
  for(let ordinal=0;ordinal<branch.length;ordinal++){
    const {nodeId,parent,node}=branch[ordinal];
    const msg=node.message||null;
    const classified=userVisibleCandidate(msg);
    const content=msg?.content||{};
    const textParts=Array.isArray(content.parts)?
      content.parts.filter(x=>typeof x==='string'):[];
    const fallback=typeof content.text==='string'?content.text:
      typeof content.code==='string'?content.code:'';
    const text=textParts.length?textParts.join(''):fallback;
    const nonText=Array.isArray(content.parts)?
      content.parts.filter(x=>typeof x!=='string'):[];
    const common={ordinal,nodeId,parent,messageId:msg?.id??null,
      role:msg?.author?.role??null,contentType:content.content_type??null,
      classification:classified.classification,
      included:classified.include};
    audit.push(common);
    if(classified.include)
      visible.push({...common,text,textLength:text.length,
        nonTextCount:nonText.length,
        // Keep all source fields for unrecognized rich content or future
        // asset resolution. Do not represent this as already-rendered.
        message:msg,resources:resourceReferences(msg)});
  }
  return {conversationId:snapshot.conversation_id??null,
    title:snapshot.title??null,currentNode:snapshot.current_node,
    mappingCount:Object.keys(snapshot.mapping).length,
    activeBranchCount:branch.length,
    activeNodeIds:branch.map(x=>x.nodeId),
    visibleCount:visible.length,visible,audit,
    resourceBytesCaptured:false,renderingVerified:false,
    source:'verified-mapping-snapshot'};
}
