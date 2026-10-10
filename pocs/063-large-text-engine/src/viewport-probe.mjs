// Experimental viewport projection for PoC 063. DOM-independent and read-only.
// Positions are UTF-16. This never builds a full document string, never owns
// selections, and never makes edit/clipboard/history decisions.
const natural=n=>Number.isSafeInteger(n)&&n>=0;
export function projectViewport(document,{
  scrollTop=0,height=440,rowHeight=24,overscan=4,maxLineUnits=512
}={}){
  if(!document||!natural(document.length)||!natural(document.lineCount)||
     document.lineCount<1||typeof document.lineStart!=='function'||
     typeof document.slice!=='function')
    throw new TypeError('invalid indexed document');
  if(!Number.isFinite(scrollTop)||scrollTop<0||
     !Number.isFinite(height)||height<=0||
     !Number.isFinite(rowHeight)||rowHeight<=0||
     !natural(overscan)||!natural(maxLineUnits)||maxLineUnits<1)
    throw new RangeError('invalid viewport options');
  const first=Math.max(0,Math.floor(scrollTop/rowHeight)-overscan);
  const last=Math.min(document.lineCount,
    Math.ceil((scrollTop+height)/rowHeight)+overscan);
  const rows=[];
  let readUnits=0;
  // The maximum rendered text per line is explicit. A clipped giant row is
  // display-only: the UI must NOT permit pointer edits in its clipped tail.
  for(let row=first;row<last;row++){
    const start=document.lineStart(row);
    const next=row+1<document.lineCount?
      document.lineStart(row+1):document.length;
    let textEnd=next;
    if(textEnd>start&&document.slice(textEnd-1,textEnd)==='\n')textEnd--;
    if(textEnd>start&&next>textEnd&&document.slice(textEnd-1,textEnd)==='\r')
      textEnd--;
    const displayedEnd=Math.min(textEnd,start+maxLineUnits);
    const content=document.slice(start,displayedEnd);
    readUnits+=content.length;
    rows.push({row,start,textEnd,displayedEnd,content,
      truncated:displayedEnd<textEnd});
  }
  return {first,last,rows,readUnits,documentRows:document.lineCount};
}
