// PoC 063: structural TextEditBase contract + selection editing, not a product API.
// TextEditBase is a SINGLE-INTERVAL text store: length, slice(from,to),
// replace(from,to,text). It has no selection, batch, undo or observer concepts.
// TextEditSelections alone owns selections; direction is injected by the caller.
// A failed multi-range action restores completed writes in reverse order.
// If a backend cannot be restored reliably, the editor instance fails closed.

function validIndex(n) { return Number.isSafeInteger(n) && n >= 0; }
function copySelection(r, length) {
  if (!r || !validIndex(r.start) || !validIndex(r.end) || r.end < r.start ||
      r.end > length || typeof r.forward !== 'boolean')
    throw new RangeError('invalid oriented selection');
  return {start:r.start, end:r.end, forward:r.forward};
}
function validateBase(store) {
  if (!store || !validIndex(store.length) || typeof store.slice !== 'function' ||
      typeof store.replace !== 'function') throw new TypeError('invalid TextEditBase contract');
}
const sameRange = ({selection, text}) =>
  ({start:selection.start, end:selection.end, insert:text});

export class TextEditSelections {
  #store;
  #selections=[];
  #orderedIds=[];
  #onBackward;
  #unrecoverable=false;
  constructor(store, {onBackward=sameRange}={}) {
    validateBase(store);
    if (typeof onBackward !== 'function') throw new TypeError('onBackward');
    this.#store=store;
    this.#onBackward=onBackward;
  }
  get length() { return this.#store.length; }
  slice(from,to) { return this.#store.slice(from,to); }
  getSelections() { return this.#selections.map(s=>({...s})); }
  setSelections(ranges) {
    if (this.#unrecoverable) throw new Error('text store state is uncertain; discard this editor instance');
    if (!Array.isArray(ranges)) throw new TypeError('selections must be an array');
    const selections=ranges.map(r=>copySelection(r,this.length));
    // Selection identity/order is unchanged. Cache only physical execution
    // order, since normal typing can reuse it for successive keystrokes.
    this.#orderedIds=selections.map((_,id)=>id).sort((i,j)=>
      selections[i].start-selections[j].start ||
      selections[i].end-selections[j].end || i-j);
    this.#selections=selections;
    return this;
  }
  // A single string is copied to all selections. An array is paired in the
  // USER'S SELECTION ORDER, not sorted text order. No clipboard policy.
  replace(textOrTexts) {
    if (this.#unrecoverable) throw new Error('text store state is uncertain; discard this editor instance');
    const before=this.getSelections(), count=before.length;
    if (!count) throw new RangeError('no selections');
    const texts=typeof textOrTexts==='string'?
      Array.from({length:count},()=>textOrTexts):textOrTexts;
    if (!Array.isArray(texts) || texts.length!==count ||
        texts.some(t=>typeof t!=='string'))
      throw new RangeError('one string per selection required');
    // Convert oriented selections to primitive one-range commands. The
    // direction-specific behavior is an implementation-supplied callback;
    // the base store cannot see it.
    const ordered=this.#orderedIds.map(id=>{
      const s=before[id];
      const payload=texts[id];
      const plan=s.forward?
        sameRange({selection:s,text:payload}):
        this.#onBackward({selection:{...s},text:payload});
      if (!plan || !validIndex(plan.start) || !validIndex(plan.end) ||
          plan.end<plan.start || plan.end>this.length || typeof plan.insert!=='string')
        throw new RangeError('invalid direction-specific edit');
      return {id, start:plan.start, end:plan.end, insert:plan.insert, forward:s.forward};
    });
    // A direction policy may move the edit target beyond the selection.
    // Usually cached physical order remains valid; verify cheaply and fall
    // back to sort only if the positions have actually changed order.
    const byPosition=(a,b)=>a.start-b.start || a.end-b.end || a.id-b.id;
    for(let i=1;i<ordered.length;i++){
      if(byPosition(ordered[i-1],ordered[i])>0){
        ordered.sort(byPosition);
        break;
      }
    }
    let lastEnd=0,lastStart=-1;
    for(const op of ordered) {
      if(op.start<lastEnd || op.start===lastStart)
        throw new RangeError('overlapping/duplicate edit targets');
      lastEnd=op.end; lastStart=op.start;
    }
    // Every original span is captured before mutation; the wrapper can build
    // inversion records from the result without subscribing to the base.
    const originals=ordered.map(op=>this.#store.slice(op.start,op.end));
    // All original text is captured before the first write, so compensation
    // never needs to reconstruct deleted content from a partially edited tree.
    // Apply from right to left: original offsets remain valid while editing.
    const originalLength=this.#store.length;
    const completed=[];
    for(let i=ordered.length-1;i>=0;i--){
      const op=ordered[i];
      const lengthBefore=this.#store.length;
      try {
        this.#store.replace(op.start,op.end,op.insert);
        completed.push(i);
      } catch(error) {
        // A custom backend can throw either before or AFTER completing a
        // replacement. Detect both using the local range and length. If its
        // effects cannot be identified, never guess or silently continue.
        try {
          const currentLength=this.#store.length;
          const unchanged=currentLength===lengthBefore &&
            this.#store.slice(op.start,op.end)===originals[i];
          const applied=currentLength===lengthBefore+
              op.insert.length-(op.end-op.start) &&
            this.#store.slice(op.start,op.start+op.insert.length)===op.insert;
          if(!unchanged && !applied)
            throw new Error('failed replacement left an unrecognizable text state');
          if(!unchanged) completed.push(i);
          // Undo in the exact reverse order of successful primitive writes.
          for(let j=completed.length-1;j>=0;j--){
            const index=completed[j],done=ordered[index];
            this.#store.replace(done.start,done.start+done.insert.length,
              originals[index]);
          }
          // Validate the complete set of affected spans and document length.
          if(this.#store.length!==originalLength)
            throw new Error('rollback did not restore document length');
          for(let j=0;j<ordered.length;j++){
            const candidate=ordered[j];
            if(this.#store.slice(candidate.start,candidate.end)!==originals[j])
              throw new Error('rollback did not restore edited text');
          }
        } catch(rollbackError) {
          this.#unrecoverable=true;
          throw new AggregateError([error,rollbackError],
            'text edit failed and recovery could not be verified',
            {cause:error});
        }
        // The original error remains the reported failure after recovery.
        throw error;
      }
    }
    const after=new Array(count);
    const changes=[];
    let displacement=0;
    for(let i=0;i<ordered.length;i++){
      const op=ordered[i], position=op.start+displacement+op.insert.length;
      after[op.id]={start:position,end:position,forward:op.forward};
      changes.push({
        selectionId:op.id, start:op.start, end:op.end,
        removed:originals[i], inserted:op.insert,
        inverseStart:op.start+displacement,
        inverseEnd:position
      });
      displacement+=op.insert.length-(op.end-op.start);
    }
    this.#selections=after;
    this.#orderedIds=ordered.map(op=>op.id);
    return {changes, before, after:this.getSelections()};
  }
}
