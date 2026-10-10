// PoC 063 only: ASCII fast-path column lookup for very long selected lines.
// This is an alternative to probeLine()/locateColumn(), not a product API.
// If an uncertain non-ASCII grapheme is encountered before resolving requested
// columns, delegate to the existing full Intl.Segmenter geometry semantics.
import {probeLine,locateColumn} from './visual-column-probe.mjs';
const natural=n=>Number.isSafeInteger(n)&&n>=0;

export function locateColumnsAsciiCandidate(document,row,columns,{
  tabSize=4,widthOf,chunkUnits=4096
}={}){
  if(!document||!natural(document.lineCount)||!natural(document.length)||
     !natural(row)||row>=document.lineCount||
     typeof document.slice!=='function'||typeof document.lineStart!=='function')
    throw new RangeError('document/row');
  if(!Array.isArray(columns)||columns.some(x=>!natural(x)))
    throw new RangeError('columns');
  if(!natural(tabSize)||tabSize<1||typeof widthOf!=='function'||
     !natural(chunkUnits)||chunkUnits<1)
    throw new RangeError('geometry options');

  const options={tabSize,widthOf};
  const start=document.lineStart(row);
  const next=row+1<document.lineCount?document.lineStart(row+1):document.length;
  let textEnd=next;
  if(textEnd>start && document.slice(textEnd-1,textEnd)==='\n')textEnd--;
  if(textEnd>start && next>textEnd && document.slice(textEnd-1,textEnd)==='\r')
    textEnd--;

  const needed=Array.from(new Set(columns)).sort((a,b)=>a-b);
  const resolved=new Map();
  let at=start,col=0,index=0,visited=0;
  if(!needed.length)return {matches:[],visited,readUnits:0,fallback:false};
  let readUnits=0;

  const ensureBoundary=()=>{
    while(index<needed.length && needed[index]===col)
      resolved.set(needed[index++],{kind:'exact',offset:at,virtualSpaces:0});
  };
  while(at<textEnd && index<needed.length){
    const end=Math.min(textEnd,at+chunkUnits);
    const part=document.slice(at,end);readUnits+=end-at;
    for(let i=0;i<part.length&&index<needed.length;i++){
      const code=part.charCodeAt(i);
      if(code>127){
        const g=probeLine(document,row,options);
        return {matches:columns.map(c=>locateColumn(g,c)),visited,readUnits,
          fallback:true,reason:'non-ASCII encountered before targets were resolved'};
      }
      // Confirm a boundary only after seeing an ASCII successor: a subsequent
      // combining Unicode codepoint could join the previous ASCII grapheme.
      ensureBoundary();
      const segment=part[i];
      const width=code===9?tabSize-col%tabSize:widthOf(segment,col,row);
      if(!natural(width)||width<1)throw new RangeError('invalid grapheme width');
      const right=col+width;
      if(!Number.isSafeInteger(right))throw new RangeError('column overflow');
      while(index<needed.length && needed[index]<right){
        const target=needed[index++];
        resolved.set(target,{kind:'inside-grapheme',
          cell:{text:segment,start:at,end:at+1,columnStart:col,columnEnd:right},
          before:at,after:at+1});
      }
      visited++;col=right;at++;
    }
  }
  // At EOF there is no unexamined Unicode that could extend the final cell.
  if(at===textEnd){
    ensureBoundary();
    for(;index<needed.length;index++){
      const target=needed[index];
      resolved.set(target,{kind:'virtual',offset:textEnd,virtualSpaces:target-col});
    }
  }
  return {matches:columns.map(c=>resolved.get(c)),visited,readUnits,
    fallback:false};
}
