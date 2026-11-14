/** @module benchmark-market-model
 * Measure chart preparation on synthetic history; optionally compare an earlier model file.
 */
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const current=require('../src/frontend/market-model.js');
const baseline=process.argv[2]?require(path.resolve(process.argv[2])):null;
const hour=Date.UTC(2026,10,13,17),now=hour+3599250;
const candles=Array.from({length:1440},(_,i)=>{
 const t=hour/1000+(i-1380)*60,open=100000+Math.sin(i/7)*100;
 return [t,open-20,open+30,open,open+10,1];
});
const seconds=Array.from({length:3600},(_,i)=>({t:hour+i*1000,price:100000+Math.sin(i/13)*100}));
const cases=[5,15,30,60].map(minutes=>[candles,hour+(60-minutes)*60000,hour+3600000,now,{t:now-250,price:100050},seconds]);
/** Return median local time per plotted interval after warming the model. */
function measure(model){
 for(let i=0;i<100;i++)model.minutePlot(...cases[i%cases.length]);
 const runs=[];
 for(let run=0;run<7;run++){
  const start=performance.now();
  for(let i=0;i<400;i++)model.minutePlot(...cases[i%cases.length]);
  runs.push((performance.now()-start)/400);
 }
 return Number(runs.sort((a,b)=>a-b)[Math.floor(runs.length/2)].toFixed(4));
}
if(baseline)for(const args of cases)assert.deepEqual(current.minutePlot(...args),baseline.minutePlot(...args));
console.log(JSON.stringify({fixture:'1440 minute candles, 3600 recorded seconds; 5/15/30/60-minute intervals',
 ...(baseline?{baselineMsPerPlot:measure(baseline)}:{}),currentMsPerPlot:measure(current),
 ...(baseline?{outputsEqual:true}:{})},null,2));
