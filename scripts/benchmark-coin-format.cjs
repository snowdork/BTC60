/** @module benchmark-coin-format
 * Measure repeated price formatting and optionally verify an earlier catalog implementation.
 */
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const records=require('../src/seeds/coins.seed.json');
const current=require('../src/frontend/coins.js').createCatalog(records);
const baseline=process.argv[2]?require(path.resolve(process.argv[2])).createCatalog(records):null;
const cases=current.available.flatMap(coin=>[0,-0,.000123456789,67450.125,-1234.567,1e12,NaN].map(value=>[value,coin.symbol]));
/** Measure the median time for 10,000 displayed prices after warming formatters. */
function measure(catalog){
 for(let i=0;i<1000;i++)catalog.formatPrice(...cases[i%cases.length]);
 const runs=[];
 for(let run=0;run<7;run++){
  const start=performance.now();
  for(let i=0;i<10000;i++)catalog.formatPrice(...cases[i%cases.length]);
  runs.push(performance.now()-start);
 }
 return Number(runs.sort((a,b)=>a-b)[3].toFixed(3));
}
if(baseline)for(const args of cases)assert.equal(current.formatPrice(...args),baseline.formatPrice(...args));
console.log(JSON.stringify({fixture:'10,000 prices across the default ten-coin catalog; seven runs after warm-up',
 ...(baseline?{baselineMs:measure(baseline)}:{}),currentMs:measure(current),
 ...(baseline?{outputsEqual:true}:{})},null,2));
