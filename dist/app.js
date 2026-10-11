(() => {
  'use strict';
  const {markets,quote,outcome,initialBalance}=window.RolrModel;
  const $=id=>document.getElementById(id);
  const price=value=>window.RolrCoins.formatPrice(value,window.RolrModel.coin.symbol);
  const money=value=>value.toLocaleString('en-US',{style:'currency',currency:'USD'});
  const account=window.BTC60Account;
  let positions=[];
  let market=markets.find(m=>m.id==='15-2'),side='up',review=null,initialMarketChosen=false,submitting=false;
  const balance=()=>account.user?account.user.balance_cents/100:initialBalance;
  function notify(message) {
    $('notification').textContent=message;$('notification').classList.add('visible');
    clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('notification').classList.remove('visible'),4500);
  }
  function renderStatusLine(){
    const open=market.status==='open',queued=market.status==='queued',model=window.RolrModel;
    $('selected-bet').textContent=`${model.coin.symbol} · ${market.minutes} MIN · ${side==='up'?'↗ Up':'↘ Down'}`;
    $('selected-bet').style.color=side==='up'?'var(--green)':'#ff6a84';
    $('selected-time').textContent=`${market.start}–${market.end} UTC`;
    $('selected-state').textContent=open?'OPEN':queued?'UPCOMING':'SETTLED';
    $('selected-state').className='badge '+(open?'green':queued?'amber':'neutral');
    let label=open?`${market.remaining} left`:queued?`Opens ${market.start}`:'Interval complete';
    if(queued&&Number.isFinite(market.startsAt)&&Number.isFinite(model.now)){
      const seconds=Math.max(0,Math.ceil((market.startsAt-model.now)/1000));
      label=`Opens in ${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s`;
    }
    $('selected-countdown').textContent=label;
  }
  function health(){return window.RolrModel.dataStatus(window.RolrModel,market);}
  function renderExecutionState(){
    const model=window.RolrModel,state=health(),q=currentQuote();
    const chance=market.status==='open'&&(state.ready||model.feedMode==='demo')?model.estimateChances(market,model.spot,model.now,model.volatility):null;
    $('up-chance').textContent=chance?`${chance.up}%`:'—';
    $('down-chance').textContent=chance?`${chance.down}%`:'—';

    $('price-health').textContent=model.feedMode==='demo'?'Synthetic preview':model.isHistorical?'Historical view':state.age===null?'Spot: no live update':`Spot updated ${state.age}s ago`;
    $('history-health').textContent=model.feedMode==='demo'?'Synthetic benchmarks':model.historyStatus==='ready'?'History loaded':model.historyStatus==='error'?'History unavailable':'Loading history';
    $('execution-health').textContent=state.ready?'Data ready · Demo orders':state.reason;
    $('execution-health').style.color=state.ready?'var(--green)':'var(--amber)';
    $('submit-prediction').disabled=!state.ready||!q||!account.ready;
    $('submit-prediction').textContent=!state.ready?state.reason:!account.user?'Log in to predict →':`Review ${side==='up'?'Up':'Down'} prediction →`;
    document.querySelectorAll('[data-side]').forEach(button=>{button.disabled=market.status!=='open'||!state.ready;});
    $('confirm-prediction').disabled=submitting||!state.ready;
    const delta=model.spot-market.strike;
    $('ticket-delta').textContent=model.isHistorical&&Number.isFinite(market.close)&&Number.isFinite(market.strike)?(market.close>=market.strike?'+':'−')+price(Math.abs(market.close-market.strike)):state.age!==null&&state.age<=15&&Number.isFinite(delta)&&Number.isFinite(market.strike)?(delta>=0?'+':'−')+price(Math.abs(delta)):'—';
    $('ticket-delta').style.color=delta>=0?'var(--green)':'var(--red)';
    if(review&&!state.ready){review=null;$('review-dialog').close();notify('Data unavailable. Wait for reconnection and review again.');}
  }
  function renderReviewChance(){
    if(!review)return;
    const model=window.RolrModel,m=markets.find(item=>item.id===review.marketId);
    const chance=m&&model.dataStatus(model,m).ready?model.estimateChances(m,model.spot,model.now,model.volatility):null;
    $('review-chance').textContent=chance?`${chance[review.side]}% ${review.side==='up'?'Up':'Down'}`:'—';
    $('review-chance').title='Heuristic model estimate; purchase price is separate. Updates with the live market.';
  }
  function renderChances() {
    const model=window.RolrModel;
    renderStatusLine();
    renderExecutionState();
    renderReviewChance();
    markets.forEach(m=>{
      const element=document.querySelector(`[data-chances="${m.id}"]`);if(!element)return;
      element.hidden=m.status==='queued';
      if(element.hidden)return;
      const stale=m.status==='open'&&model.feedMode==='live'&&!model.dataStatus(model,m).ready;
      const chance=stale?null:model.estimateChances(m,model.spot,model.now,model.volatility);
      element.querySelector('.chance-caption').textContent=m.status==='settled'?'DEMO RESULT':'MODEL ESTIMATE';
      const distance=document.querySelector(`[data-distance="${m.id}"]`);
      if(distance){const delta=model.spot-m.strike,valid=!stale&&Number.isFinite(model.spot)&&Number.isFinite(m.strike);distance.textContent=valid?`${delta>=0?'↗ +':'↘ −'}${price(Math.abs(delta))} ${delta>=0?'above':'below'} target`:'Spot distance unavailable';distance.style.color=valid?(delta>=0?'var(--green)':'var(--red)'):'var(--muted)';}
      element.querySelector('.chance-up').textContent=`↗ Up ${chance?chance.up+'%':'—'}`;
      element.querySelector('.chance-down').textContent=`↘ Down ${chance?chance.down+'%':'—'}`;
      element.title=chance?.label==='ESTIMATE'?'Heuristic estimate centered on the price to beat, scaled by recent minute volatility and time remaining. Not calibrated odds; contract quotes are separate.':chance?.label==='BASELINE'?'Neutral 50/50 starting baseline. Percentages update with price movement after the opening second.':chance?.label==='RESULT'?'Completed demo result, not a forecast.':'Waiting for a fresh price and valid benchmark.';
    });
  }
  function renderSegmentPredictions(){
    const model=window.RolrModel;
    markets.forEach(m=>{
      const container=document.querySelector(`[data-predictions="${m.id}"]`);if(!container)return;
      const saved=account.user&&model.feedMode!=='demo'?positions.filter(p=>p.coin===model.coin.symbol&&p.marketId===m.id&&p.starts_at*1000===m.startsAt):[];
      container.replaceChildren(...['up','down'].flatMap(direction=>['pending','won','lost'].flatMap(status=>{
        const orders=saved.filter(p=>p.side===direction&&(p.settled_at==null?'pending':p.outcome===p.side?'won':'lost')===status);if(!orders.length)return [];
        const amount=orders.reduce((total,p)=>total+p.cost_cents,0)/100;
        const badge=document.createElement('span');badge.className=`segment-prediction ${status==='pending'?direction:status}`;
        badge.textContent=`${status==='won'?'✓':status==='lost'?'✕':'☑'} ${money(amount)}`;
        const label=`Your ${direction==='up'?'Up':'Down'} predictions · ${status==='pending'?'pending':status==='won'?'Win':'Loss'} · ${money(amount)} committed`;
        badge.title=label;badge.setAttribute('aria-label',label);
        return [badge];
      })));
      container.hidden=!saved.length;
    });
  }
  function renderMarkets() {
    $('market-grid').innerHTML=[60,30,15].map(minutes=>{
      const items=markets.filter(m=>m.minutes===minutes);
      return `<div class="tier" data-duration="${minutes}"><div class="tier-label">${minutes}<small>MINUTES</small></div><div class="tier-cards" style="--columns:${items.length}">${items.map(m=>{
        const settled=m.status==='settled',queued=m.status==='queued',result=settled&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?outcome(m.strike,m.close):null;
        return `<button type="button" class="market-card ${m.status} ${m.id===market.id?'selected':''}" data-market="${m.id}" aria-pressed="${m.id===market.id}" aria-label="${minutes} minute market ${m.start} to ${m.end} UTC, ${m.status}">${settled&&result!==null?`<span class="segment-result ${result}" role="img" aria-label="${result==='up'?'Up':'Down'} won" title="${result==='up'?'Up':'Down'} won">${result==='up'?'↑':'↓'}</span>`:''}<div class="card-top"><span class="card-time">${m.start} – ${m.end}</span><span class="badge ${queued?'neutral':settled?(result===null?'neutral':result==='up'?'green':'red'):'green'}">${queued?'UPCOMING':settled?(result===null?'CLOSED':result==='up'?'↗ UP WON':'↘ DOWN WON'):'● OPEN'}</span></div><div class="card-benchmark"><div class="segment-price"><span>${Number.isFinite(m.strike)?price(m.strike):'—'}</span><span class="segment-predictions" data-predictions="${m.id}" hidden></span></div><small>${queued?'Benchmark set at open':'Starting settlement benchmark'}</small></div><div class="card-context"><div class="card-distance" data-distance="${m.id}" ${m.status!=='open'?'hidden':''}>Spot distance unavailable</div><div class="card-bottom">${queued?`<span class="queued-label">Opens at ${m.start}</span>`:settled?`<span>${Number.isFinite(m.close)?'Final '+price(m.close):'Awaiting history'}</span>`:`<span data-remaining="${m.id}">${m.remaining}</span>`}</div></div><div class="chance-block" data-chances="${m.id}"><small class="chance-caption">MODEL ESTIMATE</small><div class="chance-row"><span class="chance-up">↗ Up —</span><span class="chance-down">↘ Down —</span></div></div>${m.status==='open'?`<div class="card-quote">DEMO BUY · ↗ ${m.up}¢ / ↘ ${100-m.up}¢</div>`:''}</button>`;
      }).join('')}</div></div>`;
    }).join('');
    renderSegmentPredictions();
    renderChances();
    document.querySelectorAll('[data-market]').forEach(button=>button.addEventListener('click',()=>{market=markets.find(m=>m.id===button.dataset.market);review=null;renderMarkets();renderTicket();}));
  }
  function currentQuote() {return quote(market,side,Number($('stake').value),balance());}
  function renderTicket() {
    renderStatusLine();
    const open=market.status==='open',queued=market.status==='queued';
    $('ticket-duration').textContent=`${market.minutes} MIN`;
    $('ticket-status').textContent=open?'OPEN':queued?'UPCOMING':'SETTLED';
    $('ticket-status').className='badge '+(open?'green':'neutral');
    $('ticket-time').textContent=`${market.start} – ${market.end} UTC`;
    $('ticket-question').textContent=`${window.RolrModel.coin.name} up or down?`;
    $('ticket-strike').textContent=queued?'Set at open':Number.isFinite(market.strike)?price(market.strike):'Loading…';
    const delta=(window.RolrModel.isHistorical?market.close:window.RolrModel.spot)-market.strike;
    $('ticket-delta-label').textContent=window.RolrModel.isHistorical?'SETTLED VS BENCHMARK':'SPOT VS BENCHMARK';
    $('ticket-delta').textContent=queued||!Number.isFinite(market.strike)||!Number.isFinite(window.RolrModel.isHistorical?market.close:window.RolrModel.spot)?'—':(delta>=0?'+':'−')+price(Math.abs(delta));
    $('ticket-delta').style.color=delta>=0?'var(--green)':'var(--red)';
    $('up-price').textContent=open?`${market.up}¢`:'—';
    $('down-price').textContent=open?`${100-market.up}¢`:'—';
    document.querySelectorAll('[data-side]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.side===side));button.disabled=!open;});
    $('stake').disabled=!open;$('stake').max=balance().toFixed(2);
    document.querySelectorAll('[data-stake]').forEach(button=>{button.disabled=!open;const amount=button.dataset.stake==='max'?balance():Number(button.dataset.stake);button.classList.toggle('selected',Number($('stake').value)===amount);button.setAttribute('aria-pressed',String(Number($('stake').value)===amount));});
    const q=currentQuote();
    $('contract-price').textContent=open?`at ${side==='up'?market.up:100-market.up}¢ each`:'';
    $('contracts').textContent=q?String(q.contracts):'—';$('cost').textContent=q?money(q.cost):'—';$('return').textContent=q?money(q.payout):'—';$('profit').textContent=q?'+'+money(q.profit):'—';
    $('submit-prediction').disabled=!q || !account.ready || window.RolrModel.feedMode==='demo';
    $('submit-prediction').classList.toggle('bear',side==='down');
    $('submit-prediction').textContent=!account.user?'Log in to predict →':window.RolrModel.feedMode==='demo'?'Preview only · Switch to live':open?`Review ${side==='up'?'Up':'Down'} prediction →`:queued?`Opens at ${market.start} UTC`:window.RolrModel.isHistorical?'Historical market · Closed':'Market settled';
    $('ticket-note').textContent=!open?(queued?'Select an open market to make a prediction.':Number.isFinite(market.strike)&&Number.isFinite(market.close)?`Demo settlement: ${outcome(market.strike,market.close)==='up'?'Up':'Down'} at ${price(market.close)}.`:'Waiting for market history.'):!q?'Enter a budget of at least $1 within your demo balance.':'Simulated prices · No fees · No real money';
    $('settlement-description').textContent=!Number.isFinite(market.strike)&&!queued?'Waiting for a demo benchmark from minute history.':queued?'The starting benchmark is set when this interval opens.':`Up wins if the closing minute-candle close is at least ${price(market.strike)}. An unchanged price resolves Up. Coinbase proxy · not a 60-second average.`;
    $('balance').textContent=money(balance());
    renderExecutionState();
  }
  let pendingSignature='';
  function renderPendingTimes(){
    if(document.hidden)return;
    positions.filter(p=>p.settled_at==null).forEach(p=>{
      const label=document.getElementById(`pending-time-${p.id}`);if(!label)return;
      const seconds=Math.max(0,Math.ceil(p.ends_at-Date.now()/1000));
      const status=seconds?`${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s left`:'Awaiting settlement';
      label.textContent=`${p.start}–${p.end} UTC · ${new Date(p.starts_at*1000).toISOString().slice(0,10)} · ${status}`;
    });
  }
  function renderPositions() {
    const pending=positions.filter(p=>p.settled_at==null);
    const signature=JSON.stringify([!!account.user,pending.map(p=>p.id)]);
    if(signature===pendingSignature){renderPendingTimes();return;}pendingSignature=signature;
    $('position-count').textContent=pending.length;
    $('positions-list').classList.toggle('positions-list-empty',!pending.length);
    if(!pending.length){$('positions-list').textContent=account.user?'No pending predictions. Settled results are in your portfolio.':'Log in to track pending predictions and results.';return;}
    $('positions-list').replaceChildren(...pending.map(p=>{
      const row=document.createElement('div');row.className='position-row';
      const detail=document.createElement('div'),title=document.createElement('strong'),time=document.createElement('small');
      title.textContent=`${p.side==='up'?'↗ Up':'↘ Down'} · ${p.coin} · ${p.minutes} min`;title.style.color=p.side==='up'?'var(--green)':'var(--red)';
      time.id=`pending-time-${p.id}`;detail.append(title,time);
      const values=document.createElement('div'),cost=document.createElement('strong'),contracts=document.createElement('small');cost.textContent=money(p.cost);contracts.textContent=`${p.contracts} contracts · ${money(p.contracts)} if correct`;values.append(cost,contracts);row.append(detail,values);return row;
    }));
    renderPendingTimes();
  }
  document.querySelectorAll('[data-side]').forEach(button=>button.addEventListener('click',()=>{side=button.dataset.side;renderTicket();}));
  document.querySelectorAll('[data-stake]').forEach(button=>button.addEventListener('click',()=>{$('stake').value=button.dataset.stake==='max'?balance().toFixed(2):button.dataset.stake;renderTicket();}));
  $('stake').addEventListener('input',renderTicket);
  ['rules-open','rules-inline'].forEach(id=>$(id).addEventListener('click',()=>$('rules-dialog').showModal()));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('prediction-form').addEventListener('submit',event=>{
    event.preventDefault();if(!account.user){location.href='login.html';return;}if(!health().ready){notify(health().reason);return;}const q=currentQuote();if(!q)return;
    review={requestId:crypto.randomUUID(),startsAt:market.startsAt,coin:window.RolrModel.coin.symbol,marketId:market.id,start:market.start,end:market.end,minutes:market.minutes,strike:market.strike,hour:window.RolrModel.hour,side,budget:Number($('stake').value),...q};
    const down=review.side==='down',arrow=down?'↓':'↑',direction=down?'Down':'Up';
    $('review-direction').classList.toggle('down',down);
    $('review-arrow').textContent=arrow;
    $('review-side').textContent=`Predict ${direction}`;
    $('confirm-prediction').classList.toggle('bear',down);
    $('confirm-prediction').textContent=`${arrow} Place ${direction} demo prediction`;
    $('review-title').textContent=`${side==='up'?'Up':'Down'} · ${window.RolrModel.coin.name} ${market.minutes} min`;
    $('review-detail').textContent=`${market.start} – ${market.end} UTC · Benchmark ${price(market.strike)}`;
    $('review-summary').innerHTML=`<div><span>${q.contracts} contracts at ${q.cents}¢</span><strong>${money(q.cost)}</strong></div><div><span>Return if correct</span><strong>${money(q.payout)}</strong></div><div class="profit-row"><span>Potential profit</span><strong>+${money(q.profit)}</strong></div>`;
    renderReviewChance();
    $('review-dialog').showModal();
  });
  $('confirm-prediction').addEventListener('click',async()=>{
    if(!review||submitting)return;
    if(!health().ready){notify(health().reason);review=null;$('review-dialog').close();return;}
    const m=markets.find(m=>m.id===review.marketId),q=quote(m,review.side,review.budget,balance());
    if(!q||review.coin!==window.RolrModel.coin.symbol||review.hour!==window.RolrModel.hour){$('review-dialog').close();review=null;notify('Market changed. Review your prediction again.');return;}
    const button=$('confirm-prediction');submitting=true;button.disabled=true;
    try{await account.place(review);review=null;$('review-dialog').close();notify('Demo prediction saved to your account.');}
    catch(error){notify(error.message);}
    finally{submitting=false;renderExecutionState();}
  });
  function renderAccount(){
    positions=account.predictions.map(p=>({...p,marketId:p.market_id,minutes:Number(p.market_id.split('-')[0]),start:new Date(p.starts_at*1000).toISOString().slice(11,16),end:new Date(p.ends_at*1000).toISOString().slice(11,16),cost:p.cost_cents/100}));
    $('account-name').textContent=account.user?.name||'';
    $('account-name').hidden=!account.user;$('logout-button').hidden=!account.user;
    $('login-link').hidden=!!account.user;$('signup-link').hidden=!!account.user;
    $('positions-storage').textContent=account.user?'Live orders only':'Log in to save predictions';
    renderSegmentPredictions();renderPositions();renderTicket();
  }
  $('logout-button').addEventListener('click',()=>account.logout().catch(error=>notify(error.message)));
  window.addEventListener('account-update',renderAccount);
  window.addEventListener('coin-change',()=>{initialMarketChosen=false;review=null;$('review-dialog').close();renderMarkets();renderTicket();});
  window.addEventListener('btc-market-update',()=>{if(!initialMarketChosen){const active=markets.find(m=>m.minutes===15&&m.status==='open'&&Number.isFinite(m.strike));if(active){market=active;initialMarketChosen=true;}}review=null;$('review-dialog').close();renderMarkets();renderTicket();});
  window.addEventListener('btc-chances-update',renderChances);
  window.addEventListener('btc-price-update',renderChances);
  setInterval(renderPendingTimes,1000);
  renderMarkets();renderAccount();
})();
