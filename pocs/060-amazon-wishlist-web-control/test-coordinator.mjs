import assert from 'node:assert/strict';
import { runPriceWatch } from './price-watch-coordinator.mjs';

const a='B012345678', b='B998877665';
const headers=['ASIN','Descrizione','Prezzo attuale (€)','Differenza dal precedente (€)',
  'Prezzo minimo monitorato (€)','Target (€)','Scostamento (€)','Stato','Nota Amazon',
  'URL Amazon','Ultimo controllo','Target notificato (€)'];
const tabs=[
  {name:'Watch',values:[headers,[a,'Synthetic A',20,null,19,15,null,null,'keep','https://www.amazon.it/dp/'+a,'old',null]]},
  {name:'Star Wars',values:[headers,[b,'Synthetic B',10,null,10,8,null,null,'keep','https://www.amazon.it/dp/'+b,'old',null]]}
];
const sources=[{name:'Watch',wishlistUrl:'https://www.amazon.it/hz/wishlist/ls/AAA'},
  {name:'Star Wars',wishlistUrl:'https://www.amazon.it/hz/wishlist/ls/BBB'}];
const response=(asin,price)=>({complete:true,blocked:false,itemCount:1,
  items:[{asin,price:price==null?{verified:false,reason:'unavailable'}:
  {verified:true,currency:'EUR',cents:price}}]});
async function run({priceB=null,sendError=false,sendAlert=true}={}) {
  const mails=[],writes=[];
  const io={
    readTabs:async()=>tabs,
    extractWishlist:async url=>response(url.endsWith('AAA')?a:b,
      url.endsWith('AAA')?1400:priceB),
    sendEmail:async mail=>{mails.push(mail);return {success:
      mail.subject.includes('non accessibili')?sendError:sendAlert}},
    applyCells:async cells=>{writes.push(...cells)}
  };
  const result=await runPriceWatch({sources,io,checkedAt:'2026-10-11 12:00'});
  return {result,mails,writes};
}
let trial=await run();
assert.equal(trial.result.decision.failed,true);
assert.equal(trial.result.delivery.errorSent,false);
assert.equal(trial.result.delivery.alertSent,true);
assert.equal(trial.result.delivery.errors.length,1);
assert.equal(trial.mails.length,2);
assert.ok(trial.mails.some(m=>m.subject.includes('non accessibili')));
assert.ok(trial.mails.some(m=>m.html.includes('B012345678') &&
  m.html.includes('https://www.amazon.it/dp/B012345678')));
assert.ok(trial.writes.some(c=>c.column==='L'&&c.value===15));
assert.ok(!trial.writes.some(c=>c.sheet==='Star Wars'));
assert.ok(trial.writes.every(c=>!['F','G','H','I'].includes(c.column)));
trial=await run({sendAlert:false});
assert.equal(trial.result.delivery.alertSent,false);
assert.ok(!trial.writes.some(c=>c.column==='L'));
trial=await run({priceB:950,sendError:true});
assert.equal(trial.result.decision.failed,false);
assert.equal(trial.mails.some(m=>m.subject.includes('non accessibili')),false);
assert.equal(trial.mails.length,1);
assert.equal(trial.result.sheetUpdated,true);
await assert.rejects(()=>runPriceWatch({
  sources:[sources[0]],io:{readTabs:async()=>tabs,
  extractWishlist:async()=>null,sendEmail:async()=>({success:true}),
  applyCells:async()=>{}}
}),/exactly one/);
console.log('PoC 060 coordinator delivery acknowledgement and reports: PASS');
