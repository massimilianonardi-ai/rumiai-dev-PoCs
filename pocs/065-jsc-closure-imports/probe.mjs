import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';

// Research-only emitter, not product jsc or a parser.
const api = {library:'m',symbols:{
 Base:{path:'m.Base',returnType:'number'},
 MyClass:{path:'m.srv.data.MyClass',returnType:'number'}
}};
const body=`
function Extension(){return MyClass()+Base();}
function Live(){return m.srv.data.MyClass()+m.Base();}
m.srv.Extension=Extension;
m.srv.Live=Live;
`;
const withSourceImports=`// @jsc-import Base from m.Base
// @jsc-import MyClass from m.srv.data.MyClass
`+body;
const manifest={files:[{file:'Extension.js',imports:{
 Base:'m.Base',MyClass:'m.srv.data.MyClass'
}}]};
const published={provider:api,consumer:{uses:['m.Base','m.srv.data.MyClass']}};
function importsFor(placement){
 if(placement==='source'){
  const result={};
  for(const x of withSourceImports.matchAll(/^\/\/ @jsc-import ([A-Za-z_$][\w$]*) from ([\w$.]+)$/gm))result[x[1]]=x[2];
  return result;
 }
 if(placement==='bundle')return manifest.files[0].imports;
 if(placement==='interface'){
  const result={};
  for(const p of published.consumer.uses){
   const entry=Object.entries(published.provider.symbols).find(([,v])=>v.path===p);
   assert.ok(entry,'published API not found: '+p);
   result[entry[0]]=p;
  }
  return result;
 }
 throw Error('unknown declaration placement');
}
function verifyImports(imports){
 const available=new Set(Object.values(api.symbols).map(s=>s.path));
 for(const [name,p] of Object.entries(imports)){
  assert.match(name,/^[A-Za-z_$][\w$]*$/);
  assert.match(p,/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/);
  assert.ok(available.has(p),'not published: '+p);
 }
}
function bundle(imports,more=body){
 verifyImports(imports);
 const aliases=Object.entries(imports).map(([name,p])=>`const ${name} = ${p};`).join('\n');
 return `(function(){'use strict';\n${aliases}\n${more}\n}).call(globalThis);\n`;
}
const provider=`var m=globalThis.m||(globalThis.m={});
(function(){'use strict';
function Base(){return 10;}
m.Base=Base;m.srv=m.srv||{};m.srv.data=m.srv.data||{};
function MyClass(){return Base()+32;}
m.srv.data.MyClass=MyClass;
})();`;
const patch=`(function(){'use strict';
m.Base=function Base(){return 100;};
m.srv.data.MyClass=function MyClass(){return 77;};
})();`;
function externs(iface){
 assert.equal(iface.library,'m');
 const nodes=new Set(['m']);
 for(const v of Object.values(iface.symbols)){
  const parts=v.path.split('.');
  for(let i=2;i<parts.length;i++)nodes.add(parts.slice(0,i).join('.'));
 }
 const lines=['/** @externs */','/** @const */','var m = {};'];
 for(const p of [...nodes].sort((a,b)=>a.split('.').length-b.split('.').length))
  if(p!=='m')lines.push(`/** @const */\n${p} = {};`);
 for(const v of Object.values(iface.symbols))
  lines.push(`/** @type {function(): ${v.returnType}} */\n${v.path};`);
 return lines.join('\n')+'\n';
}
let passed=0;
function test(label,run){
 try{run();passed++;console.log('PASS '+label);}
 catch(e){console.error('FAIL '+label+': '+e.stack);process.exitCode=1;}
}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jsc-closure-poc-'));
function closure(label,js,expect,withoutExterns=false){
 const source=path.join(tmp,label+'.js');fs.writeFileSync(source,js);
 const jar=process.env.CLOSURE_JAR;
 if(!jar)throw Error('CLOSURE_JAR required (or use --runtime-only)');
 const args=['-jar',jar,'--checks_only','--warning_level=VERBOSE',
  '--jscomp_error=undefinedVars','--jscomp_error=checkTypes',
  '--jscomp_error=missingProperties'];
 if(!withoutExterns)args.push('--externs',path.join(tmp,'provider.externs.js'));
 args.push('--js',source);
 const run=spawnSync('java',args,{encoding:'utf8',timeout:45000});
 if(run.error)throw run.error;
 const diagnostics=(run.stderr||'')+(run.stdout||'');
 if(expect){
  assert.notEqual(run.status,0,'expected error: '+label+'\n'+diagnostics);
  assert.match(diagnostics,expect,'wrong diagnostic: '+label+'\n'+diagnostics);
 }else assert.equal(run.status,0,'Closure error: '+label+'\n'+diagnostics);
 console.log('CLOSURE '+label+': exit='+run.status+' '+diagnostics.split('\n').filter(Boolean).slice(0,3).join(' | '));
}
try{
 fs.writeFileSync(path.join(tmp,'provider.externs.js'),externs(api));
 const compiled={};
 for(const placement of ['source','bundle','interface']){
  const imports=importsFor(placement);
  test(placement+' explicit imports',()=>assert.deepEqual(imports,{
   Base:'m.Base',MyClass:'m.srv.data.MyClass'}));
  compiled[placement]=bundle(imports);
  test(placement+' snapshot and live semantics',()=>{
   const context=vm.createContext({});
   vm.runInContext(provider,context);
   vm.runInContext(compiled[placement],context);
   assert.equal(context.m.srv.Extension(),52);
   assert.equal(context.m.srv.Live(),52);
   vm.runInContext(patch,context);
   assert.equal(context.m.srv.Extension(),52);
   assert.equal(context.m.srv.Live(),177);
  });
  test(placement+' classic strict JavaScript without eval',()=>{
   const out=provider+'\n'+compiled[placement];
   new vm.Script(out);
   assert.match(out,/'use strict'/);
   assert.doesNotMatch(out,/\beval\s*\(|\bnew\s+Function\s*\(|\bwith\s*\(/);
  });
 }
 test('all declaration placements emit identical JS',()=>{
  assert.equal(compiled.source,compiled.bundle);
  assert.equal(compiled.bundle,compiled.interface);
 });
 test('unknown published import rejected',()=>assert.throws(
  ()=>bundle({Bad:'m.srv.data.Bad'}),/not published/));
 test('Closure externs built from provider API',()=>{
  assert.match(externs(api),/m\.srv\.data\.MyClass/);
  assert.match(externs(api),/function\(\): number/);
 });
 if(process.argv.includes('--runtime-only'))
  console.log('RUNTIME ONLY: '+passed+'/12, Closure not run');
 else{
  test('Closure accepts consumer with generated externs',()=>closure('positive',compiled.bundle,null));
  test('Closure diagnoses unbound identifier',()=>closure('unbound',
   bundle(importsFor('bundle'),body+'\nfunction Broken(){return NotDeclared();}'),/NotDeclared|undeclared/));
  test('Closure diagnoses parse error',()=>closure('syntax',
   bundle(importsFor('bundle'),body+'\nfunction Broken( {'),/ERROR|Parse error|parse error/));
  test('Closure diagnoses missing provider API property',()=>closure('missing_property',
   bundle(importsFor('bundle'),body+'\nfunction Broken(){return m.srv.data.NotPublished();}'),/NotPublished|property/));
  test('Closure diagnoses wrong return type',()=>closure('wrong_return',
   bundle(importsFor('bundle'),body+'\n/** @return {number} */ function BadType(){return "oops";}'),
   /inconsistent return type|found.*string|number/));
  test('Closure validates standalone producer',()=>closure('producer',provider,null,true));
  console.log('FULL RESULT: '+passed+' checks, including real Closure CLI');
 }
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
