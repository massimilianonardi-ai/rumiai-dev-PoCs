// Experimental document representations. Offsets are UTF-16 code units.
// These are intentionally NOT public product APIs.
function check(doc, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > doc.length) {
    throw new RangeError("invalid text range " + start + ":" + end + " (length " + doc.length + ")");
  }
}
function offsetsOfNewlines(s) {
  const indexes = [];
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) indexes.push(i);
  return Uint32Array.from(indexes);
}
function lowerBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
function source(text) { return { text, newlines: offsetsOfNewlines(text) }; }
let random = 0x12345678;
function nextPriority() {
  random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
  return random >>> 0;
}
function leaf(src, from = 0, to = src.text.length) {
  if (from === to) return null;
  const newlines = lowerBound(src.newlines, to) - lowerBound(src.newlines, from);
  return { src, from, to, length: to-from, pieceLF:newlines, lf:newlines, size:to-from,
    prio:nextPriority(), left:null, right:null };
}
const size = n => n?.size ?? 0;
const lf = n => n?.lf ?? 0;
function pull(n) { if(n) { n.size = size(n.left) + n.length + size(n.right); n.lf = lf(n.left)+n.pieceLF+lf(n.right); } return n; }
function merge(a,b) {
  if (!a) return b;
  if (!b) return a;
  if (a.prio >= b.prio) { a.right = merge(a.right,b); return pull(a); }
  b.left = merge(a,b.left); return pull(b);
}
function split(root,k) {
  if (!root) return [null,null];
  const ls=size(root.left);
  if (k < ls) {const [a,b]=split(root.left,k);root.left=b;return [a,pull(root)];}
  if (k > ls+root.length) {const [a,b]=split(root.right,k-ls-root.length);root.right=a;return [pull(root),b];}
  if (k === ls) {const a=root.left;root.left=null;return [a,pull(root)];}
  if (k === ls+root.length) {const b=root.right;root.right=null;return [pull(root),b];}
  const a=leaf(root.src,root.from,root.from+k-ls);
  const b=leaf(root.src,root.from+k-ls,root.to);
  return [merge(root.left,a),merge(b,root.right)];
}
function take(node,start,end,out) {
  if (!node || end<=0 || start>=size(node)) return;
  const ls=size(node.left);
  if (start<ls) take(node.left,start,Math.min(end,ls),out);
  const pStart=Math.max(0,start-ls), pEnd=Math.min(node.length,end-ls);
  if(pStart<pEnd) out.push(node.src.text.slice(node.from+pStart,node.from+pEnd));
  if(end>ls+node.length) take(node.right,start-ls-node.length,end-ls-node.length,out);
}
function findNthLF(root,count) {
  let cur=root, acc=0, target=count;
  while(cur) {
    if(lf(cur.left)>=target) {cur=cur.left;continue;}
    acc+=size(cur.left);target-=lf(cur.left);
    if(cur.pieceLF>=target) {
      const s=cur.src.newlines;
      const newline=s[lowerBound(s,cur.from)+target-1];
      return acc + (newline-cur.from)+1;
    }
    acc+=cur.length;target-=cur.pieceLF;cur=cur.right;
  }
  throw new RangeError("newline " + count + " not found");
}
export class FlatDocument {
  constructor(s='') {this.text=s;}
  get length() {return this.text.length;}
  get lineCount() {return 1+(this.text.match(/\n/g)?.length??0);}
  slice(start,end) {check(this,start,end);return this.text.slice(start,end);}
  replace(start,end,insert) {check(this,start,end);this.text=this.text.slice(0,start)+insert+this.text.slice(end);}
  lineStart(line) {
    if(!Number.isSafeInteger(line)||line<0||line>=this.lineCount)throw new RangeError('line');
    if(!line)return 0;
    let pos=-1;for(let i=0;i<line;i++)pos=this.text.indexOf('\n',pos+1);
    return pos+1;
  }
  toString() {return this.text;}
}
export class PieceDocument {
  constructor(s='') {this.root=leaf(source(s));}
  get length() {return size(this.root);}
  get lineCount() {return 1+lf(this.root);}
  slice(start,end) {check(this,start,end);const parts=[];take(this.root,start,end,parts);return parts.join('');}
  replace(start,end,insert) {
    check(this,start,end);
    if(typeof insert!=='string')throw new TypeError('insert must be a string');
    const [a,right]=split(this.root,start);
    const [,b]=split(right,end-start);
    this.root=merge(merge(a,leaf(source(insert))),b);
  }
  lineStart(line) {
    if(!Number.isSafeInteger(line)||line<0||line>=this.lineCount)throw new RangeError('line');
    return line?findNthLF(this.root,line):0;
  }
  toString() {return this.slice(0,this.length);}
  stats() {let nodes=0, maxDepth=0,srcs=new Set();const walk=(n,d)=>{if(!n)return;nodes++;maxDepth=Math.max(maxDepth,d);srcs.add(n.src);walk(n.left,d+1);walk(n.right,d+1)};walk(this.root,1);return {nodes,maxDepth,sources:srcs.size};}
}
