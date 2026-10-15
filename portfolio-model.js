/** @module portfolio-model
 * Compute prediction results, aggregate returns, and stable portfolio sorting.
 */
(function(root){
  /** Classify a prediction as won, lost, awaiting settlement, or still pending. */ function result(p,now=Date.now()){
    if(p.settled_at!=null)return p.outcome===p.side?'won':'lost';
    return p.ends_at*1000<=now?'settling':'pending';
  }
  /** Aggregate settled wins/losses and integer-cent returns separately from committed pending costs. */ function summary(predictions){
    const settled=predictions.filter(p=>p.settled_at!=null),wins=settled.filter(p=>result(p)==='won').length;
    return {wins,losses:settled.length-wins,pending:predictions.length-settled.length,profitCents:settled.reduce((sum,p)=>sum+p.payout_cents-p.cost_cents,0),pendingCostCents:predictions.filter(p=>p.settled_at==null).reduce((sum,p)=>sum+p.cost_cents,0),winRate:settled.length?Math.round(wins/settled.length*100):null};
  }
  /** Return a sorted copy of predictions for the chosen column and direction. */ function sortPredictions(predictions,column='window',direction='desc',now=Date.now()){
    const /** Extract a comparable value for the requested portfolio sort column. */ value=p=>{
      switch(column){
        case 'market':return `${p.coin} ${String(parseInt(p.market_id,10)||0).padStart(3,'0')} ${p.category||'crypto'}`;
        case 'prediction':return p.side;
        case 'window':return p.starts_at;
        case 'status':return result(p,now);
        case 'benchmark':return p.strike;
        case 'cost':return p.cost_cents;
        case 'return':return p.settled_at==null?null:p.payout_cents;
        case 'profit':return p.settled_at==null?null:p.payout_cents-p.cost_cents;
        default:return null;
      }
    };
    return predictions.slice().sort((a,b)=>{
      const av=value(a),bv=value(b);
      if(av==null)return bv==null?0:1;
      if(bv==null)return -1;
      const comparison=typeof av==='string'?av.localeCompare(bv):av-bv;
      return direction==='desc'?-comparison:comparison;
    });
  }
  const api={result,summary,sortPredictions};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BTC60Portfolio=api;
})(globalThis);
