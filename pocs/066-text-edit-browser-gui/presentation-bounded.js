// PoC-only generic incremental packer over real Document2D.getRegions.
// No full-window expanded region snapshot is retained. Chunks may still
// allocate temporary public region objects and cause repeated upstream scans.
(function()
{
'use strict';

function identical(a,b)
{
  return a && b && a.kind===b.kind &&
    a.text===b.text && a.id===b.id &&
    a.start.row===b.start.row && a.start.col===b.start.col &&
    a.end.row===b.end.row && a.end.col===b.end.col &&
    a.displayText===b.displayText;
}

function packWindow(input,rowStart,colStart,rowEnd,colEnd,chunkWidth=64)
{
  if(![rowStart,colStart,rowEnd,colEnd,chunkWidth].every(
      value=>Number.isSafeInteger(value) && value>=0
    ) || rowEnd<rowStart || colEnd<colStart || chunkWidth<1)
  {
    throw new RangeError('invalid incremental Document2D window');
  }

  const result=[];
  const endRow=Math.min(rowEnd,input.rowCount);

  for(let row=rowStart;row<endRow;row++)
  {
    const packed=[];
    let run=null;
    let crossing=null;

    function flush()
    {
      if(!run) return;

      if(run.cells.length===1)
      {
        packed.push(run.first);
      }
      else
      {
        delete run.first;

        if(!run.glyphs.length) delete run.glyphs;
        packed.push(run);
      }
      run=null;
    }

    function append(part)
    {
      if(part.kind!=='text' || part.end.row!==part.start.row)
      {
        flush();
        packed.push(part);
        return;
      }

      if(run && (run.end.row!==part.start.row ||
        run.end.col!==part.start.col))
      {
        flush();
      }

      if(!run)
      {
        run={
          kind:'text',text:'',
          start:{...part.start},end:{...part.end},
          cells:[],glyphs:[],first:part
        };
      }

      const index=run.cells.length;
      run.text+=part.text;
      run.end={...part.end};
      run.cells.push([
        part.end.col-run.start.col,run.text.length
      ]);
      if(part.displayText!==undefined &&
        part.displayText!==part.text)
      {
        run.glyphs.push([index,part.displayText]);
      }
    }

    for(let left=colStart;left<colEnd;)
    {
      const right=Math.min(colEnd,left+chunkWidth);
      const regions=input.getRegions(row,left,row+1,right)[0];
      let nextCrossing=null;

      for(const part of regions)
      {
        if(part.end.col>right && part.end.col>part.start.col)
        {
          nextCrossing=part;
        }

        // Whole indivisible regions intersecting consecutive windows
        // appear repeatedly. Preserve the first complete occurrence.
        if(left>colStart && part.start.col<left &&
          part.end.col>part.start.col)
        {
          if(!identical(part,crossing))
          {
            throw new Error('nonstable Document2D region across chunks');
          }
          continue;
        }

        append(part);
      }

      crossing=nextCrossing;
      left=right;
    }

    flush();
    result.push(packed);
  }

  return result;
}

globalThis.__presentationBounded=Object.freeze({packWindow});
})();
