import assert from 'node:assert/strict';
import { evaluate } from './price-monitor.mjs';
import { toPriceObservations } from './wishlist-price-adapter.mjs';
import { readMonitorLists, planMonitorCells } from './price-monitor-sheet-adapter.mjs';

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
console.log('PoC 060 wishlist-to-monitor and workbook adapters: PASS');
