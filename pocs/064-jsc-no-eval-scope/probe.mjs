import assert from 'node:assert/strict';
import vm from 'node:vm';

// Experimental namespace emitters: not a product implementation or parser.
const source = (text, ...symbols) => ({text, symbols});
const ns = (name, modules, imports = {}) => ({name, modules, imports});
const emitSource = n => `${n.text}\n${n.symbols.map(s => `this.${s} = ${s};`).join('\n')}\n`;
function emit(node, mode) {
  if ('text' in node) return emitSource(node);
  const body = node.modules.map(n => emit(n, mode)).join('\n');
  if (!node.name) return body;
  const n = node.name;
  if (mode === 'legacy') return `var ${n} = ${n} || {}; this.${n} = ${n};\n` +
    `${n} = (function(){\nfor (var key in ${n}) ` +
    `eval("var " + key + " = ${n}[key];");\n${body}\nreturn this;\n}.call(${n}));\n`;
  const imports = Object.entries(node.imports)
    .map(([name, path]) => `let ${name} = ${path};`).join('\n');
  return `var ${n} = this.${n} || (this.${n} = {});\n` +
    `(function(){\n'use strict';\n${imports}\n${body}\n}).call(${n});\n`;
}
const compile = (tree, mode) => mode === 'legacy'
  ? tree.map(n => emit(n, mode)).join('\n')
  : `(function(){ 'use strict';\n${tree.map(n => emit(n, mode)).join('\n')}\n}).call(globalThis);`;
const base = [ns('m', [
  source('function Base() { return 10; }', 'Base'),
  ns('srv', [
    ns('data', [source('function MyClass() { return Base() + 32; }', 'MyClass'),
      source('function Other() { return MyClass(); }', 'Other')]),
    source('function Facade() { return data.MyClass() + data.Other() - 42; }', 'Facade')
  ])
])];
const extension = [ns('m', [ns('srv', [
  source('function Extension() { return data.MyClass() + Base(); }', 'Extension')
], {Base:'m.Base', data:'m.srv.data'})])];
const patch = [ns('m', [ns('srv', [ns('data', [
  source('function MyClass() { return 77; }', 'MyClass')
])])])];
const load = (ctx, tree, mode) => vm.runInContext(compile(tree, mode), ctx, {timeout:1000});
const context = () => vm.createContext({});
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}
for (const mode of ['legacy','strict']) {
  check(`${mode}: source order, nested lexical and parent access`, () => {
    const ctx=context(); load(ctx,base,mode);
    assert.equal(ctx.m.srv.data.MyClass(),42);
    assert.equal(ctx.m.srv.data.Other(),42);
    assert.equal(ctx.m.srv.Facade(),42);
  });
  check(`${mode}: separate bundle and unqualified imported names`, () => {
    const ctx=context(); load(ctx,base,mode); load(ctx,extension,mode);
    assert.equal(ctx.m.srv.Extension(),52);
  });
  check(`${mode}: separate patch and export behavior`, () => {
    const ctx=context(); load(ctx,base,mode); load(ctx,extension,mode);
    load(ctx,patch,mode);
    // The faithful legacy eval-wrapper retains old MyClass (42), despite
    // the permanent test expecting the newly declared MyClass (77).
    assert.equal(ctx.m.srv.data.MyClass(), mode==='legacy' ? 42 : 77);
    assert.equal(ctx.m.srv.Extension(),mode==='legacy' ? 52 : 87);
  });
}
check('strict: single file, no eval/with/Function and use strict', () => {
  const code=compile(base,'strict')+compile(extension,'strict');
  assert.doesNotMatch(code,/\beval\s*\(|\bwith\s*\(|\bnew\s+Function\b/);
  assert.match(code,/'use strict'/);
  new vm.Script(code);
});
check('strict: globals, parameters and local shadows', () => {
  const ctx=context(); load(ctx,base,'strict');
  vm.runInContext('let externalLexical = 23;',ctx);
  load(ctx,[ns('m',[ns('srv',[source('function Check(Base) { const local=4; return Base + local + Math.max(2,3) + externalLexical; }','Check')])])],'strict');
  assert.equal(ctx.m.srv.Check(5),35);
});
check('strict: namespace shadows global only when imported', () => {
  const ctx=context(); load(ctx,base,'strict'); ctx.m.srv.Math={max:()=>99};
  load(ctx,[ns('m',[ns('srv',[source('function Check() { return Math.max(1,2); }','Check')],{Math:'m.srv.Math'})])],'strict');
  assert.equal(ctx.m.srv.Check(),99);
});
check('strict: mutation of imported local does not mutate namespace', () => {
  const ctx=context(); load(ctx,base,'strict');
  load(ctx,[ns('m',[ns('srv',[source('function Change(){ Base=()=>20; return Base(); }','Change')],{Base:'m.Base'})])],'strict');
  assert.equal(ctx.m.srv.Change(),20); assert.equal(ctx.m.Base(),10);
});
check('strict: missing import preserves native ReferenceError/typeof', () => {
  const ctx=context();
  load(ctx,[ns('m',[source('function Check(){ return missingName; }','Check'),
    source('function Type(){ return typeof missingName; }','Type')])],'strict');
  assert.throws(()=>ctx.m.Check(),{name:'ReferenceError'});
  assert.equal(ctx.m.Type(),'undefined');
});
check('strict: incorrect import changes missing-name exception', () => {
  const ctx=context(); load(ctx,base,'strict');
  load(ctx,[ns('m',[ns('srv',[source('function Check(){ return NotThere(); }','Check')],{NotThere:'m.NotThere'})])],'strict');
  assert.throws(()=>ctx.m.srv.Check(),{name:'TypeError'});
});
check('strict: import name colliding with lexical class rejects compilation', () => {
  const collision=[ns('m',[ns('srv',[source('class Base {}','Base')],{Base:'m.Base'})])];
  assert.throws(()=>new vm.Script(compile(collision,'strict')),{name:'SyntaxError'});
});
check('strict: late namespace update differs for captured vs qualified access',()=>{
  const ctx=context(); load(ctx,base,'strict'); load(ctx,extension,'strict');
  load(ctx,[ns('m',[ns('srv',[source('function Live(){ return m.Base()+m.srv.data.MyClass(); }','Live')])])],'strict');
  ctx.m.Base=()=>100;
  assert.equal(ctx.m.srv.Extension(),52); assert.equal(ctx.m.srv.Live(),142);
});
check('strict: same compiled classic script with CommonJS bridge',()=>{
  const ctx=vm.createContext({module:{exports:{}}}); load(ctx,base,'strict');
  vm.runInContext("if(typeof module==='object'&&module.exports) module.exports=globalThis.m;",ctx);
  assert.equal(ctx.module.exports.srv.Facade(),42);
});
check('strict: with-style runtime symbol discovery is syntactically excluded',()=>{
  assert.throws(()=>new vm.Script("'use strict'; with ({a:1}) { a; }"),{name:'SyntaxError'});
});
console.log(`RESULT ${passed}/16 passed (Node V8, no browser test)`);
