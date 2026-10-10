import {performance} from 'node:perf_hooks';
import {FlatDocument,PieceDocument} from './src/documents.mjs';
const sizes=process.argv.slice(2).map(Number).filter(x=>x>0);
const MiB=1024*1024;
function bench(T,bytes,edits) {
  let s=('0123456789abcdef'.repeat(31)+'\n').repeat(Math.ceil(bytes/497)).slice(0,bytes);
  if(global.gc)global.gc();
  const baseline=process.memoryUsage();
  const start=performance.now();const d=new T(s);const initMs=performance.now()-start;
  s=null;if(global.gc)global.gc();
  const afterInit=process.memoryUsage();
  let seed=0xabcdef01;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  const t0=performance.now();
  for(let i=0;i<edits;i++){const p=rand()%(d.length+1);d.replace(p,p,'X');}
  const editsMs=performance.now()-t0;
  const t1=performance.now();let sum=0;
  for(let i=0;i<1000;i++){const p=rand()%(d.length-20);sum+=d.slice(p,p+20).length;}
  const readsMs=performance.now()-t1;
  if(global.gc)global.gc();const mem=process.memoryUsage();
  return {structure:T.name,bytes,edits,initMs:+initMs.toFixed(2),editsMs:+editsMs.toFixed(2),
    readsMs:+readsMs.toFixed(2),totalLength:d.length,readChecksum:sum,
    heapDeltaMiB:+((mem.heapUsed-baseline.heapUsed)/MiB).toFixed(2),
    rssDeltaMiB:+((mem.rss-baseline.rss)/MiB).toFixed(2),
    heapAfterInitMiB:+((afterInit.heapUsed-baseline.heapUsed)/MiB).toFixed(2),
    stats:d.stats?.()};
}
for(const bytes of sizes.length?sizes.map(x=>Math.floor(x*MiB)):[1*MiB,8*MiB]) {
  for(const T of [FlatDocument,PieceDocument]){
    try{console.log(JSON.stringify(bench(T,bytes,500)));}
    catch(e){console.log(JSON.stringify({structure:T.name,bytes,error:String(e)}));process.exitCode=1;}
    if(global.gc)global.gc();
  }
}
