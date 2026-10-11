// PoC 063: explicit, post-edit rebasing of source-referenced presentation
// metadata. No listeners, history, DOM, text ownership or automatic hooks.
// Caller captures anchors BEFORE a successful TextEditSelections.replace,
// then supplies its documented 'changes' result and the modified document.
// This is a conservative experiment, NOT a product API.
const natural=n=>Number.isSafeInteger(n)&&n>=0;
const lfCount=s=>s.split('\n').length-1;

export function captureProjectionMetadata(document,{folds=[],annotations=[]}={}){
  if(!document||!natural(document.length)||!natural(document.lineCount)||
    document.lineCount<1||typeof document.lineStart!=='function')
    throw new TypeError('indexed text document required');
  if(!Array.isArray(folds)||!Array.isArray(annotations))
    throw new TypeError('folds and annotations must be arrays');
  const capturedFolds=folds.map(f=>{
    if(!f||!natural(f.from)||!natural(f.to)||f.from>=f.to||
      f.to>=document.lineCount)
      throw new RangeError('invalid fold lines');
    return {from:f.from,to:f.to,start:document.lineStart(f.from),
      end:f.to+1<document.lineCount?
        document.lineStart(f.to+1):document.length,
      endsAtEOF:f.to===document.lineCount-1};
  }).sort((a,b)=>a.from-b.from);
  for(let i=1;i<capturedFolds.length;i++)
    if(capturedFolds[i].from<=capturedFolds[i-1].to)
      throw new RangeError('overlapping/nested folds');
  const capturedAnnotations=annotations.map(note=>{
    if(!note||typeof note.id!=='string'||!note.id||
      typeof note.text!=='string'||!natural(note.at)||
      note.at>document.length||
      (note.affinity!==undefined&&
       note.affinity!=='before'&&note.affinity!=='after'))
      throw new RangeError('invalid annotation anchor/affinity');
    return {id:note.id,at:note.at,text:note.text,
      ...(note.affinity?{affinity:note.affinity}:{})};
  });
  return {sourceLength:document.length,sourceLines:document.lineCount,
    folds:capturedFolds,annotations:capturedAnnotations};
}
function validateChanges(capture,document,changes){
  if(!capture||!natural(capture.sourceLength)||
    !natural(capture.sourceLines)||!Array.isArray(capture.folds)||
    !Array.isArray(capture.annotations)||
    !document||!natural(document.length)||!natural(document.lineCount)||
    typeof document.lineStart!=='function'||!Array.isArray(changes))
    throw new TypeError('capture, updated document and edit results required');
  const sorted=changes.map(change=>{
    if(!change||!natural(change.start)||!natural(change.end)||
      change.end<change.start||change.end>capture.sourceLength||
      typeof change.removed!=='string'||
      typeof change.inserted!=='string'||
      change.removed.length!==change.end-change.start)
      throw new RangeError('invalid text change record');
    return {start:change.start,end:change.end,
      removed:change.removed,inserted:change.inserted};
  }).sort((a,b)=>a.start-b.start||a.end-b.end);
  let delta=0,lineDelta=0,end=-1;
  for(const change of sorted){
    if(change.start<=end)
      throw new RangeError('overlapping/duplicate text changes');
    end=change.end;
    delta+=change.inserted.length-change.removed.length;
    lineDelta+=lfCount(change.inserted)-lfCount(change.removed);
  }
  if(!Number.isSafeInteger(capture.sourceLength+delta)||
    document.length!==capture.sourceLength+delta||
    document.lineCount!==capture.sourceLines+lineDelta)
    throw new Error('text revision does not match supplied edits');
  return sorted;
}
// Maps a source UTF-16 anchor through an entire confirmed batch.
// 'before' and 'after' affinities only disambiguate a pure insertion AT
// the anchor. An anchor inside removed/replaced text is always unresolved.
function mapAnchor(point,affinity,edits){
  let delta=0;
  for(const change of edits){
    if(point<change.start)break;
    if(change.start===change.end&&point===change.start){
      if(!affinity)return {kind:'unresolved',reason:'insertion-affinity-required'};
      return {kind:'offset',offset:point+delta+
        (affinity==='after'?change.inserted.length:0)};
    }
    if(point>=change.start&&point<change.end)
      return {kind:'unresolved',reason:'source-anchor-replaced'};
    delta+=change.inserted.length-(change.end-change.start);
  }
  return {kind:'offset',offset:point+delta};
}
function overlapsFold(fold,change){
  if(change.start===change.end)
    return change.start>=fold.start &&
      (change.start<fold.end||
        (fold.endsAtEOF&&change.start===fold.end));
  return change.start<fold.end&&change.end>fold.start;
}
export function rebaseProjectionMetadata(capture,document,changes){
  const edits=validateChanges(capture,document,changes);
  const folds=[],annotations=[],unresolved=[];
  for(const previous of capture.folds){
    if(edits.some(change=>overlapsFold(previous,change))){
      unresolved.push({kind:'fold',from:previous.from,to:previous.to,
        reason:'fold-content-modified'});
      continue;
    }
    let rowDelta=0;
    for(const change of edits){
      if(change.end<=previous.start){
        rowDelta+=lfCount(change.inserted)-lfCount(change.removed);
      }else break;
    }
    const from=previous.from+rowDelta,to=previous.to+rowDelta;
    const start=mapAnchor(previous.start,'after',edits);
    const end=mapAnchor(previous.end,'before',edits);
    const candidateEnd=to+1<document.lineCount?
      document.lineStart(to+1):document.length;
    if(!natural(from)||!natural(to)||to>=document.lineCount||
      start.kind!=='offset'||end.kind!=='offset'||
      document.lineStart(from)!==start.offset||
      candidateEnd!==end.offset){
      unresolved.push({kind:'fold',from:previous.from,to:previous.to,
        reason:'fold-boundary-not-preserved'});
      continue;
    }
    folds.push({from,to});
  }
  for(const previous of capture.annotations){
    const mapping=mapAnchor(previous.at,previous.affinity,edits);
    if(mapping.kind!=='offset'||!natural(mapping.offset)||
      mapping.offset>document.length){
      unresolved.push({kind:'annotation',id:previous.id,
        reason:mapping.reason??'invalid-mapped-anchor'});
      continue;
    }
    annotations.push({id:previous.id,at:mapping.offset,text:previous.text,
      ...(previous.affinity?{affinity:previous.affinity}:{})});
  }
  return {folds,annotations,unresolved};
}
