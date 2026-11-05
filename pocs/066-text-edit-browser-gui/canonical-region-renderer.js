// PoC-only bounded DOM projection of the outermost nominal Document2D.
// No physical Document, concrete Raw/Cell identity or Unicode splitter here.
(function()
{
'use strict';

class CanonicalRegionRenderer
{
  constructor(element,visibleRows,visibleCols)
  {
    this.element=element;
    this.visibleRows=visibleRows;
    this.visibleCols=visibleCols;
    this.cellPixels=20;
    this.metrics=globalThis.document.createElement('canvas').getContext('2d');
  }

  render(document2D,rowStart,colStart)
  {
    const element=this.element;
    const revision=document2D.revision;
    const rowEnd=Math.min(rowStart+this.visibleRows,document2D.rowCount);
    const colEnd=colStart+this.visibleCols;
    const visible=document2D.getRegions
    (
      rowStart,colStart,rowEnd,colEnd
    );
    const selections=document2D.getSelections();
    const fragment=globalThis.document.createDocumentFragment();
    const measurements=[];
    const style=getComputedStyle(element);
    this.metrics.font='18px '+(style.fontFamily||'monospace');
  
    for(let row=rowStart;row<rowEnd;row++)
    {
      const line=globalThis.document.createElement('div');
      line.className='row';
      line.dataset.row=String(row);
      const content=globalThis.document.createElement('div');
      content.className='content';
      content.dataset.row=String(row);
      const units=[];
      const notes=[];
  
      for(const region of visible[row-rowStart]||[])
      {
        if(region.kind==='annotation')
        {
          notes.push(region);
          continue;
        }
  
        // A displayed TAB symbol is a GUI glyph choice; logical width
        // comes only from region.end.col-region.start.col.
        const glyph=region.kind==='tab'?'⇥':region.text;
        const width=Math.ceil(Math.max
        (
          this.cellPixels*(region.end.col-region.start.col),
          this.metrics.measureText(glyph).width+12
        ));
        const span=globalThis.document.createElement('span');
        span.className='unit';
        span.dataset.kind=region.kind;
        span.dataset.row=String(row);
        span.dataset.start=String(region.start.col);
        span.dataset.end=String(region.end.col);
        span.style.width=width+'px';
        span.textContent=glyph;
        content.appendChild(span);
        units.push({span,start:region.start.col,end:region.end.col});
      }
  
      line.appendChild(content);
      fragment.appendChild(line);
      measurements.push({row,content,units,notes});
    }
  
    element.replaceChildren(fragment);
    for(const {row,content,units,notes} of measurements)
    {
      const positions=new Map([[colStart,0]]);
      let left=0;
  
      for(const unit of units)
      {
        if(unit.span.scrollWidth>unit.span.clientWidth)
        {
          unit.span.style.width=(unit.span.scrollWidth+12)+'px';
        }
        positions.set(unit.start,left);
        left+=unit.span.getBoundingClientRect().width;
        positions.set(unit.end,left);
      }
  
      for(const region of notes)
      {
        const x=positions.get(region.start.col);
        if(x===undefined) continue;
        const note=globalThis.document.createElement('span');
        note.className='annotation';
        note.dataset.id=region.id;
        note.dataset.row=String(row);
        note.dataset.col=String(region.start.col);
        note.title=region.text;
        note.textContent='●';
        note.style.left=x+'px';
        content.appendChild(note);
      }
  
      // Draw the clipped visible intersection of each linear or column
      // selection. Exact public region boundaries remain the only pixel
      // boundary authority; a synthetic/Unicode/TAB unit is never split.
      for(const selection of selections)
      {
        if(row<selection.start.row || row>selection.end.row) continue;
        const fromCol=row===selection.start.row?selection.start.col:0;
        const toCol=row===selection.end.row?
          selection.end.col:document2D.getRowWidth(row);
        if(toCol<=fromCol) continue;

        const boundaries=Array.from(positions.keys()).sort((a,b)=>a-b);
        if(!boundaries.length) continue;
        const low=boundaries[0];
        const high=boundaries[boundaries.length-1];
        if(toCol<=low || fromCol>=high) continue;
        const leftBoundary=boundaries.find(x=>x>=Math.max(low,fromCol));
        const rightBoundary=boundaries.findLast(x=>x<=Math.min(high,toCol));
        if(leftBoundary===undefined || rightBoundary===undefined ||
          rightBoundary<=leftBoundary) continue;
        const from=positions.get(leftBoundary);
        const to=positions.get(rightBoundary);
        if(to<=from) continue;

        const mark=globalThis.document.createElement('span');
        mark.className='selection-mark';
        mark.dataset.row=String(row);
        mark.dataset.start=String(leftBoundary);
        mark.dataset.end=String(rightBoundary);
        mark.style.left=from+'px';
        mark.style.width=(to-from)+'px';
        content.appendChild(mark);
      }

      for(const selection of selections)
      {
        const point=selection.forward?selection.end:selection.start;
        if(point.row!==row || !positions.has(point.col)) continue;
        const caret=globalThis.document.createElement('span');
        caret.className='caret';
        caret.dataset.row=String(row);
        caret.dataset.col=String(point.col);
        caret.style.left=positions.get(point.col)+'px';
        content.appendChild(caret);
      }
    }
    if(revision!==document2D.revision)
    {
      // The consumer schedules a fresh paint from the current view.
      return null;
    }
    return {revision,visible,rowStart,rowEnd,colStart,colEnd};
  }
  
}

globalThis.CanonicalRegionRenderer=CanonicalRegionRenderer;
})();
