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
  function outcome(start,close) { return close >= start ? 'up' : 'down'; }
  const model={markets,quote,outcome,initialBalance:14250,spot:67528.50};
  if (typeof module !== 'undefined' && module.exports) module.exports=model;
  else root.RolrModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);
