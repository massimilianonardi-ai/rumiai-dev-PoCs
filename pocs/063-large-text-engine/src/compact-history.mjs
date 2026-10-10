// Alternative journal for PoC 063; independent of the DOM and storage backend.
// Each operation stores the inserted/deleted strings exactly once. Each entry
// holds one selection snapshot (after) and the history owns the initial state.
// No fixed depth limit, but retained history still scales with edit count.
function snapshot(state){
  if(!state||!Array.isArray(state.ranges))throw new TypeError('invalid selection');
  return {primary:state.primary,ranges:state.ranges.map(r=>({...r}))};
}
function validate(edits,length){
  let priorEnd=0;
  for(const e of edits){
    if(!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.end)||e.start<priorEnd||e.end<e.start||e.end>length||typeof e.insert!=='string')throw new RangeError('invalid/overlapping edits');
    priorEnd=e.end;
  }
}
export class CompactHistory {
  constructor(document,selection={primary:0,ranges:[]}){
    this.document=document;
    this.initial=snapshot(selection);
    this.selection=snapshot(this.initial);
    this.entries=[];
    this.index=0;
  }
  commit(edits,after=this.selection){
    validate(edits,this.document.length);
    const operations=edits.map(e=>[e.start,this.document.slice(e.start,e.end),e.insert]);
    const state=snapshot(after);
    // Physical edits apply in descending original-document offsets.
    for(let i=operations.length-1;i>=0;i--){
      const [start,removed,inserted]=operations[i];
      this.document.replace(start,start+removed.length,inserted);
    }
    this.entries.length=this.index;
    this.entries.push({operations,after:state});
    this.index++;
    this.selection=snapshot(state);
  }
  undo(){
    if(!this.index)return false;
    const item=this.entries[this.index-1];
    let shift=0;
    const inverse=[];
    for(const [start,removed,inserted] of item.operations){
      const moved=start+shift;
      inverse.push([moved,inserted.length,removed]);
      shift+=inserted.length-removed.length;
    }
    for(let i=inverse.length-1;i>=0;i--){
      const [pos,len,content]=inverse[i];this.document.replace(pos,pos+len,content);
    }
    this.index--;
    this.selection=snapshot(this.index?this.entries[this.index-1].after:this.initial);
    return true;
  }
  redo(){
    if(this.index===this.entries.length)return false;
    const item=this.entries[this.index];
    for(let i=item.operations.length-1;i>=0;i--){
      const [start,removed,inserted]=item.operations[i];
      this.document.replace(start,start+removed.length,inserted);
    }
    this.index++;
    this.selection=snapshot(item.after);
    return true;
  }
}
