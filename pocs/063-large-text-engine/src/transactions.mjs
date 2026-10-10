// Experimental transaction and column-input planner, independent from DOM.
function deepSelection(s) {
  return { primary:s.primary, ranges:s.ranges.map(r=>({...r})) };
}
function validate(edits,len) {
  let previousEnd=0;
  for (let i=0;i<edits.length;i++) {
    const e=edits[i];
    if(!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.end)||e.start<previousEnd||e.start>e.end||e.end>len||typeof e.insert!=='string')
      throw new RangeError("invalid/overlapping edits at " + i);
    previousEnd=e.end;
  }
}
function run(doc,edits) {
  for(let i=edits.length-1;i>=0;i--) {
    const e=edits[i];doc.replace(e.start,e.end,e.insert);
  }
}
export class History {
  constructor(document,selection={primary:0,ranges:[]}) {
    this.document=document;this.selection=deepSelection(selection);
    this.entries=[];this.index=0;
  }
  commit(edits,after=this.selection) {
    validate(edits,this.document.length);
    const backward=[];
    let shift=0;
    for(const e of edits) {
      const deleted=this.document.slice(e.start,e.end);
      backward.push({start:e.start+shift,end:e.start+shift+e.insert.length,insert:deleted});
      shift+=e.insert.length-(e.end-e.start);
    }
    const before=deepSelection(this.selection);
    const next=deepSelection(after);
    run(this.document,edits);
    this.entries.length=this.index;
    this.entries.push({forward:edits.map(e=>({...e})),backward,before,after:next});
    this.index++;
    this.selection=next;
  }
  undo() {
    if(!this.index)return false;
    const item=this.entries[--this.index];run(this.document,item.backward);
    this.selection=deepSelection(item.before);return true;
  }
  redo() {
    if(this.index===this.entries.length)return false;
    const item=this.entries[this.index++];run(this.document,item.forward);
    this.selection=deepSelection(item.after);return true;
  }
}
export function columnPastePlan(targets,clipboard,{fill='cycle'}={}) {
  // Experimental single-field-per-row policy; does not parse CSV/TSV cells.
  // Targets are sorted non-overlapping document ranges; virtualSpaces denotes
  // horizontal padding not yet present in the document.
  if(!Array.isArray(targets)||!targets.length)throw new TypeError('targets required');
  const lines=clipboard.split(/\r\n|\r|\n/);
  return targets.map((t,i)=>{
    const payload=i<lines.length?lines[i]:fill==='cycle'?lines[i%lines.length]:fill==='blank'?'':null;
    if(payload===null)return {start:t.start,end:t.end,insert:'',noop:true};
    return {start:t.start,end:t.end,insert:' '.repeat(t.virtualSpaces??0)+payload};
  }).filter(e=>!e.noop);
}
