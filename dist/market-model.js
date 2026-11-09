/** @module market-model
 * Calculate demo contract quotes, volatility, probabilities, and order-readiness guards.
 */
/* Pure demo market logic, shared by the browser and Node checks. */
(function(root) {
  const maxPredictionCredits = 1000;
  const markets = [
    {id:'60-0',minutes:60,start:'17:00',end:'18:00',status:'open',strike:67450,up:68,remaining:'17m 48s'},
    {id:'30-0',minutes:30,start:'17:00',end:'17:30',status:'settled',strike:67450,close:67512,up:54},
    {id:'30-1',minutes:30,start:'17:30',end:'18:00',status:'open',strike:67500,up:58,remaining:'17m 48s'},
    {id:'15-0',minutes:15,start:'17:00',end:'17:15',status:'settled',strike:67450,close:67440,up:49},
    {id:'15-1',minutes:15,start:'17:15',end:'17:30',status:'settled',strike:67440,close:67500,up:57},
    {id:'15-2',minutes:15,start:'17:30',end:'17:45',status:'open',strike:67500,up:62,remaining:'2m 48s'},
    {id:'15-3',minutes:15,start:'17:45',end:'18:00',status:'queued',strike:null,up:null},
    ...Array.from({length:12},(_,index)=>({id:`5-${index}`,minutes:5,start:`17:${String(index*5).padStart(2,'0')}`,end:index===11?'18:00':`17:${String((index+1)*5).padStart(2,'0')}`,status:'queued',strike:null,up:50}))
  ];
  /** Validate market state, side, budget, and balance before calculating fractional shares and rounded payout. */ function quote(market,side,budget,balance) {
    const cents = side === 'up' ? market.up : 100-market.up;
    if (market.status !== 'open' || !Number.isFinite(market.strike) || !['up','down'].includes(side) || !Number.isFinite(budget) || !Number.isFinite(balance) || budget<1 || budget>maxPredictionCredits || budget>balance || !Number.isInteger(cents) || cents<=0 || cents>=100) return null;
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
  /** Explain whether current feed, history, quote, and interval state permit placing a prediction. */ function dataStatus(model,market,now=Date.now(),{allowLocked=false}={}) {
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
    if(!allowLocked&&now>=market.endsAt-30000)return {ready:false,reason:'Betting closed · final 30 seconds',age};
    return {ready:true,reason:'Ready',age};
  }
  /** Validate server purchase quote configuration before enabling model quotes. */ function configure(config){
    if(!config||!markets.every(m=>Number.isInteger(config.quotes?.[m.id])&&config.quotes[m.id]>0&&config.quotes[m.id]<100))throw Error('Invalid purchase quote configuration.');
    markets.forEach(m=>{m.up=config.quotes[m.id];});model.quoteReady=true;model.settlement=config.settlement;model.calibrations=config.calibrations||{};
  }
  /** Resolve equal or rising benchmark values as Up and falling values as Down. */ function outcome(start,close) { return close >= start ? 'up' : 'down'; }
  /** Build adjacent UTC intervals, including neighbors across an hour or day boundary. */
  function adjacentMarkets(minutes,anchor,now,candles=[]){
    const duration=minutes*60000,start=Math.floor(anchor/duration)*duration;
    const closes=new Map(candles.filter(c=>Array.isArray(c)&&Number.isFinite(c[4])&&c[4]>0&&c[0]*1000+60000<=now).map(c=>[c[0]*1000+60000,c[4]]));
    const /** Format the interval's UTC hour and minute. */ time=t=>new Date(t).toISOString().slice(11,16);
    return [-1,0,1].map((offset)=>{
      const startsAt=start+offset*duration,endsAt=startsAt+duration;
      const status=now>=endsAt?'settled':now>=startsAt?'open':'queued';
      return {id:`${minutes}-${Math.floor((startsAt%3600000+3600000)%3600000/duration)}`,minutes,startsAt,endsAt,start:time(startsAt),end:time(endsAt),status,
        strike:status==='queued'?null:closes.get(startsAt)??null,close:status==='settled'?(closes.get(endsAt)??null):null,up:50};
    });
  }
  /** Combine minute history with observed one-second prices and align the live edge to display time. */
  function minutePlot(candles,start,end,now,live=null,secondPoints=[]){
    const rows=[...new Map(candles.filter(c=>Array.isArray(c)&&c.length>=5&&c.slice(0,5).every(Number.isFinite)&&c.slice(1,5).every(v=>v>0)&&c[0]%60===0&&c[1]<=Math.min(c[3],c[4])&&c[2]>=Math.max(c[3],c[4])&&c[0]*1000>=start-60000&&c[0]*1000<end&&c[0]*1000+60000<=now).map(c=>[c[0],c])).values()].sort((a,b)=>a[0]-b[0]);
    const bars=rows.filter(c=>c[0]*1000>=start),closes=rows.map(c=>({t:c[0]*1000+60000,price:c[4]}));
    const recorded=[...new Map((secondPoints||[]).filter(p=>p&&Number.isFinite(p.t)&&p.t%1000===0&&Number.isFinite(p.price)&&p.price>0&&p.t>=start&&p.t<=Math.min(now,end)).map(p=>[p.t,{t:p.t,price:p.price,second:true}])).values()];
    // Final minute closes remain authoritative at settlement boundaries. Loading
    // those closes never discards the second-by-second observations in between.
    const byTime=new Map(closes.map(p=>[p.t,p]));
    for(const point of recorded){
      if((point.t!==start&&point.t!==end)||!byTime.has(point.t))byTime.set(point.t,point);
    }
    const samples=[...byTime.values()].sort((a,b)=>a.t-b.t);
    const lastClose=closes.at(-1);
    if(now>=start&&now<end&&live&&Number.isFinite(live.price)&&live.price>0&&Number.isFinite(live.t)&&live.t>=start-60000&&live.t<=now+5000&&(!lastClose||now>lastClose.t)){
      // Quote timestamps are observations, not the playhead. Small provider clock
      // differences and gaps between trades must not pull the live edge backwards.
      const price=!lastClose||live.t>lastClose.t?live.price:lastClose.price;
      if(samples.at(-1)?.t===now)samples.pop();
      samples.push({t:now,price,second:recorded.length>0});
    }
    const values=[...bars.flatMap(c=>[c[1],c[2]]),...samples.map(p=>p.price)];
    if(!values.length)return {line:'',up:'',down:'',tip:null,count:0,secondCount:0};
    let low=Math.min(...values),high=Math.max(...values);
    const pad=Math.max((high-low)*.12,high*.000001);low-=pad;high+=pad;
    const /** Project a timestamp onto the interval's horizontal axis. */ x=t=>(t-start)/(end-start)*1000;
    const /** Project a price using the range of recorded minute highs and lows. */ y=p=>116-(p-low)/(high-low)*102;
    const /** Format an SVG coordinate pair without changing the source values. */ xy=(t,p)=>`${x(t).toFixed(3)},${y(p).toFixed(3)}`;
    const line=samples.map((p,i)=>`${i&&p.t-samples[i-1].t<=(p.second&&samples[i-1].second?1000:60000)?'L':'M'}${xy(p.t,p.price)}`).join(' ');
    const paths={up:'',down:''},half=60000/(end-start)*1000*.22;
    for(const c of bars){
      const center=x(c[0]*1000+30000),open=y(c[3]),close=y(c[4]),top=Math.min(open,close),height=Math.max(.8,Math.abs(open-close));
      paths[c[4]>=c[3]?'up':'down']+=`M${center.toFixed(3)},${y(c[2]).toFixed(3)}V${y(c[1]).toFixed(3)} M${(center-half).toFixed(3)},${top.toFixed(3)}h${(half*2).toFixed(3)}v${height.toFixed(3)}h${(-half*2).toFixed(3)}Z `;
    }
    const last=samples.at(-1);
    return {line,...paths,tip:last?{x:x(last.t),y:y(last.price),price:last.price}:null,low,high,count:bars.length,secondCount:recorded.length};
  }
  const model={maxPredictionCredits,markets,quote,outcome,estimateChances,minuteVolatility,normalCDF,calibratedProbability,dataStatus,configure,adjacentMarkets,minutePlot,quoteReady:false,initialBalance:10000,spot:67528.50,coin:typeof window!=='undefined'?window.PredictCoins.available[0]:null};
  if (typeof module !== 'undefined' && module.exports) module.exports=model;
  else root.PredictModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);
