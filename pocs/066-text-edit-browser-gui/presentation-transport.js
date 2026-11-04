// Experimental wire-format codec for PoC 066, NOT a public Document2D API.
// Producer packs already-exposed whole text units. Consumer only decodes
// explicit column/text offsets: it never segments Unicode or infers ownership.
(function()
{
'use strict';

function packRows(rows)
{
  return rows.map(regions=>
  {
    const result=[];
    let run=null;
    function flush()
    {
      if(!run) return;
      // Only batches of two or more justify an additional boundary payload.
      if(run.cells.length===1)
      {
        const one=run.original;
        result.push(one);
      }
      else
      {
        delete run.original;
        if(run.glyphs.length===0) delete run.glyphs;
        result.push(run);
      }
      run=null;
    }

    for(const region of regions)
    {
      if(region.kind!=='text' || region.end.row!==region.start.row)
      {
        flush();
        result.push(region);
        continue;
      }
      if(run && (run.end.row!==region.start.row ||
        run.end.col!==region.start.col))
      {
        flush();
      }
      if(!run)
      {
        run={
          kind:'text',text:'',
          start:{...region.start},end:{...region.end},
          cells:[],glyphs:[],original:region
        };
      }
      const index=run.cells.length;
      const endText=run.text.length+region.text.length;
      run.text+=region.text;
      run.end={...region.end};
      // Relative end-column and end-UTF16-index of every *whole* visual unit.
      run.cells.push([region.end.col-run.start.col,endText]);
      if(region.displayText!==undefined &&
        region.displayText!==region.text)
      {
        run.glyphs.push([index,region.displayText]);
      }
    }
    flush();
    return result;
  });
}

function unpackRows(rows)
{
  return rows.map(regions=>regions.flatMap(region=>
  {
    if(region.kind!=='text' || !Array.isArray(region.cells))
    {
      return [region];
    }
    const result=[];
    const glyphs=new Map(region.glyphs||[]);
    let col=0;
    let textIndex=0;

    for(let index=0;index<region.cells.length;index++)
    {
      const [endCol,endText]=region.cells[index];
      if(!Number.isSafeInteger(endCol) ||
        !Number.isSafeInteger(endText) ||
        endCol<=col || endText<=textIndex ||
        endCol>region.end.col-region.start.col ||
        endText>region.text.length)
      {
        throw new RangeError('invalid compact Document2D unit boundary');
      }
      const text=region.text.slice(textIndex,endText);
      const unit={
        kind:'text',text,
        start:{row:region.start.row,col:region.start.col+col},
        end:{row:region.start.row,col:region.start.col+endCol}
      };
      if(glyphs.has(index)) unit.displayText=glyphs.get(index);
      result.push(unit);
      col=endCol;
      textIndex=endText;
    }
    if(col!==region.end.col-region.start.col ||
      textIndex!==region.text.length)
    {
      throw new RangeError('compact Document2D region extent mismatch');
    }
    return result;
  }));
}

globalThis.__presentationTransport=Object.freeze({packRows,unpackRows});
})();