import assert from 'node:assert/strict';
import { evaluate } from './price-monitor.mjs';
import { toPriceObservations } from './wishlist-price-adapter.mjs';
import { readMonitorLists, planMonitorCells } from './price-monitor-sheet-adapter.mjs';
import { reconcileMonitorLists } from './price-monitor-membership.mjs';

const asin = 'B012345678';
const headers = ['ASIN','Descrizione','Prezzo attuale (€)','Differenza dal precedente (€)',
  'Prezzo minimo monitorato (€)','Target (€)','Scostamento (€)','Stato',
  'Nota Amazon','URL Amazon','Ultimo controllo','Target notificato (€)'];
const tabs = [{name:'Watch',values:[headers,[
  asin,'Test product','€ 20,00','€ 0,00','€ 19,00','€ 15,00',
  'formula-G','formula-H','user note','https://www.amazon.it/dp/'+asin,'old',null]]}];
const lists = readMonitorLists(tabs);
assert.equal(lists[0].rows[0].currentCents,2000);
assert.equal(lists[0].rows[0].targetCents,1500);
assert.equal(lists[0].rows[0].sheetRow,2);
assert.equal(lists[0].rows[0].url, 'https://www.amazon.it/dp/'+asin);

const observation = { complete:true,blocked:false,itemCount:1,items:[{
  asin,price:{verified:true,currency:'EUR',cents:1400},purchaseAction:'add-to-cart'
}]};
const extracted = toPriceObservations(observation);
assert.equal(extracted.accessFailure,false);
assert.equal(extracted.verified,1);
const decision = evaluate({lists,observations:extracted.observations,checkedAt:'2026-10-11 12:00'});
assert.equal(decision.failed,false);
assert.ok(decision.alerts[0].notificationAcknowledgement);
assert.equal(decision.alerts[0].sheetRow,2);
const beforeEmail = planMonitorCells(lists,decision);
assert.deepEqual(beforeEmail.map(c=>c.column),['C','D','E','K']);
assert.equal(beforeEmail[0].value,14);
assert.equal(beforeEmail[1].value,-6);
assert.equal(beforeEmail[2].value,14);
const afterEmail = planMonitorCells(lists,decision,{alertEmailSucceeded:true});
assert.deepEqual(afterEmail.map(c=>c.column),['C','D','E','K','L']);
assert.equal(afterEmail.at(-1).value,15);
assert.ok(afterEmail.every(c=>!['A','B','F','G','H','I','J'].includes(c.column)));

const bad = toPriceObservations({...observation,complete:false});
assert.equal(bad.accessFailure,true);
assert.equal(bad.observations.length,0);
const unpriced=toPriceObservations({...observation,items:[{asin,price:{
  verified:false,reason:'price-unavailable'},purchaseAction:'view-all-options'}]});
assert.equal(unpriced.verified,0);
assert.equal(unpriced.observations[0].verified,false);
const noPrice=evaluate({lists,observations:unpriced.observations,checkedAt:'2026-10-11 12:00'});
assert.equal(noPrice.failed,true);
assert.deepEqual(planMonitorCells(lists,noPrice),[]);
assert.throws(()=>readMonitorLists([{name:'Watch',values:[headers,
  ...[tabs[0].values[1],tabs[0].values[1]]]}]),/repeated ASIN/);
assert.throws(()=>readMonitorLists([{name:'Watch',values:[['WRONG']]}]),/schema/);

const addedAsin='B999999999';
const currentMembership=reconcileMonitorLists(lists,new Map([['Watch',[
  { asin: addedAsin, verified:true, priceCents:1299,
    description:'New product',url:'https://www.amazon.it/dp/'+addedAsin }
]]]));
assert.equal(currentMembership[0].rows.length,1);
assert.equal(currentMembership[0].rows[0].sheetRow,3);
assert.equal(currentMembership[0].rows[0].isNew,true);
const newDecision=evaluate({lists:currentMembership,observations:[{
  list:'Watch', asin:addedAsin, verified:true,priceCents:1299
}],checkedAt:'2026-10-11 12:00'});
assert.equal(newDecision.failed,false);
const newPlan=planMonitorCells(currentMembership,newDecision);
assert.ok(newPlan.some(c=>c.column==='A'&&c.value===addedAsin));
assert.ok(newPlan.some(c=>c.column==='B'&&c.value==='New product'));
assert.ok(newPlan.some(c=>c.column==='J'&&c.value.includes(addedAsin)));
assert.ok(newPlan.some(c=>c.column==='G'&&c.copyFormulaFromRow===2));
assert.ok(newPlan.some(c=>c.column==='H'&&c.copyFormulaFromRow===2));
assert.equal(newPlan.filter(c=>c.column==='C')[0].value,12.99);
assert.ok(!newPlan.some(c=>c.row===2));
const unverifiedList=reconcileMonitorLists(lists,new Map([['Watch',[
  { asin: addedAsin, verified:false, description:'Unavailable' }
]]]));
const unknownDecision=evaluate({lists:unverifiedList,
  observations:[{list:'Watch',asin:addedAsin,verified:false}],
  checkedAt:'2026-10-11 12:00'});
assert.equal(unknownDecision.failed,true);
assert.deepEqual(planMonitorCells(unverifiedList,unknownDecision),[]);
console.log('PoC 060 wishlist-to-monitor and workbook adapters: PASS');
