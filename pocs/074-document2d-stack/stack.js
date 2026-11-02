'use strict';
const segmenter = new Intl.Segmenter('it', {granularity:'grapheme'});

class Document2D {
  window(row, start, end) {
    if (![row,start,end].every(n => Number.isSafeInteger(n) && n >= 0) || start > end)
      throw new RangeError('Finestra non valida');
    return this.line(row).filter(t => t.left < end && start < t.right && start < end);
  }
  snapshot() { return this.version; }
  check(version) {
    if (version !== this.version) throw new Error('Coordinate scadute');
  }
}

// Piccolo backend di riferimento. Gli intervalli fisici sono offset UTF-16.
class RawDocument2D extends Document2D {
  #text;
  #revision = 0;
  constructor(text) { super(); this.#text = text; }
  get text() { return this.#text; }
  get version() { return this.#revision; }
  line(row) {
    const lines = this.text.split('\n');
    if (row >= lines.length) return [];
    const offset = lines.slice(0,row).reduce((sum,s) => sum+s.length+1,0);
    return [{text:lines[row], left:0, right:lines[row].length, offset, kind:'text'}];
  }
  apply(version, edits) {
    this.check(version);
    if (!edits.length) return;
    let last = 0, next = '';
    for (const e of [...edits].sort((a,b) => a.start-b.start)) {
      if (![e.start,e.end].every(Number.isSafeInteger) || e.start < last ||
          e.end <= e.start || e.end > this.text.length || typeof e.text !== 'string')
        throw new Error('Lotto non valido');
      next += this.text.slice(last,e.start) + e.text;
      last = e.end;
    }
    this.#text = next + this.text.slice(last);
    this.#revision++;
  }
}

// Un fold fra la fine della prima riga e l'inizio della terza.
class ProjectionDocument2D extends Document2D {
  #closed = true;
  #epoch = 0;
  constructor(raw) { super(); this.raw = raw; }
  get closed() { return this.#closed; }
  toggle() { this.#closed = !this.#closed; this.#epoch++; }
  get version() { return this.raw.version + '/' + this.#epoch; }
  line(row) {
    if (!this.closed || !this.raw.line(2).length) return this.raw.line(row);
    if (row > 0) return this.raw.line(row+2);
    const first = this.raw.line(0)[0], tail = this.raw.line(2)[0];
    const left = first.right, right = left+1;
    return [first,{text:'…',kind:'fold',left,right},
      {...tail,left:right,right:right+tail.right}];
  }
  apply(version, edits) {
    this.check(version);
    const physical = edits.map(e => {
      const t = this.line(e.row).find(t => t.kind === 'text' &&
        t.left <= e.start && e.start < e.end && e.end <= t.right);
      if (!t) throw new Error('Intervallo sintetico o misto');
      return {start:t.offset+e.start-t.left,end:t.offset+e.end-t.left,text:e.text};
    });
    this.raw.apply(this.raw.version,physical);
  }
}

class CellDocument2D extends Document2D {
  #cache = new Map();
  #revision;
  constructor(input) { super(); this.input = input; }
  get version() { return this.input.version; }
  line(row) {
    if (this.#revision !== this.version) {
      this.#cache.clear(); this.#revision = this.version;
    }
    if (this.#cache.has(row)) return this.#cache.get(row);
    let col = 0;
    const cells = [];
    for (const run of this.input.line(row)) {
      for (const {segment,index} of segmenter.segment(run.text)) {
        const left = col;
        col += segment === '\t' ? 4-col%4 : 1;
        cells.push({left,right:col,text:segment,kind:run.kind,
          from:run.left+index,to:run.left+index+segment.length});
      }
    }
    this.#cache.set(row,cells);
    return cells;
  }
  apply(version, edits) {
    this.check(version);
    const translated = edits.map(e => {
      const cells = this.window(e.row,e.start,e.end);
      if (!cells.length || cells[0].left !== e.start || cells.at(-1).right !== e.end)
        throw new Error('Selezione parziale o fuori testo');
      return {...e,start:cells[0].from,end:cells.at(-1).to};
    });
    this.input.apply(version,translated);
  }
}

class OverlayDocument2D extends Document2D {
  constructor(input) { super(); this.input = input; }
  get version() { return this.input.version; }
  line(row) { return this.input.line(row); }
  noteAt(row,col) {
    return row >= 0 && row < 2 && col >= 8 && col < 12 ? 'nota' : null;
  }
  apply(version, edits) {
    this.check(version);
    if (edits.some(e => e.row >= 0 && e.row < 2 && e.start < 12 && e.end > 8))
      throw new Error('Nota di sola lettura');
    this.input.apply(version,edits);
  }
}
function fixture() {
  const raw = new RawDocument2D('A\nnascosto\n\tB');
  const projection = new ProjectionDocument2D(raw);
  return {raw,projection,view:new OverlayDocument2D(new CellDocument2D(projection))};
}
