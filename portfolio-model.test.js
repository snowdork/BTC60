const {test}=require('node:test');
const assert=require('node:assert/strict');
const {result,summary}=require('./portfolio-model.js');
const predictions=[{side:'up',outcome:'up',settled_at:200,payout_cents:10000,cost_cents:6200},{side:'down',outcome:'up',settled_at:200,payout_cents:0,cost_cents:3800},{side:'up',settled_at:null,cost_cents:5000,ends_at:500}];
test('wins and losses use settlement outcome, never current spot',()=>{assert.equal(result(predictions[0]),'won');assert.equal(result(predictions[1]),'lost');assert.equal(result(predictions[2],400000),'pending');assert.equal(result(predictions[2],500000),'settling');});
test('realized P/L excludes pending spend and win rate excludes pending orders',()=>{assert.deepEqual(summary(predictions),{wins:1,losses:1,pending:1,profitCents:0,pendingCostCents:5000,winRate:50});assert.deepEqual(summary([]),{wins:0,losses:0,pending:0,profitCents:0,pendingCostCents:0,winRate:null});});
test('zero payout is a settled loss, not a pending prediction',()=>{assert.equal(result({side:'up',outcome:'down',settled_at:0,payout_cents:0}),'lost');});
