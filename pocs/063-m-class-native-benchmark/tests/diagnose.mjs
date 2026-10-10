#!/usr/bin/env node
// Experimental mechanistic diagnosis for the inherited-instance heap anomaly.
// Requires --expose-gc --allow-natives-syntax; never modifies m.Class.
import fs from 'node:fs';
const original = fs.readFileSync(process.argv[2], 'utf8');
const Class = new Function(original + '\nreturn Class;')();
const hasFast = new Function('object', 'return %HasFastProperties(object);');
function gc() { global.gc(); global.gc(); }
const Base=Class().method('construct',function(){this.base=10;})
  .method('baseCalc',function(){return this.base+1;}).get();
const makeChild=dynamic=>Class().inherit(Base,dynamic)
  .method('construct',function(x){this.x=x;})
  .method('calc',function(){return this.baseCalc()+this.x;}).get();
const InheritedDynamic=makeChild(true), InheritedCopy=makeChild(false);
class NativeBase { constructor(){this.base=10} baseCalc(){return this.base+1} }
class NativeInherited extends NativeBase {
  constructor(x){super();this.x=x}
  calc(){return this.baseCalc()+this.x}
}
class NativeTemporary {
  constructor(x) {
    this._new=true;
    this._instanceof=Base;
    this.base=10;
    delete this._instanceof;
    this.x=x;
  }
  calc(){return this.base+this.x+1}
}
const EmptyBase=Class().method('baseCalc',function(){return 11}).get();
const EmptyInherited=Class().inherit(EmptyBase,true)
  .method('construct',function(x){this.x=x})
  .method('calc',function(){return this.baseCalc()+this.x}).get();
const TYPE=[
 ['native-inherited',NativeInherited],
 ['native-transient-delete',NativeTemporary],
 ['m.Class-dynamic',InheritedDynamic],
 ['m.Class-copy',InheritedCopy],
 ['m.Class-empty-base',EmptyInherited]
];
function measure(label,Type,n=650000) {
  let warm=new Array(10000);
  for(let i=0;i<warm.length;i++)warm[i]=new Type(i);
  if (warm[3].calc()!==14) throw new Error('Invalid fixture '+label);
  gc();
  let array=new Array(n);globalThis.kept=array;gc();
  const before=process.memoryUsage().heapUsed;
  for(let i=0;i<n;i++)array[i]=new Type(i);
  const initial=array[0],end=array[n-1];
  if(end.calc()!==n+10)throw new Error('Mismatch '+label);
  gc();
  const after=process.memoryUsage().heapUsed;
  const result={label,n,bytes_per_instance:Math.round((after-before)/n*1000)/1000,
    heap_delta:after-before,fast_properties:hasFast(initial),
    own_properties:Object.getOwnPropertyNames(initial),
    instance_of_base:initial instanceof Base,
    instance_of_native_base:initial instanceof NativeBase,
    prototype_parent_is_class_base:Object.getPrototypeOf(Type.prototype)===Base.prototype};
  globalThis.kept=null;array=null;warm=null;gc();
  return result;
}
for(const [label,Type] of TYPE)console.log('@@DIAG@@'+JSON.stringify(measure(label,Type)));
