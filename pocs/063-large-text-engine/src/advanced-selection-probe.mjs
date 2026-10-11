// PoC 063: advanced-selection policy consuming document representation.
// This policy is deliberately not in the projection, TextEditSelections,
// or TextEditBase. Select by VISIBLE projection rows; never use pixels/DOM.
const natural=n=>Number.isSafeInteger(n)&&n>=0;
export function resolveVisibleLineSelection(document,projection,{
  from,to,includeFolded=false
}={}){
  if(!document||typeof document.lineStart!=='function'||
    !natural(document.lineCount)||!natural(document.length)||
    !projection||typeof projection.viewLineToSource!=='function')
    throw new TypeError('indexed document and projection required');
  if(!natural(from)||!natural(to)||from>to||
    to>=projection.visibleLineCount||typeof includeFolded!=='boolean')
    throw new RangeError('visible selection');
  function lineAfter(logicalLine){
    return logicalLine+1<document.lineCount?
      document.lineStart(logicalLine+1):document.length;
  }
  if(includeFolded){
    const first=projection.viewLineToSource(from);
    const last=projection.viewLineToSource(to);
    return [{start:document.lineStart(first),end:lineAfter(last),forward:true}];
  }
  const result=[];
  for(let view=from;view<=to;view++){
    const line=projection.viewLineToSource(view);
    result.push({start:document.lineStart(line),end:lineAfter(line),
      forward:true});
  }
  return result;
}
