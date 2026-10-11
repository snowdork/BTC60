(function(root){
  function result(p,now=Date.now()){
    if(p.settled_at!=null)return p.outcome===p.side?'won':'lost';
    return p.ends_at*1000<=now?'settling':'pending';
  }
  function summary(predictions){
    const settled=predictions.filter(p=>p.settled_at!=null),wins=settled.filter(p=>result(p)==='won').length;
    return {wins,losses:settled.length-wins,pending:predictions.length-settled.length,profitCents:settled.reduce((sum,p)=>sum+p.payout_cents-p.cost_cents,0),pendingCostCents:predictions.filter(p=>p.settled_at==null).reduce((sum,p)=>sum+p.cost_cents,0),winRate:settled.length?Math.round(wins/settled.length*100):null};
  }
  const api={result,summary};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BTC60Portfolio=api;
})(globalThis);
