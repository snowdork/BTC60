(() => {
  'use strict';
  const {markets,quote,outcome,initialBalance}=window.RolrModel;
  const $=id=>document.getElementById(id);
  const price=value=>window.RolrCoins.formatPrice(value,window.RolrModel.coin.symbol);
  const money=value=>value.toLocaleString('en-US',{style:'currency',currency:'USD'});
  const account=window.BTC60Account;
  let positions=[];
  let market=markets.find(m=>m.id==='15-2'),side='up',review=null,initialMarketChosen=false;
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
  function renderChances() {
    const model=window.RolrModel;
    renderStatusLine();
    markets.forEach(m=>{
      const element=document.querySelector(`[data-chances="${m.id}"]`);if(!element)return;
      element.hidden=m.status==='queued';
      if(element.hidden)return;
      const stale=m.status==='open'&&model.feedMode==='live'&&(!model.priceUpdatedAt||Date.now()-model.priceUpdatedAt>15000);
      const chance=model.estimateChances(m,stale?NaN:model.spot,model.now,model.volatility);
      element.querySelector('.chance-up').textContent=`↗ Up ${chance?chance.up+'%':'—'}`;
      element.querySelector('.chance-down').textContent=`↘ Down ${chance?chance.down+'%':'—'}`;
      element.title=chance?.label==='ESTIMATE'?'Heuristic estimate centered on the price to beat, scaled by recent minute volatility and time remaining. Not calibrated odds; contract quotes are separate.':chance?.label==='BASELINE'?'Neutral 50/50 starting baseline. Percentages update with price movement after the opening second.':chance?.label==='RESULT'?'Completed demo result, not a forecast.':'Waiting for a fresh price and valid benchmark.';
    });
  }
  function renderMarkets() {
    $('market-grid').innerHTML=[60,30,15].map(minutes=>{
      const items=markets.filter(m=>m.minutes===minutes);
      return `<div class="tier" data-duration="${minutes}"><div class="tier-label">${minutes}<small>MINUTES</small></div><div class="tier-cards" style="--columns:${items.length}">${items.map(m=>{
        const settled=m.status==='settled',queued=m.status==='queued',result=settled&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?outcome(m.strike,m.close):null;
        return `<button type="button" class="market-card ${m.status} ${m.id===market.id?'selected':''}" data-market="${m.id}" aria-pressed="${m.id===market.id}" aria-label="${minutes} minute market ${m.start} to ${m.end} UTC, ${m.status}"><div class="card-top"><span class="card-time">${m.start} – ${m.end}</span><span class="badge ${queued?'neutral':settled?(result===null?'neutral':result==='up'?'green':'red'):'green'}">${queued?'UPCOMING':settled?(result===null?'CLOSED':result==='up'?'↗ UP WON':'↘ DOWN WON'):'● OPEN'}</span></div><div class="card-benchmark">${Number.isFinite(m.strike)?price(m.strike):'—'}<small>${queued?'Benchmark set at open':'Demo price to beat'}</small></div><div class="card-bottom">${queued?`<span class="queued-label">Opens at ${m.start}</span>`:settled?`<span>${Number.isFinite(m.close)?'Final '+price(m.close):'Awaiting history'}</span>`:`<span data-remaining="${m.id}">${m.remaining}</span>`}</div><div class="chance-row" data-chances="${m.id}"><span class="chance-up">↗ Up —</span><span class="chance-down">↘ Down —</span></div></button>`;
      }).join('')}</div></div>`;
    }).join('');
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
    $('settlement-description').textContent=!Number.isFinite(market.strike)&&!queued?'Waiting for a demo benchmark from minute history.':queued?'The starting benchmark is set when this interval opens.':`Up wins if the closing 60-second average is at least ${price(market.strike)}. Otherwise Down wins.`;
    $('balance').textContent=money(balance());
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
    event.preventDefault();if(!account.user){location.href='login.html';return;}if(window.RolrModel.feedMode==='demo')return;const q=currentQuote();if(!q)return;
    review={requestId:crypto.randomUUID(),startsAt:market.startsAt,coin:window.RolrModel.coin.symbol,marketId:market.id,start:market.start,end:market.end,minutes:market.minutes,strike:market.strike,hour:window.RolrModel.hour,side,budget:Number($('stake').value),...q};
    $('review-title').textContent=`${side==='up'?'Up':'Down'} · ${window.RolrModel.coin.name} ${market.minutes} min`;
    $('review-detail').textContent=`${market.start} – ${market.end} UTC · Benchmark ${price(market.strike)}`;
    $('review-summary').innerHTML=`<div><span>${q.contracts} contracts at ${q.cents}¢</span><strong>${money(q.cost)}</strong></div><div><span>Return if correct</span><strong>${money(q.payout)}</strong></div><div class="profit-row"><span>Potential profit</span><strong>+${money(q.profit)}</strong></div>`;
    $('review-dialog').showModal();
  });
  $('confirm-prediction').addEventListener('click',async()=>{
    if(!review)return;
    const m=markets.find(m=>m.id===review.marketId),q=quote(m,review.side,review.budget,balance());
    if(!q||review.coin!==window.RolrModel.coin.symbol||review.hour!==window.RolrModel.hour){$('review-dialog').close();review=null;notify('Market changed. Review your prediction again.');return;}
    const button=$('confirm-prediction');button.disabled=true;
    try{await account.place(review);review=null;$('review-dialog').close();notify('Demo prediction saved to your account.');}
    catch(error){notify(error.message);}
    finally{button.disabled=false;}
  });
  function renderAccount(){
    positions=account.predictions.map(p=>({...p,marketId:p.market_id,minutes:Number(p.market_id.split('-')[0]),start:new Date(p.starts_at*1000).toISOString().slice(11,16),end:new Date(p.ends_at*1000).toISOString().slice(11,16),cost:p.cost_cents/100}));
    $('account-name').textContent=account.user?.name||'';
    $('account-name').hidden=!account.user;$('logout-button').hidden=!account.user;
    $('login-link').hidden=!!account.user;$('signup-link').hidden=!!account.user;
    $('positions-storage').textContent=account.user?'Live orders only':'Log in to save predictions';
    renderPositions();renderTicket();
  }
  $('logout-button').addEventListener('click',()=>account.logout().catch(error=>notify(error.message)));
  window.addEventListener('account-update',renderAccount);
  window.addEventListener('coin-change',()=>{initialMarketChosen=false;review=null;$('review-dialog').close();renderMarkets();renderTicket();});
  window.addEventListener('btc-market-update',()=>{if(!initialMarketChosen){const active=markets.find(m=>m.minutes===15&&m.status==='open'&&Number.isFinite(m.strike));if(active){market=active;initialMarketChosen=true;}}review=null;$('review-dialog').close();renderMarkets();renderTicket();});
  window.addEventListener('btc-chances-update',renderChances);
  window.addEventListener('btc-price-update',()=>{renderChances();const delta=(window.RolrModel.isHistorical?market.close:window.RolrModel.spot)-market.strike; $('ticket-delta').textContent=Number.isFinite(market.strike)&&Number.isFinite(window.RolrModel.isHistorical?market.close:window.RolrModel.spot)?(delta>=0?'+':'−')+price(Math.abs(delta)):'—';$('ticket-delta').style.color=delta>=0?'var(--green)':'var(--red)';});
  setInterval(renderPendingTimes,1000);
  renderMarkets();renderAccount();
})();
