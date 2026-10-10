// PoC 063: external column editing planner, not a TextEditBase/Selections API.
// Reuse visual-column-probe for geometric targets and let TextEditSelections
// perform one ordinary replace per resolved selection. No clipboard policy
// lives in either lower level. One rectangle per call is deliberate here.
import {probeRectangles} from './visual-column-probe.mjs';

function natural(n) {return Number.isSafeInteger(n) && n>=0;}
function decodedRows(clipboard) {
  if(typeof clipboard==='string') {
    if(!clipboard.length)return [];
    return clipboard.split(/\r\n|\r|\n/);
  }
  if(!clipboard || typeof clipboard!=='object')throw new TypeError('clipboard');
  if(clipboard.kind==='rows') {
    if(!Array.isArray(clipboard.rows)||!clipboard.rows.every(x=>typeof x==='string'))
      throw new TypeError('clipboard.rows');
    return clipboard.rows.slice();
  }
  if(clipboard.kind==='madedit-column') {
    if(typeof clipboard.text!=='string'||!natural(clipboard.rowCount))
      throw new TypeError('native column clipboard');
    const segments=clipboard.text.split(/\r\n|\r|\n/);
    if(segments.length<clipboard.rowCount ||
      segments.slice(clipboard.rowCount).some(segment=>segment!==''))
      throw new RangeError('native column row count and data disagree');
    return segments.slice(0,clipboard.rowCount);
  }
  throw new TypeError('unsupported clipboard kind');
}

// An overflow is staged as ordinary non-overlapping selections. New physical
// rows are represented by one EOF replacement; TextEditBase remains one-range.
// This is an opt-in candidate, not a general clipboard or selection API.
function inferredLineEnding(document) {
  const start=document.lineStart(document.lineCount-1);
  return start>=2 && document.slice(start-2,start)==='\r\n'?'\r\n':'\n';
}

export function planColumnPaste(document,{
  rectangle,clipboard,autofill=false,tabSize=4,widthOf,
  materializeRows=false,lineEnding
}={}) {
  if(!rectangle||![rectangle.lineFrom,rectangle.lineTo,
    rectangle.columnFrom,rectangle.columnTo].every(natural))
    throw new RangeError('rectangle coordinates');
  if(!document || !natural(document.lineCount) ||
    typeof document.lineStart!=='function'||typeof document.slice!=='function' ||
    !natural(document.length))
    throw new TypeError('column geometry document');
  if(rectangle.lineFrom>=document.lineCount||rectangle.lineTo>=document.lineCount)
    throw new RangeError('selection row outside document');
  if(typeof autofill!=='boolean'||typeof materializeRows!=='boolean')
    throw new TypeError('column paste options');
  if(lineEnding!==undefined && lineEnding!=='\n' && lineEnding!=='\r\n')
    throw new RangeError('lineEnding must be LF or CRLF');
  const source=decodedRows(clipboard);
  if(!source.length)return {noop:true,selections:[],texts:[],sourceRows:0,targetRows:0};
  const selectedCount=Math.abs(rectangle.lineTo-rectangle.lineFrom)+1;
  const targetCount=source.length<selectedCount ?
    (autofill?selectedCount:source.length) : source.length;
  const direction=rectangle.lineTo>=rectangle.lineFrom?1:-1;
  const last=rectangle.lineFrom+direction*(targetCount-1);
  const needsRows=last<0||last>=document.lineCount;
  if(needsRows && !materializeRows)
    throw new RangeError('column paste needs external document row materialization');
  // Upward extension would prepend rows and rebase the user's existing
  // offsets. Backward-column payloads need the caller's per-row direction
  // policy, not reversal of a concatenated multi-line tail. Reject until
  // those separate higher-level policies have been experimentally verified.
  if(needsRows && direction<0)
    throw new RangeError('upward row materialization not implemented');
  if(needsRows && rectangle.columnFrom>rectangle.columnTo)
    throw new RangeError('backward column materialization needs per-row policy');
  const existingCount=needsRows?document.lineCount-rectangle.lineFrom:targetCount;
  const existingLast=rectangle.lineFrom+direction*(existingCount-1);
  const geometry=probeRectangles(document,[{
    lineFrom:rectangle.lineFrom,lineTo:existingLast,
    columnFrom:rectangle.columnFrom,columnTo:rectangle.columnTo
  }],{tabSize,widthOf});
  if(geometry.unresolved.length)
    throw new RangeError('column target falls inside a grapheme or tab');
  if(geometry.collisions.length)
    throw new RangeError('column targets collide');
  const ordered=geometry.targets.sort((a,b)=>direction*(a.line-b.line));
  const selections=ordered.map(target=>({
    start:target.start,end:target.end,
    forward:rectangle.columnFrom<=rectangle.columnTo
  }));
  const texts=ordered.map((target,i)=>
    ' '.repeat(target.virtualSpaces)+source[i%source.length]);
  const materializedRows=targetCount-existingCount;
  if(materializedRows){
    const ending=lineEnding??inferredLineEnding(document);
    // Only the additional rows are synthesized. The existing tail is
    // neither read nor copied, even if the last line is huge.
    const column=Math.min(rectangle.columnFrom,rectangle.columnTo);
    const prefix=' '.repeat(column);
    let suffix='';
    for(let i=existingCount;i<targetCount;i++)
      suffix+=ending+prefix+source[i%source.length];
    const lastSelection=selections.at(-1);
    if(lastSelection.end===document.length){
      // At an EOF caret an additional selection would be a duplicate.
      // Fuse the row insertion and its synthesized continuation into one
      // regular replacement, preserving one primitive per planned target.
      texts[texts.length-1]+=suffix;
    }else{
      selections.push({start:document.length,end:document.length,forward:true});
      texts.push(suffix);
    }
  }
  return {noop:false,selections,texts,sourceRows:source.length,
    targetRows:targetCount,materializedRows,
    autofilled:autofill&&selectedCount>source.length,
    extended:targetCount>selectedCount,
    sourceKind:typeof clipboard==='string'?'plain':clipboard.kind};
}
