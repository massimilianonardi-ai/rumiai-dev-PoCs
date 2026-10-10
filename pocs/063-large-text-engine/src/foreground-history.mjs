// PoC 063: the foreground text/history path never awaits persistence.
// A change subscriber is OPTIONAL. It must only enqueue the immutable change;
// slow I/O is the responsibility of an external controller/adapter.
import {CompactHistory} from './compact-history.mjs';

function copyState(state) {
  return {primary:state.primary, ranges:state.ranges.map(range=>({...range}))};
}
function copyRecord(record) {
  return {operations:record.operations.map(op=>op.slice()),after:copyState(record.after)};
}

export class ForegroundHistory extends CompactHistory {
  constructor(document, selection={primary:0,ranges:[]}) {
    super(document,selection);
    this.listeners=new Set();
    this.notificationError=null;
  }
  // Minimal provider-neutral opt-in interface. Do not perform I/O in a listener.
  subscribe(listener) {
    if(typeof listener!=='function')throw new TypeError('listener');
    this.listeners.add(listener);
    return ()=>this.listeners.delete(listener);
  }
  notify(change) {
    for (const listener of this.listeners) {
      // Observer faults never roll back a user edit. Expose the fault rather
      // than silently calling a slow/unavailable persistence provider.
      try { listener(change); } catch(error) { this.notificationError=error; }
    }
  }
  commit(edits,after=this.selection) {
    super.commit(edits,after);
    this.notify({kind:'append',at:this.index-1,record:copyRecord(this.journal.read(this.index-1)),cursor:this.index});
  }
  undo() {
    if(!super.undo())return false;
    this.notify({kind:'cursor',cursor:this.index});return true;
  }
  redo() {
    if(!super.redo())return false;
    this.notify({kind:'cursor',cursor:this.index});return true;
  }
}
