// PoC 063: a DOM-/Node-free, Promise-based persistent-history experiment.
// Injected storage is the only persistence dependency. No crash recovery or
// durable atomicity contract is provided at this experimental stage.
// Storage candidate: count(), read(index), appendAt(index, entry),
// readSession(), writeSession({initial, cursor}); all may be asynchronous.

function copySelection(selection) {
  if (!selection || !Array.isArray(selection.ranges)) throw new TypeError('selection');
  return {primary: selection.primary, ranges: selection.ranges.map(r => ({...r}))};
}
function checkEdits(edits, length) {
  let lastEnd = 0;
  for (const edit of edits) {
    if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) ||
        edit.start < lastEnd || edit.end < edit.start || edit.end > length || typeof edit.insert !== 'string')
      throw new RangeError('invalid or overlapping edit');
    lastEnd = edit.end;
  }
}
function forward(document, operations) {
  for (let i = operations.length - 1; i >= 0; i--) {
    const [start, removed, inserted] = operations[i];
    document.replace(start, start + removed.length, inserted);
  }
}
function backward(document, operations) {
  let shift = 0;
  const inverse = [];
  for (const [start, removed, inserted] of operations) {
    inverse.push([start + shift, inserted.length, removed]);
    shift += inserted.length - removed.length;
  }
  for (let i = inverse.length - 1; i >= 0; i--) {
    const [pos, length, text] = inverse[i];
    document.replace(pos, pos + length, text);
  }
}
export class AsyncHistory {
  constructor(document, storage, initial, cursor) {
    this.document = document;
    this.storage = storage;
    this.initial = copySelection(initial);
    this.selection = copySelection(initial);
    this.index = cursor;
    this.pending = false;
  }
  static async open(document, storage, initialSelection = {primary: 0, ranges: []}) {
    for (const name of ['count', 'read', 'appendAt', 'readSession', 'writeSession']) {
      if (typeof storage?.[name] !== 'function') throw new TypeError('storage missing ' + name);
    }
    let meta = await storage.readSession();
    const count = await storage.count();
    if (meta === null) {
      if (count !== 0) throw new Error('missing session for nonempty journal');
      meta = {initial: copySelection(initialSelection), cursor: 0};
      await storage.writeSession(meta);
    }
    if (!Number.isSafeInteger(meta.cursor) || meta.cursor < 0 || meta.cursor > count)
      throw new RangeError('invalid saved cursor');
    const h = new AsyncHistory(document, storage, meta.initial, meta.cursor);
    // Caller supplies the original/base document contents. Reconstruct normal
    // clean-close sessions by replaying the records, not by copying them to RAM.
    for (let i = 0; i < meta.cursor; i++) {
      const entry = await storage.read(i);
      forward(document, entry.operations);
      h.selection = copySelection(entry.after);
    }
    return h;
  }
  async use(fn) {
    if (this.pending) throw new Error('concurrent history operation');
    this.pending = true;
    try { return await fn(); } finally { this.pending = false; }
  }
  async commit(edits, after = this.selection) {
    return this.use(async () => {
      checkEdits(edits, this.document.length);
      const operations = edits.map(e => [e.start, this.document.slice(e.start, e.end), e.insert]);
      const next = copySelection(after);
      await this.storage.appendAt(this.index, {operations, after: next});
      forward(this.document, operations);
      this.index++;
      this.selection = next;
      await this.storage.writeSession({initial: this.initial, cursor: this.index});
    });
  }
  async undo() {
    return this.use(async () => {
      if (this.index === 0) return false;
      const entry = await this.storage.read(this.index - 1);
      const previous = this.index > 1 ? copySelection((await this.storage.read(this.index - 2)).after) : this.initial;
      backward(this.document, entry.operations);
      this.index--;
      this.selection = copySelection(previous);
      await this.storage.writeSession({initial: this.initial, cursor: this.index});
      return true;
    });
  }
  async redo() {
    return this.use(async () => {
      if (this.index === await this.storage.count()) return false;
      const entry = await this.storage.read(this.index);
      forward(this.document, entry.operations);
      this.index++;
      this.selection = copySelection(entry.after);
      await this.storage.writeSession({initial: this.initial, cursor: this.index});
      return true;
    });
  }
}
