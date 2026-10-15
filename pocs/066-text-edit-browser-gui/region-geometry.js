/* PoC 066 only: DOM-independent projection and resolution of 2D regions.
 * This fixture-bound experiment is not a TextEdit API or another selection owner.
 */
(function(root)
{
  'use strict';

  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});

  function region(data,columns)
  {
    const {id,row,col,width,height=1}=data;
    if(!Number.isSafeInteger(row)||!Number.isSafeInteger(col)||
       !Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
       row<0||col<0||width<1||height<1||col+width>columns)
      throw new RangeError('invalid experimental region geometry: '+id);
    return {...data,height};
  }

  function clippedRectangle(a,b)
  {
    const left=Math.min(a.col,b.col);
    const right=Math.max(a.col,b.col);
    const top=Math.min(a.row,b.row);
    const bottom=Math.max(a.row,b.row);
    return {row:top,col:left,width:right-left+1,height:bottom-top+1};
  }

  function overlaps(a,b)
  {
    return a.col<b.col+b.width&&b.col<a.col+a.width&&
      a.row<b.row+b.height&&b.row<a.row+a.height;
  }

  function covers(a,b)
  {
    return a.col<=b.col&&a.row<=b.row&&
      a.col+a.width>=b.col+b.width&&
      a.row+a.height>=b.row+b.height;
  }

  function selectRegions(regions,requested)
  {
    return regions.filter(item=>
      item.policy!=='none'&&
      (item.policy==='full'?covers(requested,item):overlaps(item,requested)));
  }

  function buildRegions(document,representation,{columns,policies})
  {
    // The fold marker and annotation layout are PoC fixture choices, not
    // generalized projection conventions or proposed product interfaces.
    const replacement=representation.replacements.find(item=>
      item.text==='[3 folded rows]');
    const foldStart=replacement?document.lineAt(replacement.start):-1;
    const foldEnd=replacement?document.lineAt(replacement.end):-1;
    const visualRows=[];
    for(let row=0;row<document.lineCount;row++)
    {
      if(row===foldStart)
      {
        visualRows.push({kind:'fold',sourceRow:row,replacement});
        row=foldEnd-1;
      }
      else visualRows.push({kind:'text',sourceRow:row});
    }

    const regions=[];
    for(let vrow=0;vrow<visualRows.length;vrow++)
    {
      const visible=visualRows[vrow];
      if(visible.kind==='fold')
      {
        regions.push(region({
          id:'fold',kind:'fold',row:vrow,col:0,width:6,
          source:{start:visible.replacement.start,end:visible.replacement.end},
          label:'[3 righe]',policy:policies.fold
        },columns));
        continue;
      }

      const row=visible.sourceRow;
      const info=document.lineInfo(row);
      const text=document.slice(info.start,info.end);
      for(const item of segmenter.segment(text))
      {
        const from=info.start+item.index;
        const to=from+item.segment.length;
        const a=representation.sourceToColumn(from);
        const b=representation.sourceToColumn(to);
        if(a.kind!=='column'||b.kind!=='column')
          throw new Error('source and display grapheme geometry disagrees');
        if(a.col>=columns)break;
        const width=b.col-a.col;
        const isTab=item.segment==='\t';
        const label=isTab?'⇥'+'·'.repeat(Math.max(0,width-1)):
          /^[\x20-\x7e]$/.test(item.segment)?item.segment:'◇';
        regions.push(region({
          id:'source:'+row+':'+item.index,kind:isTab?'tab':'text',
          row:vrow,col:a.col,width:Math.min(width,columns-a.col),
          source:{start:from,end:to},label,
          policy:isTab?policies.tab:'touch'
        },columns));
      }
    }

    const note=representation.annotations.find(a=>a.id==='info');
    if(note)
    {
      const anchorRow=document.lineAt(note.at);
      const at=visualRows.findIndex(x=>x.sourceRow===anchorRow);
      if(at>=0)
      {
        regions.push(region({
          id:'annotation',kind:'annotation',row:at,col:12,
          width:4,height:Math.min(2,visualRows.length-at),
          source:null,label:'ℹ nota',policy:policies.annotation
        },columns));
      }
    }
    return {regions,visualRows};
  }

  function physicalSelections(document,effective,direction)
  {
    // Distinct highlighted regions may map to the same source interval.
    // The current PoC coalesces touching source intervals; this is NOT
    // an adopted policy for arbitrary overlapping regions.
    const intervals=effective.filter(x=>x.source!==null)
      .map(x=>({...x.source})).sort((a,b)=>a.start-b.start||a.end-b.end);
    const merged=[];
    for(const part of intervals)
    {
      const last=merged[merged.length-1];
      if(last&&part.start<=last.end)
        last.end=Math.max(last.end,part.end);
      else merged.push({...part});
    }

    if(!direction.vertical)merged.reverse();
    return merged.map(part=>
    {
      const startRow=document.lineAt(part.start);
      const endRow=document.lineAt(part.end);
      return {
        start:{row:startRow,col:part.start-document.lineStart(startRow)},
        end:{row:endRow,col:part.end-document.lineStart(endRow)},
        forward:direction.horizontal
      };
    });
  }

  const model=Object.freeze({
    buildRegions,clippedRectangle,selectRegions,physicalSelections
  });
  if(typeof module!=='undefined'&&module.exports)
    module.exports=model;
  else
    root.__regionGeometryPoC=model;
})(globalThis);
