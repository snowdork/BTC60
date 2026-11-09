const {test}=require('node:test');
const assert=require('node:assert/strict');
const {markets,quote,outcome}=require('../../src/frontend/market-model.js');
test('one hour contains only 60, 30, 15 and 5 minute markets',()=>{
 assert.deepEqual(markets.map(m=>m.minutes),[60,30,30,15,15,15,15,...Array(12).fill(5)]);
 for(const duration of [5,15,30,60]){const tier=markets.filter(m=>m.minutes===duration);assert.equal(tier[0].start,'17:00');assert.equal(tier.at(-1).end,'18:00');tier.slice(1).forEach((m,i)=>assert.equal(tier[i].end,m.start));}
});
test('detail intervals preserve exact UTC benchmarks across midnight',()=>{
 const {adjacentMarkets}=require('../../src/frontend/market-model.js');
 const start=Date.UTC(2026,10,3),now=start+30000;
 const candles=[[-360,-1],[-60,100],[0,999]].map(([offset,close])=>[(start/1000)+offset,90,1000,100,close]);
 const [last,current,next]=adjacentMarkets(5,now,now,candles);
 assert.equal(last.start,'23:55');assert.equal(last.end,'00:00');assert.equal(last.id,'5-11');
 assert.equal(last.startsAt,start-300000);assert.equal(last.close,100);
 assert.equal(current.start,'00:00');assert.equal(current.id,'5-0');assert.equal(current.strike,100);
 assert.equal(current.close,null,'the current incomplete minute cannot settle an interval');
 assert.equal(next.start,'00:05');assert.equal(next.status,'queued');assert.equal(next.strike,null);
});
test('missing exact detail boundaries never inherit a nearby candle',()=>{
 const {adjacentMarkets}=require('../../src/frontend/market-model.js');
 const [last,current]=adjacentMarkets(5,330000,330000,[[180,90,110,100,105]]);
 assert.equal(last.close,null);assert.equal(current.strike,null);
});
test('minute graphs preserve highs/lows, omit incomplete candles, and split missing minutes',()=>{
 const {minutePlot}=require('../../src/frontend/market-model.js');
 const candles=[[-60,99,101,100,100],[0,95,110,100,105],[120,90,106,105,95],[180,1,1000,95,900]];
 const plot=minutePlot(candles,0,300000,190000);
 assert.equal(plot.count,2);assert.equal((plot.line.match(/M/g)||[]).length,2);
 assert.doesNotMatch(plot.line,/C/);assert(plot.up);assert(plot.down);
 assert(plot.low<90&&plot.low>80);assert(plot.high>110&&plot.high<120);
 assert.equal(plot.tip.price,95);
 const live=minutePlot(candles,0,300000,190000,{t:190000,price:98});
 assert.equal(live.tip.price,98);assert.equal(live.count,2);assert.equal(live.tip.x,190000/300000*1000);
 assert.equal(minutePlot(candles,300000,600000,190000).line,'','future intervals have no plotted values');
});

test('an active graph endpoint stays on display time between quotes and across slightly ahead provider timestamps',()=>{
 const {minutePlot}=require('../../src/frontend/market-model.js');
 const candles=[[-60,99,101,100,100],[0,99,103,100,102]],start=0,end=300000;
 for(const now of [90000,91000,92000]){
  for(const t of [89000,now+250]){
   const plot=minutePlot(candles,start,end,now,{t,price:104});
   assert.equal(plot.tip.price,104);
   assert.equal(plot.tip.x,now/end*1000);
  }
 }
 const closed=minutePlot(candles,start,60000,90000,{t:90000,price:500});
 assert.equal(closed.tip.price,102,'completed intervals use the exact closing candle');
 assert.equal(closed.tip.x,1000);
 const invalid=minutePlot(candles,start,end,90000,{t:96000,price:500});
 assert.equal(invalid.tip.price,102,'a quote beyond the accepted clock skew is not plotted');
});

test('a newly closed candle takes precedence over an older quote at the live edge',()=>{
 const {minutePlot}=require('../../src/frontend/market-model.js');
 const candles=[[-60,99,101,100,100],[0,99,103,100,102]];
 const plot=minutePlot(candles,0,300000,61000,{t:59500,price:101});
 assert.equal(plot.tip.price,102);
 assert.equal(plot.tip.x,61000/300000*1000);
});
test('binary outcome includes equal prices on Up',()=>{assert.equal(outcome(100,100),'up');assert.equal(outcome(100,101),'up');assert.equal(outcome(100,99.99),'down');});
test('fractional shares use the full budget with upward penny payout rounding',()=>{const m=markets.find(m=>m.id==='15-2');assert.deepEqual(quote(m,'up',50,14250),{cents:62,contracts:5000/62,cost:50,payout:80.65,profit:30.65});assert.deepEqual(quote(m,'down',50,14250),{cents:38,contracts:5000/38,cost:50,payout:131.58,profit:81.58});});
test('closed and upcoming markets cannot be traded',()=>{for(const m of markets.filter(m=>m.status!=='open'))assert.equal(quote(m,'up',50,14250),null);});
test('invalid budgets and insufficient balances cannot be quoted',()=>{const m=markets[0];for(const budget of [0,-1,NaN,Infinity,.99,14251])assert.equal(quote(m,'up',budget,14250),null);assert.equal(quote(m,'other',50,14250),null);assert.equal(quote(m,'up',50,49),null);});
test('all quotes preserve funds and settle to one credit per contract',()=>{for(const m of markets.filter(m=>m.status==='open'))for(const side of ['up','down'])for(const budget of [1,10,25,50,100,250,1000]){const q=quote(m,side,budget,14250);assert(q.cost<=budget);assert.equal(q.cost,budget);assert(q.payout>=q.contracts);assert(q.payout-q.contracts<.010001);assert.equal(Math.round((q.payout-q.cost)*100),Math.round(q.profit*100));}});
test('market without a loaded benchmark cannot accept a prediction',()=>{assert.equal(quote({...markets[0],strike:null},'up',50,14250),null);});
const {estimateChances,minuteVolatility}=require('../../src/frontend/market-model.js');
test('chance model is centered on the benchmark and complements to 100',()=>{const m={status:'open',strike:100,endsAt:900000};assert.deepEqual(estimateChances(m,100,0,.001),{up:50,down:50,label:'ESTIMATE'});for(const spot of [90,99.9,100,100.1,110]){const p=estimateChances(m,spot,0,.001);assert.equal(p.up+p.down,100);assert(p.up>=1&&p.up<=99);if(spot>100)assert(p.up>50);if(spot<100)assert(p.up<50);}});
test('less time or lower volatility makes a price displacement more decisive',()=>{const m={status:'open',strike:100,endsAt:3600000};const long=estimateChances(m,100.1,0,.001);assert(estimateChances(m,100.1,3000000,.001).up>long.up);assert(estimateChances(m,100.1,0,.0002).up>long.up);});
test('chance model is independent of coin price units',()=>{const a=estimateChances({status:'open',strike:100,endsAt:900000},100.1,0,.001);const b=estimateChances({status:'open',strike:.1,endsAt:900000},.1001,0,.001);assert.equal(a.up,b.up);});
test('queued baseline and completed outcomes are distinguished from estimates',()=>{assert.deepEqual(estimateChances({status:'queued'},NaN,0),{up:50,down:50,label:'BASELINE'});assert.deepEqual(estimateChances({status:'settled',strike:100,close:100},NaN,0),{up:100,down:0,label:'RESULT'});assert.deepEqual(estimateChances({status:'settled',strike:100,close:99},NaN,0),{up:0,down:100,label:'RESULT'});assert.equal(estimateChances({status:'open',strike:100,endsAt:100},NaN,0),null);assert.equal(estimateChances({status:'open',strike:100,endsAt:100},100,100),null);});
test('volatility uses only completed consecutive minute candles',()=>{const candles=[[0,0,0,0,100],[60,0,0,0,101],[120,0,0,0,1000]];const sigma=minuteVolatility(candles,120000);assert(Math.abs(sigma-Math.log(1.01))<1e-10);assert(Number.isNaN(minuteVolatility([],120000)));assert(Number.isNaN(minuteVolatility([[0,0,0,0,100],[120,0,0,0,1000]],180000)));});

test('opening probability responds immediately to price movement',()=>{for(const minutes of [5,15,30,60]){const m={status:'open',strike:100,startsAt:60000,endsAt:60000+minutes*60000};assert(estimateChances(m,101,60000,.001).up>50);assert.equal(estimateChances(m,100,60000,.001).up,50);}});

const {dataStatus,configure}=require('../../src/frontend/market-model.js');
test('prediction gate requires fresh connected data, benchmark and server quote',()=>{
 const now=100000,market={status:'open',strike:100,up:62,endsAt:200000},model={feedMode:'live',feedConnection:'connected',spot:101,priceUpdatedAt:now,historyStatus:'ready',quoteReady:true};
 assert.equal(dataStatus(model,market,now).ready,true);
 for(const override of [{feedConnection:'disconnected'},{priceUpdatedAt:now-15001},{priceUpdatedAt:now+5001},{priceUpdatedAt:0},{spot:NaN},{historyStatus:'error'},{quoteReady:false},{paused:true},{isHistorical:true},{feedMode:'demo'}])assert.equal(dataStatus({...model,...override},market,now).ready,false);
 assert.equal(dataStatus(model,{...market,strike:null},now).ready,false);
 assert.equal(dataStatus(model,{...market,endsAt:now},now).ready,false);
 assert.equal(dataStatus(model,{...market,status:'queued'},now).ready,false);
});
test('purchase prices are configured by server, independently of model chances',()=>{
 const model=require('../../src/frontend/market-model.js'),quotes=Object.fromEntries(model.markets.map(m=>[m.id,55]));
 configure({quotes,settlement:{version:'coinbase-minute-close-v1'}});
 assert(model.markets.every(m=>m.up===55));assert.equal(model.quoteReady,true);
 assert.equal(quote({...model.markets[0],status:'open',strike:100},'up',50,100).cents,55);
 assert.equal(estimateChances({status:'open',strike:100,endsAt:100000},100,0).up,50);
 assert.throws(()=>configure({quotes:{}}));
});

test('betting closes exactly 30 seconds before every interval ends',()=>{
 const now=100000,model={feedMode:'live',feedConnection:'connected',spot:101,priceUpdatedAt:now,historyStatus:'ready',quoteReady:true};
 for(const minutes of [5,15,30,60]){
  const market={status:'open',strike:100,up:62,minutes,endsAt:now+30001};
  assert.equal(dataStatus(model,market,now).ready,true);
  assert.equal(dataStatus(model,market,now+1).ready,false);
  assert.match(dataStatus(model,market,now+1).reason,/Betting closed/);
 }
});

test('pricing backfill failures are distinct from benchmark failures',()=>{
 const now=100000,market={status:'open',strike:100,up:62,endsAt:200000},model={feedMode:'live',feedConnection:'connected',spot:101,priceUpdatedAt:now,historyStatus:'ready',quoteReady:true};
 assert.equal(dataStatus({...model,pricingHistoryStatus:'error'},market,now).reason,'Odds history unavailable · reconnect');
 assert.equal(dataStatus({...model,pricingHistoryStatus:'loading'},market,now).ready,false);
});

test('prediction cap accepts 1000 credits and rejects larger budgets even with sufficient balance',()=>{
 const m=markets[0];
 assert.equal(quote(m,'up',1000,14250).cost,1000);
 for(const budget of [1000.001,1000.01,1001,14250])assert.equal(quote(m,'up',budget,14250),null);
 assert.equal(quote(m,'up',1000,999),null);
});

test('locked segments retain display probabilities without allowing bets',()=>{
 const now=100000,market={status:'open',strike:100,up:62,endsAt:now+30000};
 const model={feedMode:'live',feedConnection:'connected',spot:101,priceUpdatedAt:now,historyStatus:'ready',quoteReady:true};
 assert.equal(dataStatus(model,market,now).ready,false);
 assert.equal(dataStatus(model,market,now,{allowLocked:true}).ready,true);
 assert.equal(estimateChances(market,101,now).up+estimateChances(market,101,now).down,100);
 assert.equal(dataStatus({...model,feedConnection:'disconnected'},market,now,{allowLocked:true}).ready,false);
 assert.equal(dataStatus({...model,priceUpdatedAt:now+30000},market,now+30000,{allowLocked:true}).ready,false);
});

test('one-minute plays are absent from the market catalog',()=>{
 assert(markets.every(m=>m.minutes>=5));
 assert(!markets.some(m=>m.id.startsWith('1-')));
});

test('one-second movement survives minute backfills instead of collapsing into minute-close chords',()=>{
 const {minutePlot}=require('../../src/frontend/market-model.js');
 const seconds=Array.from({length:62},(_,i)=>({t:(i+1)*1000,price:i%2?103:98}));
 const opening=[[-60,99,101,100,100]],close=[0,97,104,100,100];
 const before=minutePlot(opening,0,300000,62500,{t:62000,price:103},seconds);
 const after=minutePlot([...opening,close],0,300000,62500,{t:62000,price:103},seconds);
 assert.equal(before.secondCount,62);assert.equal(after.secondCount,62);
 assert.equal(before.line.split(' ').length,64);
 assert.equal(after.line.split(' ').length,64,'minute backfills preserve the observed seconds');
 assert.equal(after.tip.x,62500/300000*1000,'the trail still ends at the live playhead');
 const interior=minutePlot([...opening,close],0,300000,60000,null,seconds);
 assert.equal(interior.tip.price,103,'an interior minute close does not replace the observed one-second price');
 const settled=minutePlot([...opening,close],0,60000,61000,null,[...seconds,{t:60000,price:500}]);
 assert.equal(settled.tip.price,100,'settlement boundaries retain the exact minute close');
 assert.equal(settled.tip.x,1000);
});

test('one-second trails omit invalid and future samples and leave gaps between unobserved seconds',()=>{
 const {minutePlot}=require('../../src/frontend/market-model.js');
 const plot=minutePlot([],0,10000,6000,null,[{t:1000,price:100},{t:2000,price:101},
  {t:6000,price:99},{t:7000,price:200},{t:6500,price:100},{t:3000,price:0},null]);
 assert.equal(plot.secondCount,3);
 assert.equal((plot.line.match(/M/g)||[]).length,2);
 assert.equal((plot.line.match(/L/g)||[]).length,1);
 assert.equal(plot.tip.price,99);
});
test('minute plots reject malformed and unaligned candles rather than inventing continuity',()=>{
 const {minutePlot}=require('../../src/frontend/market-model.js');
 const candles=[[0,99,105,100,104],[60,106,105,100,104],[61,90,110,100,105],[120,0,110,100,105]];
 const plot=minutePlot(candles,0,180000,180000);
 assert.equal(plot.count,1);assert.equal(plot.tip.price,104);
 assert.equal((plot.line.match(/M/g)||[]).length,1);assert.doesNotMatch(plot.line,/L/);
});
