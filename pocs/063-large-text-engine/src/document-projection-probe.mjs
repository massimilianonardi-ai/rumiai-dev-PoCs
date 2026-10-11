// PoC 063: DOM-independent on-demand document representation (not a product API).
// UTF-16 offsets refer to the unchanged source; view rows are not pixel rows.
const natural=n=>Number.isSafeInteger(n)&&n>=0;
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function lowerBound(array,value,key){
  let lo=0,hi=array.length;
  while(lo<hi){
    const mid=Math.floor((lo+hi)/2);
    if(key(array[mid])<value)lo=mid+1;else hi=mid;
  }
  return lo;
}
function sourceLine(document,offset){
  let lo=0,hi=document.lineCount;
  while(lo+1<hi){
    const mid=Math.floor((lo+hi)/2);
    if(document.lineStart(mid)<=offset)lo=mid;else hi=mid;
  }
  return lo;
}
function textEnd(document,line){
  const start=document.lineStart(line);
  const next=line+1<document.lineCount?
    document.lineStart(line+1):document.length;
  let end=next;
  if(end>start&&document.slice(end-1,end)==='\n')end--;
  if(end>start&&end<next&&document.slice(end-1,end)==='\r')end--;
  return {start,end,next};
}
export function createDocumentProjection(document,{
  folds=[],annotations=[],maxLineUnits=512,maxAnnotationsPerRow=16
}={}){
  if(!document||!natural(document.length)||!natural(document.lineCount)||
    document.lineCount<1||typeof document.lineStart!=='function'||
    typeof document.slice!=='function')
    throw new TypeError('indexed document required');
  if(!natural(maxLineUnits)||maxLineUnits<1||
     !natural(maxAnnotationsPerRow))
    throw new RangeError('projection bounds');
  if(!Array.isArray(folds)||!Array.isArray(annotations))
    throw new TypeError('projection inputs');
  // A fold shows its header and hides lines from+1 through to, inclusive.
  // Nested/overlapping folds are rejected, not silently reinterpreted.
  const orderedFolds=folds.map(f=>{
    if(!f||!natural(f.from)||!natural(f.to)||f.from>=f.to||
      f.to>=document.lineCount)throw new RangeError('invalid fold lines');
    return {from:f.from,to:f.to};
  }).sort((a,b)=>a.from-b.from);
  let hidden=0,lastEnd=-1;
  for(const f of orderedFolds){
    if(f.from<=lastEnd)throw new RangeError('overlapping/nested folds');
    f.viewHeader=f.from-hidden;
    hidden+=f.to-f.from;
    f.hiddenThrough=hidden;
    lastEnd=f.to;
  }
  const visibleLineCount=document.lineCount-hidden;
  const notes=annotations.map(n=>{
    if(!n||typeof n.id!=='string'||!n.id||
      typeof n.text!=='string'||!natural(n.at)||n.at>document.length)
      throw new RangeError('invalid annotation');
    return {id:n.id,at:n.at,text:n.text};
  }).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  function viewLineToSource(viewLine){
    if(!natural(viewLine)||viewLine>=visibleLineCount)
      throw new RangeError('visible line');
    const before=lowerBound(orderedFolds,viewLine+1,f=>f.viewHeader+1);
    return viewLine+(before?orderedFolds[before-1].hiddenThrough:0);
  }
  function sourceLineToView(logicalLine){
    if(!natural(logicalLine)||logicalLine>=document.lineCount)
      throw new RangeError('logical line');
    const i=lowerBound(orderedFolds,logicalLine+1,f=>f.from)-1;
    if(i>=0&&logicalLine>orderedFolds[i].from&&
      logicalLine<=orderedFolds[i].to)
      return {kind:'folded',viewLine:orderedFolds[i].viewHeader,
        fold:orderedFolds[i]};
    const before=lowerBound(orderedFolds,logicalLine,f=>f.to);
    const removed=before?orderedFolds[before-1].hiddenThrough:0;
    return {kind:'visible',viewLine:logicalLine-removed};
  }
  function foldForHeader(line){
    const i=lowerBound(orderedFolds,line,f=>f.from);
    return orderedFolds[i]?.from===line?orderedFolds[i]:null;
  }
  function foldSourceSpan(f){
    const from=document.lineStart(f.from+1);
    const to=f.to+1<document.lineCount?
      document.lineStart(f.to+1):document.length;
    return {start:from,end:to};
  }
  function visibleRow(viewLine){
    const line=viewLineToSource(viewLine);
    const {start,end,next}=textEnd(document,line);
    const displayEnd=Math.min(end,start+maxLineUnits);
    const value=document.slice(start,displayEnd);
    const truncated=displayEnd<end;
    // A truncated prefix may end inside a Unicode cluster: do not expose
    // editable grapheme boundaries until a complete line is available.
    const boundaries=truncated?null:[
      ...Array.from(graphemes.segment(value),part=>start+part.index),displayEnd
    ];
    const parts=[{kind:'text',source:{start,end:displayEnd},
      value,graphemeBoundaries:boundaries,editable:!truncated}];
    const f=foldForHeader(line);
    if(f){
      const span=foldSourceSpan(f);
      parts.push({kind:'fold',source:span,hiddenLines:f.to-f.from,
        label:'…',hiddenAnnotations:
          lowerBound(notes,span.end,n=>n.at)-
          lowerBound(notes,span.start,n=>n.at)});
    }
    const first=lowerBound(notes,start,n=>n.at);
    const limit=line===document.lineCount-1?document.length+1:next;
    const last=lowerBound(notes,limit,n=>n.at);
    for(let i=first;i<Math.min(last,first+maxAnnotationsPerRow);i++){
      const note=notes[i];
      parts.push({kind:'annotation',id:note.id,
        anchor:note.at,label:note.text});
    }
    return {viewLine,logicalLine:line,source:{start,end,next},
      parts,truncated,omittedAnnotations:Math.max(0,last-first-maxAnnotationsPerRow)};
  }
  function projectWindow({from=0,count=24}={}){
    if(!natural(from)||!natural(count)||count>256||from>visibleLineCount)
      throw new RangeError('projection window');
    const to=Math.min(visibleLineCount,from+count);
    const rows=[];
    let readUnits=0;
    for(let row=from;row<to;row++){
      const item=visibleRow(row);
      readUnits+=item.parts[0].value.length;
      rows.push(item);
    }
    return {from,to,rows,readUnits,visibleLineCount,
      documentLineCount:document.lineCount};
  }
  function viewToSource({viewLine,part='text',grapheme=0}={}){
    const row=visibleRow(viewLine);
    if(part==='fold'){
      const marker=row.parts.find(p=>p.kind==='fold');
      return marker?{kind:'folded-region',source:marker.source}:{
        kind:'unresolved',reason:'no-fold'};
    }
    if(part!=='text'||!natural(grapheme))
      throw new RangeError('view position');
    const text=row.parts[0];
    if(!text.editable)return {kind:'unresolved',reason:'truncated-line'};
    if(grapheme>=text.graphemeBoundaries.length)
      return {kind:'unresolved',reason:'grapheme-outside-line'};
    return {kind:'offset',offset:text.graphemeBoundaries[grapheme]};
  }
  function sourceToView(offset){
    if(!natural(offset)||offset>document.length)
      throw new RangeError('source offset');
    const line=sourceLine(document,offset);
    const placement=sourceLineToView(line);
    if(placement.kind==='folded')
      return {kind:'folded-region',viewLine:placement.viewLine,
        source:foldSourceSpan(placement.fold)};
    return {kind:'visible',viewLine:placement.viewLine,
      logicalLine:line,offset};
  }
  return {visibleLineCount,projectWindow,viewLineToSource,
    sourceLineToView,viewToSource,sourceToView};
}
