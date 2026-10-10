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

export function planColumnPaste(document,{
  rectangle,clipboard,autofill=false,tabSize=4,widthOf
}={}) {
  if(!rectangle||![rectangle.lineFrom,rectangle.lineTo,
    rectangle.columnFrom,rectangle.columnTo].every(natural))
    throw new RangeError('rectangle coordinates');
  if(!document || !natural(document.lineCount) ||
    typeof document.lineStart!=='function'||typeof document.slice!=='function')
    throw new TypeError('column geometry document');
  if(rectangle.lineFrom>=document.lineCount||rectangle.lineTo>=document.lineCount)
    throw new RangeError('selection row outside document');
  if(typeof autofill!=='boolean')throw new TypeError('autofill');
  const source=decodedRows(clipboard);
  if(!source.length)return {noop:true,selections:[],texts:[],sourceRows:0,targetRows:0};
  const selectedCount=Math.abs(rectangle.lineTo-rectangle.lineFrom)+1;
  const targetCount=source.length<selectedCount ?
    (autofill?selectedCount:source.length) : source.length;
  // Selection drag orientation defines the row traversal. The higher-level
  // planner may extend into *existing* rows. Materializing nonexisting rows
  // is a separate policy; refusing here prevents silent source truncation.
  const direction=rectangle.lineTo>=rectangle.lineFrom?1:-1;
  const last=rectangle.lineFrom+direction*(targetCount-1);
  if(last<0||last>=document.lineCount)
    throw new RangeError('column paste needs external document row materialization');
  const geometry=probeRectangles(document,[{
    lineFrom:rectangle.lineFrom,lineTo:last,
    columnFrom:rectangle.columnFrom,columnTo:rectangle.columnTo
  }],{tabSize,widthOf});
  if(geometry.unresolved.length)
    throw new RangeError('column target falls inside a grapheme or tab');
  if(geometry.collisions.length)
    throw new RangeError('column targets collide');
  // probeRectangles sorts by text offsets for model efficiency; source rows
  // instead follow the user's original row traversal and orientation.
  const ordered=geometry.targets.sort((a,b)=>direction*(a.line-b.line));
  const selections=ordered.map(target=>({
    start:target.start,end:target.end,
    forward:rectangle.columnFrom<=rectangle.columnTo
  }));
  const texts=ordered.map((target,i)=>
    ' '.repeat(target.virtualSpaces)+source[i%source.length]);
  return {noop:false,selections,texts,sourceRows:source.length,
    targetRows:ordered.length,autofilled:autofill&&selectedCount>source.length,
    extended:ordered.length>selectedCount,
    sourceKind:typeof clipboard==='string'?'plain':clipboard.kind};
}
