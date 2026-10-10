// PoC 063: logical UTF-16 positions and visual-cell geometry are distinct.
// DOM independent. A caller supplies grapheme-cell widths; this module never
// assumes all fonts/locales have a single universal visual-width policy.
// Range geometry and column-paste *semantics* are different responsibilities.
const graphemes = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
const natural = n => Number.isSafeInteger(n) && n >= 0;

export function probeLine(document, row, {tabSize = 4, widthOf} = {}) {
  if (!natural(row) || row >= document.lineCount) throw new RangeError('line');
  if (!Number.isSafeInteger(tabSize) || tabSize < 1) throw new RangeError('tabSize');
  if (typeof widthOf !== 'function') throw new TypeError('widthOf must be provided by the view');
  const start = document.lineStart(row);
  const next = row + 1 < document.lineCount ? document.lineStart(row + 1) : document.length;
  // lineStart() points after LF. CR is part of a CRLF terminator, not a cell.
  let textEnd = next;
  if (textEnd > start && document.slice(textEnd - 1, textEnd) === '\n') textEnd--;
  if (textEnd > start && next > textEnd && document.slice(textEnd - 1, textEnd) === '\r') textEnd--;
  const lineText = document.slice(start, textEnd);
  const cells = [];
  let col = 0;
  for (const item of graphemes.segment(lineText)) {
    const from = start + item.index, to = from + item.segment.length;
    const width = item.segment === '\t' ? tabSize - col % tabSize : widthOf(item.segment, col, row);
    if (!Number.isSafeInteger(width) || width <= 0) throw new RangeError('invalid grapheme width');
    cells.push({text: item.segment, start: from, end: to, columnStart: col, columnEnd: col + width});
    col += width;
  }
  return {line: row, start, textEnd, end: next, columns: col, cells};
}

export function locateColumn(geometry, column) {
  if (!natural(column)) throw new RangeError('visual column');
  for (const cell of geometry.cells) {
    if (column === cell.columnStart) return {kind:'exact',offset:cell.start,virtualSpaces:0};
    if (column < cell.columnEnd) {
      return {kind:'inside-grapheme',cell, before:cell.start, after:cell.end};
    }
  }
  if (column <= geometry.columns) return {kind:'exact',offset:geometry.textEnd,virtualSpaces:0};
  return {kind:'virtual',offset:geometry.textEnd,virtualSpaces:column-geometry.columns};
}

// Only translate requested rectangles into exact document-coordinate targets.
// No silent snapping inside a tab, wide glyph or composed grapheme. No special
// policy for source/destination clipboard shape, font or hit-test pixel width.
// Rows are inclusive; rectangles may be disjoint and unordered by the caller.
export function probeRectangles(document, rectangles, options) {
  if (!Array.isArray(rectangles)) throw new TypeError('rectangles');
  const targets = [], unresolved = [], collisions = [];
  let rowCount = 0;
  for (let id = 0; id < rectangles.length; id++) {
    const r = rectangles[id];
    if (!r || ![r.lineFrom,r.lineTo,r.columnFrom,r.columnTo].every(natural)) throw new RangeError('rectangle coordinates');
    const firstLine = Math.min(r.lineFrom,r.lineTo), lastLine = Math.max(r.lineFrom,r.lineTo);
    if (lastLine >= document.lineCount) throw new RangeError('rectangle line outside document');
    const firstColumn = Math.min(r.columnFrom,r.columnTo), lastColumn = Math.max(r.columnFrom,r.columnTo);
    for (let line = firstLine; line <= lastLine; line++) {
      const g = probeLine(document, line, options);
      const first = locateColumn(g,firstColumn), last = locateColumn(g,lastColumn);
      rowCount++;
      if (first.kind === 'inside-grapheme' || last.kind === 'inside-grapheme') {
        unresolved.push({rectangle:id,line,first,last,reason:'inside-grapheme'});
        continue;
      }
      targets.push({rectangle:id,line,start:first.offset,end:last.offset,
        virtualSpaces:first.virtualSpaces,virtualEndSpaces:last.virtualSpaces,
        columnFrom:firstColumn,columnTo:lastColumn});
    }
  }
  targets.sort((a,b)=>a.start-b.start || a.end-b.end || a.rectangle-b.rectangle);
  let furthest = null;
  for (const next of targets) {
    // Compare against the furthest active interval, not merely the preceding
    // target: nested rectangles otherwise hide collisions further down.
    if (furthest && (next.start < furthest.end || next.start === furthest.start))
      collisions.push({first:furthest,second:next});
    if (!furthest || next.end > furthest.end) furthest = next;
  }
  return {targets,unresolved,collisions,requestedRows:rowCount};
}
