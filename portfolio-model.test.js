const {test}=require('node:test');
const assert=require('node:assert/strict');
const {result,summary}=require('./portfolio-model.js');
const predictions=[{side:'up',outcome:'up',settled_at:200,payout_cents:10000,cost_cents:6200},{side:'down',outcome:'up',settled_at:200,payout_cents:0,cost_cents:3800},{side:'up',settled_at:null,cost_cents:5000,ends_at:500}];
test('wins and losses use settlement outcome, never current spot',()=>{assert.equal(result(predictions[0]),'won');assert.equal(result(predictions[1]),'lost');assert.equal(result(predictions[2],400000),'pending');assert.equal(result(predictions[2],500000),'settling');});
test('realized P/L excludes pending spend and win rate excludes pending orders',()=>{assert.deepEqual(summary(predictions),{wins:1,losses:1,pending:1,profitCents:0,pendingCostCents:5000,winRate:50});assert.deepEqual(summary([]),{wins:0,losses:0,pending:0,profitCents:0,pendingCostCents:0,winRate:null});});
test('zero payout is a settled loss, not a pending prediction',()=>{assert.equal(result({side:'up',outcome:'down',settled_at:0,payout_cents:0}),'lost');});

test('history sorts amounts numerically without mutating account order',()=>{
 const {sortPredictions}=require('./portfolio-model.js');
 const rows=[{cost_cents:900},{cost_cents:10000},{cost_cents:200}];
 assert.deepEqual(sortPredictions(rows,'cost','asc').map(p=>p.cost_cents),[200,900,10000]);
 assert.deepEqual(sortPredictions(rows,'cost','desc').map(p=>p.cost_cents),[10000,900,200]);
 assert.equal(rows[0].cost_cents,900);
});
test('history keeps pending returns last in both directions and includes zero payouts',()=>{
 const {sortPredictions}=require('./portfolio-model.js');
 for(const direction of ['asc','desc']){
  const sorted=sortPredictions(predictions,'return',direction);
  assert.equal(sorted.at(-1),predictions[2]);
  assert.equal(sorted[direction==='asc'?0:1].payout_cents,0);
 }
 assert.deepEqual(sortPredictions(predictions,'profit','asc'),[predictions[1],predictions[0],predictions[2]]);
});
test('history sorts dates, market intervals, direction, status, and benchmarks',()=>{
 const {sortPredictions}=require('./portfolio-model.js');
 const a={coin:'BTC',market_id:'60-0',side:'up',starts_at:10,ends_at:20,strike:100,settled_at:null};
 const b={coin:'BTC',market_id:'15-0',side:'down',starts_at:30,ends_at:40,strike:9,settled_at:50,outcome:'down'};
 for(const column of ['market','prediction','benchmark'])assert.deepEqual(sortPredictions([a,b],column,'asc'),[b,a]);
 assert.deepEqual(sortPredictions([a,b],'window','desc'),[b,a]);
 assert.deepEqual(sortPredictions([b,a],'status','asc',0),[a,b]);
});
