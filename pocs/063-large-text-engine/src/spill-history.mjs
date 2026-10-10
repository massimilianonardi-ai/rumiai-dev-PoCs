// PoC 063: optional, externally archived undo with a bounded hot-record window.
// No DOM, filesystem, IndexedDB, timer, or persistence backend dependency.
// Foreground commit is synchronous. A deep undo/redo may await a cold record.
// No provider means complete undo stays in memory, with no arbitrary depth cap.
function selection(state) {
  if(!state || !Array.isArray(state.ranges)) throw new TypeError('selection');
  return {primary:state.primary,ranges:state.ranges.map(r=>({...r}))};
}
function validate(edits,length){
  let previous=0;
  for(const e of edits){
    if(!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.end)||e.start<previous||e.end<e.start||e.end>length||typeof e.insert!=='string')throw new RangeError('invalid edit ranges');
    previous=e.end;
  }
}
function apply(document,operations){
  for(let i=operations.length-1;i>=0;i--){const [start,removed,inserted]=operations[i];document.replace(start,start+removed.length,inserted);}
}
function reverse(document,operations){
  let delta=0;const inverse=[];
  for(const [start,removed,inserted] of operations){inverse.push([start+delta,inserted.length,removed]);delta+=inserted.length-removed.length;}
  for(let i=inverse.length-1;i>=0;i--){const [at,length,text]=inverse[i];document.replace(at,at+length,text);}
}
export class SpillHistory {
  constructor(document,initial={primary:0,ranges:[]},{hotLimit=128}={}){
    if(!Number.isSafeInteger(hotLimit)||hotLimit<2)throw new RangeError('hotLimit must be >=2');
    this.document=document;
    this.initial=selection(initial);this.selection=selection(this.initial);
    this.hotLimit=hotLimit;
    this.records=new Map();
    this.length=0;this.index=0;
    this.archivedUntil=0;
    this.archiveRead=null;
    this.listeners=new Set();this.notificationError=null;
    this.busy=false;
  }
  subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('listener');
    this.listeners.add(listener);return ()=>this.listeners.delete(listener);
  }
  // External bridge supplies a generic reader, never a provider-specific API.
  setArchiveReader(reader){if(typeof reader!=='function')throw new TypeError('reader');this.archiveRead=reader;}
  notify(change){for(const listener of this.listeners){try{listener(change);}catch(error){this.notificationError=error;}}}
  trim(){
    // Without archived entries, never scan the in-memory journal.
    if(this.archivedUntil===0)return;
    const low=Math.max(0,this.index-this.hotLimit);
    const high=this.index+this.hotLimit;
    for(const key of this.records.keys()){
      if(key<this.archivedUntil&&(key<low||key>=high))this.records.delete(key);
    }
  }
  // Called by the external bridge only after the associated append is stored.
  // Identity protects confirmations arriving after an undo-branch replacement.
  confirmArchived(at,record){
    if(at!==this.archivedUntil||this.records.get(at)!==record)return false;
    this.archivedUntil++;
    this.trim();
    return true;
  }
  commit(edits,after=this.selection){
    if(this.busy)throw new Error('cold history navigation in progress');
    validate(edits,this.document.length);
    const operations=edits.map(e=>[e.start,this.document.slice(e.start,e.end),e.insert]);
    const next=selection(after);
    apply(this.document,operations);
    if(this.index<this.length){
      for(const key of this.records.keys())if(key>=this.index)this.records.delete(key);
      this.length=this.index;
      this.archivedUntil=Math.min(this.archivedUntil,this.index);
    }
    const at=this.index;
    const record={operations,after:next};
    this.records.set(at,record);
    this.index++;this.length=this.index;this.selection=selection(next);
    this.trim();
    this.notify({kind:'append',at,record,cursor:this.index});
  }
  async entry(at){
    if(at<0||at>=this.length)throw new RangeError('entry');
    if(this.records.has(at))return this.records.get(at);
    if(at>=this.archivedUntil)throw new Error('unarchived entry unexpectedly absent');
    if(!this.archiveRead)throw new Error('older undo entry requires external archive reader');
    const record=await this.archiveRead(at);
    if(!record||!Array.isArray(record.operations)||!record.after)throw new Error('invalid archived history record');
    this.records.set(at,record);
    return record;
  }
  async undo(){
    if(this.busy)throw new Error('history navigation already in progress');
    if(this.index===0)return false;
    this.busy=true;
    try{
      const record=await this.entry(this.index-1);
      const previous=this.index>1?selection((await this.entry(this.index-2)).after):selection(this.initial);
      reverse(this.document,record.operations);
      this.index--;this.selection=previous;
      this.trim();this.notify({kind:'cursor',cursor:this.index});return true;
    }finally{this.busy=false;}
  }
  async redo(){
    if(this.busy)throw new Error('history navigation already in progress');
    if(this.index===this.length)return false;
    this.busy=true;
    try{
      const record=await this.entry(this.index);
      apply(this.document,record.operations);
      this.index++;this.selection=selection(record.after);
      this.trim();this.notify({kind:'cursor',cursor:this.index});return true;
    }finally{this.busy=false;}
  }
  get status(){return {residentRecords:this.records.size,historyEntries:this.length,archivedEntries:this.archivedUntil,pendingEntries:this.length-this.archivedUntil};}
}
