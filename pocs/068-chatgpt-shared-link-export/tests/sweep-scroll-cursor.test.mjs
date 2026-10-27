'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Exercise the actual native-CDP sweep body with a deterministic mock of its
// browser scroll root. No Chromium or external navigation is needed.
test('trusted source interaction restores virtualized sweep cursor',async()=>
{
  const file=fs.readFileSync(new URL('../render-probe.mjs',import.meta.url),'utf8');
  const start=file.indexOf('async function sweep(');
  const end=file.indexOf('\nasync function run(args)',start);
  assert.ok(start>=0 && end>start,'sweep source boundaries');
  const sweep=new Function('pause','performance',
    file.slice(start,end)+';return sweep;')(
    async()=>{}, {now:()=>0});
  let scrollTop=0,samples=0;
  const records=[];
  const cdp={closed:false,async send(method,params)
  {
    assert.equal(method,'Runtime.evaluate');
    const exp=params.expression;
    if(exp.startsWith('!!'))return {result:{value:true}};
    if(exp.includes('?.scrollTop'))return {result:{value:scrollTop}};
    if(exp.includes('const before=e.scrollTop;')){
      const match=/e\.scrollTop\+=(-?\d+)\*Math\.max/.exec(exp);
      assert.ok(match,'scroll direction');
      const before=scrollTop;
      scrollTop=Math.max(0,Math.min(780,scrollTop+Number(match[1])*260));
      return {result:{value:{before,after:scrollTop,height:1000,viewport:220}}};
    }
    const reset=/e\.scrollTop=(-?\d+(?:\.\d+)?);return/.exec(exp);
    assert.ok(reset,'restoration expression');
    scrollTop=Number(reset[1]);
    return {result:{value:{restored:scrollTop}}};
  }};
  const result=await sweep(cdp,'session',event=>records.push(event),
    async()=>{samples++;scrollTop=0;},null,()=>false,true);
  assert.deepEqual(result,{ready:true});
  const forwards=records.filter(e=>e.kind==='sweep.step'&&e.direction===1);
  const reverses=records.filter(e=>e.kind==='sweep.step'&&e.direction===-1);
  assert.ok(forwards.length>=8,'forward sweep reaches the end despite callback scrolls');
  assert.ok(reverses.length>=8,'reverse sweep reaches the start');
  assert.equal(scrollTop,0);
  assert.ok(samples>=forwards.length+reverses.length);
});
