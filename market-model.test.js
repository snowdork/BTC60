const {test}=require('node:test');
const assert=require('node:assert/strict');
const {markets,quote,outcome}=require('./market-model.js');
test('one hour contains exactly 60, 30 and 15 minute markets',()=>{
 assert.deepEqual(markets.map(m=>m.minutes),[60,30,30,15,15,15,15]);
 for(const duration of [15,30,60]){const tier=markets.filter(m=>m.minutes===duration);assert.equal(tier[0].start,'17:00');assert.equal(tier.at(-1).end,'18:00');tier.slice(1).forEach((m,i)=>assert.equal(tier[i].end,m.start));}
});
test('binary outcome includes equal prices on Up',()=>{assert.equal(outcome(100,100),'up');assert.equal(outcome(100,101),'up');assert.equal(outcome(100,99.99),'down');});
test('whole-contract Up and Down costs respect budget',()=>{const m=markets.find(m=>m.id==='15-2');assert.deepEqual(quote(m,'up',50,14250),{cents:62,contracts:80,cost:49.6,payout:80,profit:30.4});assert.deepEqual(quote(m,'down',50,14250),{cents:38,contracts:131,cost:49.78,payout:131,profit:81.22});});
test('closed and upcoming markets cannot be traded',()=>{for(const m of markets.filter(m=>m.status!=='open'))assert.equal(quote(m,'up',50,14250),null);});
test('invalid budgets and insufficient balances cannot be quoted',()=>{const m=markets[0];for(const budget of [0,-1,NaN,Infinity,.99,14251])assert.equal(quote(m,'up',budget,14250),null);assert.equal(quote(m,'other',50,14250),null);assert.equal(quote(m,'up',50,49),null);});
test('all quotes preserve funds and settle to one dollar per contract',()=>{for(const m of markets.filter(m=>m.status==='open'))for(const side of ['up','down'])for(const budget of [1,10,25,50,100,250,14250]){const q=quote(m,side,budget,14250);assert(q.cost<=budget);assert.equal(q.payout,q.contracts);assert.equal(Math.round((q.payout-q.cost)*100),Math.round(q.profit*100));}});
test('market without a loaded benchmark cannot accept a prediction',()=>{assert.equal(quote({...markets[0],strike:null},'up',50,14250),null);});
