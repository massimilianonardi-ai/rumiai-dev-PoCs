// PoC 063 candidate: editor owns text and selections (including zero-width carets).
// A separate controller interprets ONE ordered input stream and owns action history.
// No storage/DOM/keyboard-device/collaboration logic exists in either object.
function selectionCopy(value, docLength) {
  if (!value || !Array.isArray(value.ranges) || !Number.isSafeInteger(value.primary) ||
      (value.ranges.length && (value.primary < 0 || value.primary >= value.ranges.length)) ||
      (!value.ranges.length && value.primary !== 0)) throw new TypeError('invalid selection state');
  return {primary:value.primary, ranges:value.ranges.map(r=>{
    if (!r || !Number.isSafeInteger(r.anchor) || !Number.isSafeInteger(r.head) ||
        r.anchor < 0 || r.head < 0 || r.anchor > docLength || r.head > docLength ||
        (r.virtualSpaces!==undefined && (!Number.isSafeInteger(r.virtualSpaces) || r.virtualSpaces < 0)))
      throw new RangeError('invalid selection range');
    return {...r};
  })};
}
function changesCopy(changes, length) {
  if (!Array.isArray(changes) || changes.length === 0) throw new TypeError('nonempty changes required');
  let lastEnd=0, previousStart=-1;
  return changes.map(c=>{
    if (!c || !Number.isSafeInteger(c.start) || !Number.isSafeInteger(c.end) ||
        c.start < 0 || c.end < c.start || c.end > length ||
        c.start < lastEnd || c.start === previousStart || typeof c.insert !== 'string')
      throw new RangeError('invalid, overlapping or duplicate changes');
    lastEnd=c.end;previousStart=c.start;
    return {start:c.start,end:c.end,insert:c.insert};
  });
}
export class EditorCore {
  #document;
  #selection;
  #version=0;
  constructor(document, selection={primary:0,ranges:[]}) {
    if (!document || typeof document.replace!=='function' || typeof document.slice!=='function')
      throw new TypeError('document must expose slice and replace');
    this.#document=document;
    this.#selection=selectionCopy(selection,document.length);
  }
  get length(){return this.#document.length;}
  get lineCount(){return this.#document.lineCount;}
  get version(){return this.#version;}
  slice(start,end){return this.#document.slice(start,end);}
  lineStart(line){return this.#document.lineStart(line);}
  getSelections(){return selectionCopy(this.#selection,this.length);}
  setSelections(next){this.#selection=selectionCopy(next,this.length);}
  // One document command, possibly several distinct ranges. Either every
  // primitive edit succeeds or prior successful edits are restored. This
  // relies on the document primitive not mutating before it throws.
  applyChanges(changes, nextSelections=this.#selection){
    const edits=changesCopy(changes,this.length);
    const delta=edits.reduce((sum,e)=>sum+e.insert.length-(e.end-e.start),0);
    const next=selectionCopy(nextSelections,this.length+delta);
    const previous=this.getSelections();
    const removed=edits.map(e=>this.slice(e.start,e.end));
    const applied=[];
    try {
      for(let i=edits.length-1;i>=0;i--){
        const e=edits[i];
        this.#document.replace(e.start,e.end,e.insert);
        applied.push({start:e.start,end:e.start+e.insert.length,insert:removed[i]});
      }
    } catch(error) {
      try {
        for(let i=applied.length-1;i>=0;i--){
          const e=applied[i];this.#document.replace(e.start,e.end,e.insert);
        }
      } catch(rollbackError) {
        throw new AggregateError([error,rollbackError],'document command and rollback failed');
      }
      throw error;
    }
    this.#selection=next;
    this.#version++;
    return {changes:edits,removed,previous,selection:this.getSelections()};
  }
}

export class ActionController {
  #editor;
  #history=[];
  #index=0;
  #knownVersion;
  #limit;
  #subscribers=new Set();
  observerError=null;
  constructor(editor,{undoLimit=null}={}){
    if(!(editor instanceof EditorCore))throw new TypeError('editor');
    if(undoLimit!==null && (!Number.isSafeInteger(undoLimit)||undoLimit<0))throw new RangeError('undoLimit');
    this.#editor=editor;this.#knownVersion=editor.version;this.#limit=undoLimit;
  }
  get historyLength(){return this.#history.length;}
  get historyIndex(){return this.#index;}
  subscribe(listener){if(typeof listener!=='function')throw new TypeError('listener');this.#subscribers.add(listener);return ()=>this.#subscribers.delete(listener);}
  #notify(event){for(const observer of this.#subscribers){try{observer(event);}catch(error){this.observerError=error;}}}
  #verify(){if(this.#editor.version!==this.#knownVersion)throw new Error('editor modified outside controller');}
  // A single call is one user action. Multiple physical keyboard devices are
  // intentionally NOT independent editing sessions.
  input(action){
    this.#verify();
    if(!action || !['text','pasteRows','backspace'].includes(action.type))throw new TypeError('unsupported action');
    const before=this.#editor.getSelections();
    if(!before.ranges.length)throw new Error('input needs at least one selection');
    if(action.type==='text' && (typeof action.text!=='string'||!action.text.length))throw new TypeError('text');
    if(action.type==='pasteRows' && (!Array.isArray(action.rows)||action.rows.length!==before.ranges.length||!action.rows.every(x=>typeof x==='string')))
      throw new RangeError('pasteRows: one row per selection (provisional policy)');
    const plans=before.ranges.map((range,id)=>{
      let start=Math.min(range.anchor,range.head),end=Math.max(range.anchor,range.head);
      let text=action.type==='text'?action.text:action.type==='pasteRows'?action.rows[id]:'';
      if(action.type==='backspace' && start===end && start>0){
        const last=this.#editor.slice(Math.max(0,start-2),start);
        const hi=last.charCodeAt(last.length-2),lo=last.charCodeAt(last.length-1);
        const surrogate=hi>=0xD800&&hi<=0xDBFF&&lo>=0xDC00&&lo<=0xDFFF;
        start-=surrogate?2:1; // Full grapheme-aware backspace is separate UI work.
      }
      if(action.type!=='backspace' && range.virtualSpaces){
        if(start!==end)throw new RangeError('virtual space is for caret selections only');
        text=' '.repeat(range.virtualSpaces)+text;
      }
      return {id,start,end,insert:text};
    });
    plans.sort((a,b)=>a.start-b.start||a.end-b.end||a.id-b.id);
    const edits=plans.map(({start,end,insert})=>({start,end,insert}));
    let shift=0;
    const positions=[];
    for(const plan of plans){
      const pos=plan.start+shift+plan.insert.length;
      positions[plan.id]=pos;
      shift+=plan.insert.length-(plan.end-plan.start);
    }
    const after={primary:before.primary,ranges:before.ranges.map((r,i)=>({anchor:positions[i],head:positions[i],virtualColumn:r.virtualColumn??0}))};
    const result=this.#editor.applyChanges(edits,after);
    let offset=0;
    const inverse=result.changes.map((e,i)=>{
      const at=e.start+offset;
      offset+=e.insert.length-(e.end-e.start);
      return {start:at,end:at+e.insert.length,insert:result.removed[i]};
    });
    if(this.#index<this.#history.length)this.#history.length=this.#index;
    const entry={forward:result.changes,inverse,before:result.previous,after:result.selection};
    this.#history.push(entry);this.#index++;
    if(this.#limit!==null && this.#history.length>this.#limit){
      const excess=this.#history.length-this.#limit;
      this.#history.splice(0,excess);this.#index-=excess;
    }
    this.#knownVersion=this.#editor.version;
    this.#notify({type:'action',index:this.#index,length:this.#history.length});
    return true;
  }
  undo(){
    this.#verify();
    if(this.#index===0)return false;
    const item=this.#history[this.#index-1];
    this.#editor.applyChanges(item.inverse,item.before);
    this.#index--;this.#knownVersion=this.#editor.version;
    this.#notify({type:'undo',index:this.#index,length:this.#history.length});
    return true;
  }
  redo(){
    this.#verify();
    if(this.#index===this.#history.length)return false;
    const item=this.#history[this.#index];
    this.#editor.applyChanges(item.forward,item.after);
    this.#index++;this.#knownVersion=this.#editor.version;
    this.#notify({type:'redo',index:this.#index,length:this.#history.length});
    return true;
  }
}
