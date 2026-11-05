// PoC-only browser input adapter for the canonical Document2D editor.
// Text transfer uses only nominal Document2D selections/read/insert.
// The composer attaches a bounded inverse-operation journal to the concrete
// source's public replace method. No full-document snapshots are retained.
(function()
{
'use strict';

class CanonicalEditorActions
{
  constructor(getView,notify)
  {
    this.getView=getView;
    this.notify=notify;
    this.source=null;
    this.undoStack=[];
    this.redoStack=[];
    this.replaying=false;
    this.limit=100;
    this.byteLimit=2*1024*1024;
  }

  attachSource(source)
  {
    this.source=source;
    this.undoStack=[];
    this.redoStack=[];
    const original=source.replace.bind(source);
    source.replace=(...args)=>
    {
      // A detached document must never contaminate the active history.
      if(this.source!==source || this.replaying) return original(...args);
      const items=args.length===1 && Array.isArray(args[0]) ?
        args[0] : [{start:args[0],end:args[1],text:args[2]}];
      const before=this.getView()?.getSelections()||[];
      const edits=items.map
      (
        item=>
        ({
          start:item.start,end:item.end,text:item.text,
          removed:source.slice(item.start,item.end)
        })
      );
      const sorted=edits.map((edit,index)=>({...edit,index})).sort
      (
        (a,b)=>a.start-b.start ||
          Number(a.start!==a.end)-Number(b.start!==b.end)
      );
      let delta=0;
      const inverse=new Array(edits.length);
      for(const edit of sorted)
      {
        const at=edit.start+delta;
        inverse[edit.index]=
        {
          start:at,end:at+edit.text.length,text:edit.removed
        };
        delta+=edit.text.length-(edit.end-edit.start);
      }
      const result=original(...args); // The source validates/commits atomically.
      const after=this.getView()?.getSelections()||[];
      const forward=edits.map
      (
        ({start,end,text})=>({start,end,text})
      );
      const bytes=edits.reduce
      (
        (n,item)=>n+2*(item.text.length+item.removed.length),0
      );
      if(bytes<=this.byteLimit)
      {
        this.undoStack.push({forward,inverse,before,after,bytes});
        while(this.undoStack.length>this.limit) this.undoStack.shift();
        while(this.undoStack.reduce((n,item)=>n+item.bytes,0)>this.byteLimit)
        {
          this.undoStack.shift();
        }
      }
      else
      {
        this.undoStack=[];
        this.notify('Modifica troppo ampia per la cronologia limitata.');
      }
      this.redoStack=[];
      return result;
    };
  }

  copy(column=false)
  {
    const view=this.getView();
    const selections=view.getSelections();
    if(!selections.some
    (
      ({start,end})=>start.row!==end.row || start.col!==end.col
    ))
    {
      return null;
    }
    const values=view.read();
    return {
      text:values.length===1?values[0]:values.join('\n'),
      column:column && values.length>1,
      rows:values.length
    };
  }

  paste(text,column=false,repeat=true)
  {
    if(typeof text!=='string') throw new TypeError('clipboard text required');
    const view=this.getView();
    const count=view.getSelections().length;
    if(column && count>1)
    {
      const lines=text.split(/\r\n|\n|\r/u);
      if(lines.length===1 && repeat)
      {
        view.insert(Array(count).fill(lines[0]));
      }
      else if(lines.length===count)
      {
        view.insert(lines);
      }
      else
      {
        throw new RangeError
        (
          'Il numero di righe incollate deve coincidere con quello della selezione.'
        );
      }
    }
    else
    {
      view.insert(text);
    }
  }

  undo()
  {
    const item=this.undoStack[this.undoStack.length-1];
    if(!item) return false;
    this.replaying=true;
    try
    {
      this.source.replace(item.inverse);
      this.getView().setSelections(item.before);
    }
    finally
    {
      this.replaying=false;
    }
    this.undoStack.pop();
    this.redoStack.push(item);
    return true;
  }

  redo()
  {
    const item=this.redoStack[this.redoStack.length-1];
    if(!item) return false;
    this.replaying=true;
    try
    {
      this.source.replace(item.forward);
      this.getView().setSelections(item.after);
    }
    finally
    {
      this.replaying=false;
    }
    this.redoStack.pop();
    this.undoStack.push(item);
    return true;
  }

  get state()
  {
    return {undo:this.undoStack.length,redo:this.redoStack.length};
  }
}

globalThis.CanonicalEditorActions=CanonicalEditorActions;
})();
