#!/usr/bin/env node
// Experimental performance measurements only. No performance thresholds or product claims.
// m.Class source is loaded verbatim from a separate upstream checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function arg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const classFile = arg('--class-file');
if (!classFile) throw new Error('Use --class-file /path/to/js/lib/js/m/Class.js');
const originalSource = fs.readFileSync(classFile, 'utf8');
const Class = new Function(originalSource + '\nreturn Class;')();
const CHECK = (ok, message) => { if (!ok) throw new Error(message); };
const gc = () => { if (!global.gc) throw new Error('Run Node with --expose-gc'); global.gc(); global.gc(); };
const now = () => process.hrtime.bigint();
const ms = ns => Number(ns) / 1e6;
function median(a) { const s = [...a].sort((x,y) => x-y); return s[Math.floor(s.length/2)]; }
function round(n) { return Math.round(n * 1000) / 1000; }

function fixture(variant, kind) {
  if (kind === 'basic') {
    if (variant === 'native') return class Native {
      constructor(x,y) { this.x=x; this.y=y; }
      calc() { return this.x + this.y; }
    };
    if (variant === 'prototype') {
      function Proto(x,y) { this.x=x; this.y=y; }
      Proto.prototype.calc = function() { return this.x + this.y; };
      return Proto;
    }
    return Class().method('construct', function(x,y) { this.x=x; this.y=y; })
      .method('calc', function() { return this.x + this.y; }).get();
  }
  if (kind === 'composed') {
    if (variant === 'native') return class Native {
      constructor(x) { this.options={a:1,b:2,c:3}; this.x=x; }
      calc() { return this.x + this.options.a; }
    };
    return Class().compose('options', {a:1,b:2,c:3})
      .method('construct', function(x) { this.x=x; })
      .method('calc', function() { return this.x + this.options.a; }).get();
  }
  if (kind === 'inherited') {
    if (variant === 'native') {
      class Base { constructor() { this.base=10; } baseCalc() { return this.base+1; } }
      return class Child extends Base { constructor(x) { super(); this.x=x; }
        calc() { return this.baseCalc() + this.x; } };
    }
    const Base=Class().method('construct', function() { this.base=10; })
      .method('baseCalc', function() { return this.base+1; }).get();
    return Class().inherit(Base, true)
      .method('construct', function(x) { this.x=x; })
      .method('calc', function() { return this.baseCalc() + this.x; }).get();
  }
  if (kind === 'observed') {
    if (variant === 'native') return class Native {
      constructor() { this._property_value=0; this.hits=0; }
      get value() { return this._property_value; }
      set value(x) { this._property_value=x+1; this.hits++; }
    };
    return Class().property('value', 0, undefined, function(x) { return x+1; },
      function() { this.hits=(this.hits||0)+1; }).get();
  }
  if (kind === 'trigger') {
    if (variant === 'native') return class Native {
      constructor() { this.x=0;this.hits=0; }
      add(v) { this.hits++; this.x+=v; return this.x; }
    };
    return Class().method('construct', function() { this.x=0; this.hits=0; })
      .method('add', function(v) { this.x+=v; return this.x; })
      .trigger('add', function() { this.hits++; }, true).get();
  }
  throw new Error('Unknown fixture: ' + kind);
}

function timedSamples(kind, variant, n, rounds, run) {
  const samples=[], checks=[];
  for (let i=-2; i<rounds; i++) {
    gc();
    const start=now();
    const checksum=run(n);
    const elapsed=ms(now()-start);
    CHECK(Number.isFinite(checksum), 'Missing checksum');
    if (i>=0) { samples.push(round(elapsed)); checks.push(checksum); }
  }
  return {scenario:kind, variant, iterations:n, samples_ms:samples,
    median_ms:round(median(samples)), minimum_ms:round(Math.min(...samples)),
    maximum_ms:round(Math.max(...samples)), checksum:checks[0]};
}

function runTimed(scenario, variant) {
  if (scenario==='definition') {
    return timedSamples(scenario,variant,3500,7,n=>{
      const defs = new Array(n);
      if (variant==='native') {
        for(let i=0;i<n;i++) defs[i]=class Native {
          constructor(x) { this.x=x; } calc() { return this.x+1; } };
      } else {
        for(let i=0;i<n;i++) defs[i]=Class()
          .method('construct', function(x) { this.x=x; })
          .method('calc', function() { return this.x+1; }).get();
      }
      CHECK(new defs[n-1](8).calc()===9,'bad class definition');
      return defs.length + new defs[0](8).calc();
    });
  }
  if (scenario==='construction-basic' || scenario==='construction-composed' ||
      scenario==='construction-inherited') {
    const kind=scenario.slice('construction-'.length), Type=fixture(variant,kind);
    CHECK(new Type(5,6).calc() === (kind==='inherited'?16:kind==='composed'?6:11), 'construction setup');
    return timedSamples(scenario,variant,130000,7,n=>{
      const objects=new Array(n);
      for(let i=0;i<n;i++) objects[i]=new Type(i,1);
      const expected=(kind==='inherited'?n+10:kind==='composed'?n:n+1);
      CHECK(objects[n-1].calc()===expected,'incorrect constructed state');
      return objects[n-1].calc()+objects[0].calc()+objects.length;
    });
  }
  if (scenario==='call-method' || scenario==='read-field') {
    const Type=fixture(variant,'basic');
    const objects=Array.from({length:256},(_,i)=>new Type(i,1));
    const method=(scenario==='call-method');
    return timedSamples(scenario,variant,6000000,7,n=>{
      let total=0;
      if(method) { for(let i=0;i<n;i++) total+=objects[i&255].calc(); }
      else { for(let i=0;i<n;i++) total+=objects[i&255].x; }
      return total;
    });
  }
  if (scenario==='observed-property') {
    const Type=fixture(variant,'observed');
    const instance=new Type();
    return timedSamples(scenario,variant,400000,7,n=>{
      let total=0;
      if (variant==='native') {
        for(let i=0;i<n;i++) { instance.value=i; total+=instance.value; }
      } else {
        for(let i=0;i<n;i++) { instance.value(i); total+=instance.value(); }
      }
      CHECK(instance.hits>0,'listener not called');
      return total;
    });
  }
  if (scenario==='method-trigger') {
    const Type=fixture(variant,'trigger'), object=new Type();
    return timedSamples(scenario,variant,1200000,7,n=>{
      let total=0;
      for(let i=0;i<n;i++) total+=object.add(1)&7;
      CHECK(object.hits===object.x,'trigger not fired');
      return total;
    });
  }
  throw new Error('Unknown timed scenario: '+scenario);
}

function measureMemory(scenario,variant) {
  const kind=scenario==='memory-basic'?'basic':
    scenario==='memory-composed'?'composed':'inherited';
  const count=scenario==='stress-1m'?1000000:650000;
  const Type=fixture(variant,kind);
  const warm=Array.from({length:25000},(_,i)=>new Type(i,1));
  CHECK(warm[0] && typeof warm[0].calc==='function','invalid memory fixture');
  gc();
  let arr=new Array(count);
  globalThis._retained=arr;
  gc();
  const baseline=process.memoryUsage();
  const start=now();
  for(let i=0;i<count;i++) arr[i]=new Type(i,1);
  const construction_ms=ms(now()-start);
  const expected=(kind==='inherited'?count+10:kind==='composed'?count:count+1);
  CHECK(arr[count-1].calc()===expected,'memory object incorrect');
  gc();
  const alive=process.memoryUsage();
  const deltaHeap=alive.heapUsed-baseline.heapUsed;
  const deltaRSS=alive.rss-baseline.rss;
  const own=Object.getOwnPropertyNames(arr[0]);
  let churn_ms=null, churnPeakHeap=null, gc_ms=null;
  if (scenario==='stress-1m') {
    const time=now();
    for(let k=0;k<10;k++) {
      let temporary=new Array(65000);
      for(let i=0;i<temporary.length;i++)temporary[i]=new Type(i+k,1);
      CHECK(temporary[123].calc()!==undefined,'bad temporary object');
      temporary=null;
    }
    churn_ms=round(ms(now()-time));
    const gcStart=now(); gc(); gc_ms=round(ms(now()-gcStart));
    churnPeakHeap=process.memoryUsage().heapUsed;
  }
  globalThis._retained=null;arr=null;gc();
  const after=process.memoryUsage();
  return {scenario,variant,count,construction_ms:round(construction_ms),
    live_heap_delta_bytes:deltaHeap,per_instance_heap_bytes:round(deltaHeap/count),
    live_rss_delta_bytes:deltaRSS,post_release_heap_bytes:after.heapUsed,
    retained_heap_bytes:alive.heapUsed,own_properties:own,
    churn_ms,churn_gc_ms:gc_ms,churn_post_gc_heap_bytes:churnPeakHeap};
}

const timedScenarios=[
  ['construction-basic',['native','prototype','m.Class']],
  ['call-method',['native','prototype','m.Class']],
  ['read-field',['native','prototype','m.Class']],
  ['definition',['native','m.Class']],
  ['construction-composed',['native','m.Class']],
  ['construction-inherited',['native','m.Class']],
  ['observed-property',['native','m.Class']],
  ['method-trigger',['native','m.Class']]
];
const memoryScenarios=[
  ['memory-basic',['native','prototype','m.Class']],
  ['memory-composed',['native','m.Class']],
  ['memory-inherited',['native','m.Class']],
  ['stress-1m',['native','m.Class']]
];
const worker=arg('--worker');
if (worker) {
  const variant=arg('--variant');
  const result=worker.startsWith('memory-')||worker==='stress-1m'?
    measureMemory(worker,variant):runTimed(worker,variant);
  process.stdout.write(JSON.stringify(result)+'\n');
} else {
  const results=[],errors=[];
  const scenarios=[...timedScenarios,...memoryScenarios];
  for (const [scenario,variants] of scenarios) {
    for (const variant of variants) {
      const child=spawnSync(process.execPath,
        ['--expose-gc',path.resolve(process.argv[1]),'--class-file',classFile,
          '--worker',scenario,'--variant',variant],
        {encoding:'utf8',timeout:120000,maxBuffer:1024*1024*2});
      if(child.status!==0 || child.error) {
        const error={scenario,variant,status:child.status,
          detail:String(child.error||child.stderr||child.stdout).slice(0,1800)};
        errors.push(error);console.log('@@ERROR@@'+JSON.stringify(error));
        continue;
      }
      try {
        const record=JSON.parse(child.stdout.trim());
        results.push(record);
        console.log('@@RESULT@@'+JSON.stringify(record));
      } catch(e) {
        const error={scenario,variant,detail:String(e)+': '+child.stdout.slice(0,600)};
        errors.push(error);console.log('@@ERROR@@'+JSON.stringify(error));
      }
    }
  }
  const record={metadata:{
    timestamp:new Date().toISOString(),node:process.version,v8:process.versions.v8,
    platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,
    classFile,sourceBytes:Buffer.byteLength(originalSource),
    gc:'forced before samples and after retained allocations',
    sampling:'7 timed samples after 2 warm-up samples; separate Node worker per variant',
    note:'Experimental benchmark, timings depend on JIT, GC and host load'
  },results,errors};
  fs.writeFileSync(arg('--output','benchmark-results.json'),JSON.stringify(record,null,2)+'\n');
  console.log('@@SUMMARY@@'+JSON.stringify({results:results.length,errors:errors.length}));
  if(errors.length) process.exitCode=1;
}
