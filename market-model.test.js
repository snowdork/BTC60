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
const {estimateChances,minuteVolatility}=require('./market-model.js');
test('chance model is centered on the benchmark and complements to 100',()=>{const m={status:'open',strike:100,endsAt:900000};assert.deepEqual(estimateChances(m,100,0,.001),{up:50,down:50,label:'ESTIMATE'});for(const spot of [90,99.9,100,100.1,110]){const p=estimateChances(m,spot,0,.001);assert.equal(p.up+p.down,100);assert(p.up>=1&&p.up<=99);if(spot>100)assert(p.up>50);if(spot<100)assert(p.up<50);}});
test('less time or lower volatility makes a price displacement more decisive',()=>{const m={status:'open',strike:100,endsAt:3600000};const long=estimateChances(m,100.1,0,.001);assert(estimateChances(m,100.1,3000000,.001).up>long.up);assert(estimateChances(m,100.1,0,.0002).up>long.up);});
test('chance model is independent of coin price units',()=>{const a=estimateChances({status:'open',strike:100,endsAt:900000},100.1,0,.001);const b=estimateChances({status:'open',strike:.1,endsAt:900000},.1001,0,.001);assert.equal(a.up,b.up);});
test('queued baseline and completed outcomes are distinguished from estimates',()=>{assert.deepEqual(estimateChances({status:'queued'},NaN,0),{up:50,down:50,label:'BASELINE'});assert.deepEqual(estimateChances({status:'settled',strike:100,close:100},NaN,0),{up:100,down:0,label:'RESULT'});assert.deepEqual(estimateChances({status:'settled',strike:100,close:99},NaN,0),{up:0,down:100,label:'RESULT'});assert.equal(estimateChances({status:'open',strike:100,endsAt:100},NaN,0),null);assert.equal(estimateChances({status:'open',strike:100,endsAt:100},100,100),null);});
test('volatility uses only completed consecutive minute candles',()=>{const candles=[[0,0,0,0,100],[60,0,0,0,101],[120,0,0,0,1000]];const sigma=minuteVolatility(candles,120000);assert(Math.abs(sigma-Math.log(1.01))<1e-10);assert.equal(minuteVolatility([],120000),.0001);assert.equal(minuteVolatility([[0,0,0,0,100],[120,0,0,0,1000]],180000),.0001);});

test('each interval opens at 50/50 then follows price movement',()=>{for(const minutes of [15,30,60]){const m={status:'open',strike:100,startsAt:60000,endsAt:60000+minutes*60000};for(const now of [60000,60250,60999])assert.deepEqual(estimateChances(m,101,now,.001),{up:50,down:50,label:'BASELINE'});assert(estimateChances(m,101,61000,.001).up>50);assert(estimateChances(m,99,61000,.001).down>50);}});

const {dataStatus,configure}=require('./market-model.js');
test('prediction gate requires fresh connected data, benchmark and server quote',()=>{
 const now=100000,market={status:'open',strike:100,up:62,endsAt:200000},model={feedMode:'live',feedConnection:'connected',spot:101,priceUpdatedAt:now,historyStatus:'ready',quoteReady:true};
 assert.equal(dataStatus(model,market,now).ready,true);
 for(const override of [{feedConnection:'disconnected'},{priceUpdatedAt:now-15001},{priceUpdatedAt:now+5001},{priceUpdatedAt:0},{spot:NaN},{historyStatus:'error'},{quoteReady:false},{paused:true},{isHistorical:true},{feedMode:'demo'}])assert.equal(dataStatus({...model,...override},market,now).ready,false);
 assert.equal(dataStatus(model,{...market,strike:null},now).ready,false);
 assert.equal(dataStatus(model,{...market,endsAt:now},now).ready,false);
 assert.equal(dataStatus(model,{...market,status:'queued'},now).ready,false);
});
test('purchase prices are configured by server, independently of model chances',()=>{
 const model=require('./market-model.js'),quotes=Object.fromEntries(model.markets.map(m=>[m.id,55]));
 configure({quotes,settlement:{version:'coinbase-minute-close-v1'}});
 assert(model.markets.every(m=>m.up===55));assert.equal(model.quoteReady,true);
 assert.equal(quote({...model.markets[0],status:'open',strike:100},'up',50,100).cents,55);
 assert.equal(estimateChances({status:'open',strike:100,endsAt:100000},100,0).up,50);
 assert.throws(()=>configure({quotes:{}}));
});
