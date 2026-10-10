// PoC core history: storage is injected; no Node, DOM, or filesystem dependency.
// Journal entry encodes each original edit once and a single after-selection.
function snapshot(state) {
  if (!state || !Array.isArray(state.ranges)) throw new TypeError('invalid selection');
  return {primary: state.primary, ranges: state.ranges.map(r => ({...r}))};
}
function validate(edits, length) {
  let last = 0;
  for (const e of edits) {
    if (!Number.isSafeInteger(e.start) || !Number.isSafeInteger(e.end) ||
        e.start < last || e.end < e.start || e.end > length || typeof e.insert !== 'string')
      throw new RangeError('invalid/overlapping edits');
    last = e.end;
  }
}
// Compatibility baseline for prior PoC history comparisons.
export class ArrayJournal {
  constructor() { this.records = []; }
  get length() { return this.records.length; }
  read(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length)
      throw new RangeError('journal index');
    return this.records[index];
  }
  appendAt(index, item) {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.length)
      throw new RangeError('append index');
    this.records.length = index;
    this.records.push(item);
  }
}
export class CompactHistory {
  constructor(document, selection = {primary: 0, ranges: []}, journal = new ArrayJournal()) {
    if (!journal || typeof journal.read !== 'function' || typeof journal.appendAt !== 'function')
      throw new TypeError('invalid journal storage');
    if (journal.length !== 0) throw new Error('a new history requires an empty journal');
    this.document = document;
    this.initial = snapshot(selection);
    this.selection = snapshot(this.initial);
    this.journal = journal;
    // Preserve the old PoC's introspection for in-memory benchmarks only.
    this.entries = journal.records ?? null;
    this.index = 0;
  }
  get length() { return this.journal.length; }
  commit(edits, after = this.selection) {
    validate(edits, this.document.length);
    const operations = edits.map(e => [e.start, this.document.slice(e.start, e.end), e.insert]);
    const state = snapshot(after);
    // Store first: a rejected journal append must not mutate the document.
    // Crash-atomicity of append + edit is NOT provided by this experiment.
    this.journal.appendAt(this.index, {operations, after: state});
    for (let i = operations.length - 1; i >= 0; i--) {
      const [start, removed, inserted] = operations[i];
      this.document.replace(start, start + removed.length, inserted);
    }
    this.index++;
    this.selection = snapshot(state);
  }
  undo() {
    if (!this.index) return false;
    const item = this.journal.read(this.index - 1);
    let shift = 0;
    const inverse = [];
    for (const [start, removed, inserted] of item.operations) {
      inverse.push([start + shift, inserted.length, removed]);
      shift += inserted.length - removed.length;
    }
    for (let i = inverse.length - 1; i >= 0; i--) {
      const [pos, len, content] = inverse[i];
      this.document.replace(pos, pos + len, content);
    }
    this.index--;
    this.selection = snapshot(this.index ? this.journal.read(this.index - 1).after : this.initial);
    return true;
  }
  redo() {
    if (this.index === this.journal.length) return false;
    const item = this.journal.read(this.index);
    for (let i = item.operations.length - 1; i >= 0; i--) {
      const [start, removed, inserted] = item.operations[i];
      this.document.replace(start, start + removed.length, inserted);
    }
    this.index++;
    this.selection = snapshot(item.after);
    return true;
  }
}
