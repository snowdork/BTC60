/** @module market-model
 * Calculate demo contract quotes, volatility, probabilities, and order-readiness guards.
 */
/* Pure demo market logic, shared by the browser and Node checks. */
(function(root) {
  const markets = [
    {id:'60-0',minutes:60,start:'17:00',end:'18:00',status:'open',strike:67450,up:68,remaining:'17m 48s'},
    {id:'30-0',minutes:30,start:'17:00',end:'17:30',status:'settled',strike:67450,close:67512,up:54},
    {id:'30-1',minutes:30,start:'17:30',end:'18:00',status:'open',strike:67500,up:58,remaining:'17m 48s'},
    {id:'15-0',minutes:15,start:'17:00',end:'17:15',status:'settled',strike:67450,close:67440,up:49},
    {id:'15-1',minutes:15,start:'17:15',end:'17:30',status:'settled',strike:67440,close:67500,up:57},
    {id:'15-2',minutes:15,start:'17:30',end:'17:45',status:'open',strike:67500,up:62,remaining:'2m 48s'},
    {id:'15-3',minutes:15,start:'17:45',end:'18:00',status:'queued',strike:null,up:null}
  ];
  /** Validate market state, side, budget, and balance before calculating fractional shares and rounded payout. */ function quote(market,side,budget,balance) {
    const cents = side === 'up' ? market.up : 100-market.up;
    if (market.status !== 'open' || !Number.isFinite(market.strike) || !['up','down'].includes(side) || !Number.isFinite(budget) || !Number.isFinite(balance) || budget<1 || budget>balance || !Number.isInteger(cents) || cents<=0 || cents>=100) return null;
    const costCents=Math.ceil(budget*100-1e-7);
    if(costCents>Math.round(balance*100))return null;
    const contracts=costCents/cents,payoutCents=Math.ceil(costCents*100/cents);
    return {cents,contracts,cost:costCents/100,payout:payoutCents/100,profit:(payoutCents-costCents)/100};
  }
  // Fast/slow EWMA variance over the trailing 24 hours, with zero log drift.
  /** Estimate fast/slow EWMA minute volatility from consecutive closed candles in the trailing day. */ function minuteVolatility(candles,now) {
    const closed=[...new Map(candles.filter(c=>Array.isArray(c)&&Number.isFinite(c[0])&&Number.isFinite(c[4])&&c[4]>0&&c[0]*1000>=now-86400000&&c[0]*1000+60000<=now).map(c=>[c[0],c])).values()].sort((a,b)=>a[0]-b[0]);
    let fast=null,slow=null;
    for(let i=1;i<closed.length;i++)if(closed[i][0]-closed[i-1][0]===60){
      const square=Math.log(closed[i][4]/closed[i-1][4])**2;
      fast=fast===null?square:2**(-1/10)*fast+(1-2**(-1/10))*square;
      slow=slow===null?square:2**(-1/60)*slow+(1-2**(-1/60))*square;
    }
    return fast===null?NaN:Math.sqrt(Math.max(1e-12,.5*fast+.5*slow));
  }
  /** Approximate the standard normal cumulative distribution for probability estimation. */ function normalCDF(z){
    if(z===0)return .5;
    const x=Math.abs(z),t=1/(1+.2316419*x);
    const tail=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    return z>0?1-tail:tail;
  }
  /** Apply optional logistic calibration to a bounded raw probability. */ function calibratedProbability(p,calibration){
    if(!calibration)return p;
    p=Math.max(1e-9,Math.min(1-1e-9,p));
    const x=calibration.slope*Math.log(p/(1-p))+calibration.intercept;
    return 1/(1+Math.exp(-Math.max(-700,Math.min(700,x))));
  }
  /** Return settled, baseline, or live estimated direction probabilities; reject unsupported price/time inputs. */ function estimateChances(market,spot,now,volatility=.0001) {
    if(market.status==='settled') {
      if(!Number.isFinite(market.strike)||!Number.isFinite(market.close))return null;
      const up=market.close>=market.strike?100:0;return {up,down:100-up,label:'RESULT'};
    }
    if(market.status==='queued')return {up:50,down:50,label:'BASELINE'};
    // Reject invalid order state before any monetary arithmetic.
    if(market.status!=='open'||!Number.isFinite(market.strike)||market.strike<=0||!Number.isFinite(spot)||spot<=0||!Number.isFinite(now)||!Number.isFinite(market.endsAt)||market.endsAt<=now||!Number.isFinite(volatility)||volatility<=0)return null;
    const uncertainty=volatility*Math.sqrt(Math.max(1/60,(market.endsAt-now)/60000));
    const z=Math.log(spot/market.strike)/uncertainty;
    const calibration=model.calibrations?.[model.coin?.symbol];
    const up=Math.max(1,Math.min(99,Math.round(100*calibratedProbability(normalCDF(z),calibration))));
    return {up,down:100-up,label:'ESTIMATE'};
  }
  /** Explain whether current feed, history, quote, and interval state permit placing a prediction. */ function dataStatus(model,market,now=Date.now()) {
    if(model.isHistorical)return {ready:false,reason:'Historical market',age:null};
    if(model.coin?.feed==='oilpriceapi'&&model.feedMode!=='demo')return {ready:false,reason:'Spot assessments lack hourly benchmarks',age:Number.isFinite(model.priceUpdatedAt)?Math.max(0,Math.floor((now-model.priceUpdatedAt)/1000)):null};
    // Synthetic preview values are never eligible for executable predictions.
    if(model.feedMode==='demo')return {ready:false,reason:'Synthetic preview only',age:null};
    const age=Number.isFinite(model.priceUpdatedAt)&&model.priceUpdatedAt>0?Math.max(0,Math.floor((now-model.priceUpdatedAt)/1000)):null;
    if(model.paused)return {ready:false,reason:'Chart paused',age};
    if(model.feedConnection!=='connected')return {ready:false,reason:'Price feed disconnected',age};
    if(age===null||!Number.isFinite(model.spot)||model.spot<=0)return {ready:false,reason:'Waiting for live price',age};
    if(now-model.priceUpdatedAt>(model.coin?.maxPriceAgeMs||15000)||model.priceUpdatedAt>now+5000)return {ready:false,reason:'Price feed stale',age};
    if(model.historyStatus==='error')return {ready:false,reason:'Benchmark history unavailable',age};
    if(model.pricingHistoryStatus==='error')return {ready:false,reason:'Odds history unavailable · reconnect',age};
    if(model.pricingHistoryStatus==='loading')return {ready:false,reason:'Loading odds history',age};
    if(!Number.isFinite(market.strike)||market.strike<=0)return {ready:false,reason:'Opening benchmark unavailable',age};
    if(!model.quoteReady||!Number.isInteger(market.up))return {ready:false,reason:'Purchase quote unavailable',age};
    // Reject invalid order state before any monetary arithmetic.
    if(market.status!=='open'||!Number.isFinite(market.endsAt)||now>=market.endsAt)return {ready:false,reason:'Market closed',age};
    if(now>=market.endsAt-30000)return {ready:false,reason:'Betting closed · final 30 seconds',age};
    return {ready:true,reason:'Ready',age};
  }
  /** Validate server purchase quote configuration before enabling model quotes. */ function configure(config){
    if(!config||!markets.every(m=>Number.isInteger(config.quotes?.[m.id])&&config.quotes[m.id]>0&&config.quotes[m.id]<100))throw Error('Invalid purchase quote configuration.');
    markets.forEach(m=>{m.up=config.quotes[m.id];});model.quoteReady=true;model.settlement=config.settlement;model.calibrations=config.calibrations||{};
  }
  /** Resolve equal or rising benchmark values as Up and falling values as Down. */ function outcome(start,close) { return close >= start ? 'up' : 'down'; }
  const model={markets,quote,outcome,estimateChances,minuteVolatility,normalCDF,calibratedProbability,dataStatus,configure,quoteReady:false,initialBalance:14250,spot:67528.50,coin:typeof window!=='undefined'?window.PredictCoins.available[0]:null};
  if (typeof module !== 'undefined' && module.exports) module.exports=model;
  else root.PredictModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);
