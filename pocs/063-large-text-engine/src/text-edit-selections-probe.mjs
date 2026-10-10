// PoC 063: structural TextEditBase contract + selection editing, not a product API.
// TextEditBase is a SINGLE-INTERVAL text store: length, slice(from,to),
// replace(from,to,text). It has no selection, batch, undo or observer concepts.
// TextEditSelections alone owns selections; direction is injected by the caller.

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
  #onBackward;
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
    if (!Array.isArray(ranges)) throw new TypeError('selections must be an array');
    this.#selections=ranges.map(r=>copySelection(r,this.length));
    return this;
  }
  // A single string is copied to all selections. An array is paired in the
  // USER'S SELECTION ORDER, not sorted text order. No clipboard policy.
  replace(textOrTexts) {
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
    const ordered=before.map((s,id)=>{
      const payload=texts[id];
      const plan=s.forward?
        sameRange({selection:s,text:payload}):
        this.#onBackward({selection:{...s},text:payload});
      if (!plan || !validIndex(plan.start) || !validIndex(plan.end) ||
          plan.end<plan.start || plan.end>this.length || typeof plan.insert!=='string')
        throw new RangeError('invalid direction-specific edit');
      return {id, start:plan.start, end:plan.end, insert:plan.insert, forward:s.forward};
    }).sort((a,b)=>a.start-b.start || a.end-b.end || a.id-b.id);
    let lastEnd=0,lastStart=-1;
    for(const op of ordered) {
      if(op.start<lastEnd || op.start===lastStart)
        throw new RangeError('overlapping/duplicate edit targets');
      lastEnd=op.end; lastStart=op.start;
    }
    // Every original span is captured before mutation; the wrapper can build
    // inversion records from the result without subscribing to the base.
    const originals=ordered.map(op=>this.#store.slice(op.start,op.end));
    // One call per selected range; avoid rollback bookkeeping in the hot path.
    // Every user-input conflict has already been rejected before writes.
    // Exceptional failures from a valid base replace propagate directly;
    // previously completed replacements may remain in the document.
    for(let i=ordered.length-1;i>=0;i--){
      const op=ordered[i];
      this.#store.replace(op.start,op.end,op.insert);
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
    return {changes, before, after:this.getSelections()};
  }
}
