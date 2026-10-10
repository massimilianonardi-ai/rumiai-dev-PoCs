// PoC-only Node adapter. The text core imports nothing from node:fs.
// Two files: variable-size UTF-8 JSON payloads and 16-byte (offset,length)
// index records. No in-RAM array of history entries or offsets.
import * as fs from 'node:fs';

const SLOT = 16;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024; // PoC guardrail, not a product limit.
function writeAll(fd, buffer, position) {
  let count = 0;
  while (count < buffer.length) {
    const n = fs.writeSync(fd, buffer, count, buffer.length - count, position + count);
    if (n <= 0) throw new Error('journal short write');
    count += n;
  }
}
function readAll(fd, buffer, position) {
  let count = 0;
  while (count < buffer.length) {
    const n = fs.readSync(fd, buffer, count, buffer.length - count, position + count);
    if (n <= 0) throw new Error('journal truncated');
    count += n;
  }
}
export class NodeFileJournal {
  constructor(prefix, {create = true} = {}) {
    this.dataPath = prefix + '.data';
    this.indexPath = prefix + '.index';
    this.dataFd = fs.openSync(this.dataPath, create ? 'wx+' : 'r+');
    try { this.indexFd = fs.openSync(this.indexPath, create ? 'wx+' : 'r+'); }
    catch (e) { fs.closeSync(this.dataFd); throw e; }
    const idxBytes = fs.fstatSync(this.indexFd).size;
    if (idxBytes % SLOT) throw new Error('partial journal index record');
    this.count = idxBytes / SLOT;
    this.end = this.count ? this.offsetAt(this.count - 1).end : 0;
    if (fs.fstatSync(this.dataFd).size < this.end) throw new Error('truncated journal data');
    this.closed = false;
  }
  get length() { return this.count; }
  get byteLength() { return this.end + this.count * SLOT; }
  offsetAt(index) {
    const data = Buffer.allocUnsafe(SLOT);
    readAll(this.indexFd, data, index * SLOT);
    const position = Number(data.readBigUInt64LE(0));
    const size = Number(data.readBigUInt64LE(8));
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(size) || size > MAX_ENTRY_BYTES)
      throw new Error('invalid journal record');
    return {position, size, end: position + size};
  }
  read(index) {
    if (this.closed) throw new Error('closed journal');
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.count) throw new RangeError('journal index');
    const {position, size} = this.offsetAt(index);
    const bytes = Buffer.allocUnsafe(size);
    readAll(this.dataFd, bytes, position);
    return JSON.parse(bytes.toString('utf8'));
  }
  appendAt(index, entry) {
    if (this.closed) throw new Error('closed journal');
    if (!Number.isSafeInteger(index) || index < 0 || index > this.count) throw new RangeError('append index');
    const bytes = Buffer.from(JSON.stringify(entry), 'utf8');
    if (bytes.length > MAX_ENTRY_BYTES) throw new RangeError('single journal entry exceeds PoC limit');
    const position = index === this.count ? this.end : index ? this.offsetAt(index - 1).end : 0;
    // On a redo branch this truncation is NOT crash-atomic with the append.
    if (index < this.count) {
      fs.ftruncateSync(this.indexFd, index * SLOT);
      fs.ftruncateSync(this.dataFd, position);
      this.count = index;
      this.end = position;
    }
    writeAll(this.dataFd, bytes, position);
    const meta = Buffer.alloc(SLOT);
    meta.writeBigUInt64LE(BigInt(position), 0);
    meta.writeBigUInt64LE(BigInt(bytes.length), 8);
    writeAll(this.indexFd, meta, index * SLOT);
    this.count = index + 1;
    this.end = position + bytes.length;
  }
  sync() { fs.fsyncSync(this.dataFd); fs.fsyncSync(this.indexFd); }
  close() {
    if (this.closed) return;
    this.closed = true;
    fs.closeSync(this.indexFd);
    fs.closeSync(this.dataFd);
  }
}
