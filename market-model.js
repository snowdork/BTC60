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
  function quote(market,side,budget,balance) {
    const cents = side === 'up' ? market.up : 100-market.up;
    if (market.status !== 'open' || !Number.isFinite(market.strike) || !['up','down'].includes(side) || !Number.isFinite(budget) || !Number.isFinite(balance) || budget<1 || budget>balance || !Number.isInteger(cents) || cents<=0 || cents>=100) return null;
    const contracts=Math.floor((Math.round(budget*100)+1e-7)/cents);
    const costCents=contracts*cents;
    return {cents,contracts,cost:costCents/100,payout:contracts,profit:(contracts*100-costCents)/100};
  }
  // Uncalibrated, drift-free heuristic: the benchmark is the 50/50 center.
  // Volatility is RMS one-minute log returns; remaining time scales uncertainty.
  function minuteVolatility(candles,now) {
    const closed=candles.filter(c=>Array.isArray(c)&&Number.isFinite(c[0])&&Number.isFinite(c[4])&&c[4]>0&&c[0]*1000+60000<=now).sort((a,b)=>a[0]-b[0]);
    const returns=[];
    for(let i=1;i<closed.length;i++)if(closed[i][0]-closed[i-1][0]===60)returns.push(Math.log(closed[i][4]/closed[i-1][4]));
    return returns.length?Math.max(.0001,Math.sqrt(returns.reduce((sum,r)=>sum+r*r,0)/returns.length)):.0001;
  }
  function estimateChances(market,spot,now,volatility=.0001) {
    if(market.status==='settled') {
      if(!Number.isFinite(market.strike)||!Number.isFinite(market.close))return null;
      const up=market.close>=market.strike?100:0;return {up,down:100-up,label:'RESULT'};
    }
    if(market.status==='queued')return {up:50,down:50,label:'BASELINE'};
    // Give every newly opened interval a visible neutral starting point.
    if(market.status==='open'&&Number.isFinite(now)&&Number.isFinite(market.startsAt)&&now>=market.startsAt&&now-market.startsAt<1000)return {up:50,down:50,label:'BASELINE'};
    if(market.status!=='open'||!Number.isFinite(market.strike)||market.strike<=0||!Number.isFinite(spot)||spot<=0||!Number.isFinite(now)||!Number.isFinite(market.endsAt)||market.endsAt<=now||!Number.isFinite(volatility)||volatility<=0)return null;
    const uncertainty=Math.max(.0001,volatility)*Math.sqrt(Math.max(1/60,(market.endsAt-now)/60000));
    const z=Math.log(spot/market.strike)/uncertainty;
    const up=Math.max(1,Math.min(99,Math.round(100/(1+Math.exp(-1.7*z)))));
    return {up,down:100-up,label:'ESTIMATE'};
  }
  function outcome(start,close) { return close >= start ? 'up' : 'down'; }
  const model={markets,quote,outcome,estimateChances,minuteVolatility,initialBalance:14250,spot:67528.50,coin:typeof window!=='undefined'?window.RolrCoins.available[0]:null};
  if (typeof module !== 'undefined' && module.exports) module.exports=model;
  else root.RolrModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);
