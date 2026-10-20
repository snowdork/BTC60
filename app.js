/** @module app
 * Render prediction intervals, order review, live purchase quotes, and saved positions.
 */
(() => {
  'use strict';
  const {markets,quote,outcome,initialBalance,maxPredictionCredits}=window.PredictModel;
  const elements=new Map();
  const /** Find an interface element by its stable DOM identifier. */ $=id=>{if(!elements.has(id))elements.set(id,document.getElementById(id));return elements.get(id);};
  const sideButtons=[...document.querySelectorAll('[data-side]')];
  const stakeButtons=[...document.querySelectorAll('[data-stake]')];
  const marketElements=new Map();
  const /** Format an instrument price with the active or supplied instrument precision. */ price=value=>window.PredictCoins.formatPrice(value,window.PredictModel.coin.symbol);
  const currency=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const /** Format game credits without changing the USD market-price display. */ money=value=>currency.format(value)+' credits';
  const shareFormatter=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
  const /** Format fractional prediction shares for display. */ shares=value=>shareFormatter.format(value);
  const account=window.Predict60Account;
  let playMode='contest';
  let positions=[];
  const predictionIndex=new Map();
  const /** Build an instrument, interval, and start-time key to distinguish orders in repeated hours. */ predictionKey=(coin,id,start)=>`${coin}:${id}:${start}`;
  /** Find saved predictions matching an instrument and exact interval start. */ function segmentPredictions(selected){
    const model=window.PredictModel;
    return account.user&&model.feedMode!=='demo'?predictionIndex.get(predictionKey(model.coin.symbol,selected.id,selected.startsAt))||[]:[];
  }
  const /** Update a DOM text node only when the displayed value changes. */ setText=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
  let market=markets.find(m=>m.id==='15-2'),side=null,review=null,initialMarketChosen=false,submitting=false,budgetMarketKey=null;
  const /** Return the signed-in account balance in credits or the initial preview balance. */ balance=()=>account.user?(playMode==='contest'?(account.contestWallet?.remaining_cents||0):account.user.balance_cents)/100:initialBalance;
  /** Limit contest spending by remaining allowance and aggregate instrument/interval exposure. */ function budgetAvailable(selected=market){
    if(playMode!=='contest')return Math.min(balance(),maxPredictionCredits);
    const spent=account.predictions.filter(p=>p.mode==='contest'&&p.coin===window.PredictModel.coin.symbol&&p.starts_at*1000===selected.startsAt&&p.ends_at*1000===selected.endsAt).reduce((total,p)=>total+p.cost_cents,0)/100;
    return Math.max(0,Math.min(balance(),maxPredictionCredits-spent));
  }
  /** Show a transient accessible status message to the user. */ function notify(message) {
    $('notification').textContent=message;$('notification').classList.add('visible');
    clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('notification').classList.remove('visible'),4500);
  }
  /** Render status line from the latest account, market, and interface state. */ function renderStatusLine(){
    const open=market.status==='open',queued=market.status==='queued',model=window.PredictModel;
    $('selected-bet').textContent=`${model.coin.symbol} · ${market.minutes} MIN · ${side==='up'?'↗ Up':side==='down'?'↘ Down':'Pick Up or Down'}`;
    $('selected-bet').style.color=side==='up'?'var(--green)':side==='down'?'#ff6a84':'#3b82f6';
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
  /** Read the market model readiness checks used to block invalid order submission. */ function health(){return window.PredictModel.dataStatus(window.PredictModel,market);}
  /** Render prediction context from the latest account, market, and interface state. */ function renderPredictionContext(){
    const model=window.PredictModel,closed=market.status==='settled',queued=market.status==='queued';
    const benchmark=Number.isFinite(market.strike)?market.strike:null;
    const age=Date.now()-model.priceUpdatedAt;
    const fresh=model.feedMode==='demo'||(model.feedConnection==='connected'&&model.priceUpdatedAt>0&&age>=-5000&&age<=(model.coin.maxPriceAgeMs||15000));
    const value=closed?market.close:!queued&&fresh?model.spot:null;
    const available=Number.isFinite(value)&&benchmark!==null;
    $('ticket-spot-label').textContent=model.coin.feed==='oilpriceapi'?'SPOT ASSESSMENT · USD / BARREL':closed?'CLOSING BENCHMARK':model.feedMode==='demo'?'SYNTHETIC SPOT':model.coin.feed==='simulated'?'SIMULATED · USD / BARREL':model.coin.feed==='twelvedata'?'LIVE SPOT · USD / BARREL':'LIVE SPOT';
    $('ticket-spot').textContent=Number.isFinite(value)?price(value):'—';
    $('ticket-price-time').hidden=closed;
    $('ticket-price-time').textContent=closed?'':queued?'Starting benchmark is set when this interval opens':model.feedMode==='demo'?'Synthetic preview · no account orders':fresh?`Source update ${new Date(model.priceUpdatedAt).toISOString().slice(11,19)} UTC`: 'Waiting for a connected, fresh price';
    const start=market.startsAt,end=market.endsAt;
    if(Number.isFinite(start)&&Number.isFinite(end)){
      const hour=Math.floor(start/3600000)*3600000;
      const /** Format an interval timestamp as UTC hour and minute. */ utc=t=>new Date(t).toISOString().slice(11,16);
      $('ticket-hour-selection').style.left=`${(start-hour)/3600000*100}%`;
      $('ticket-hour-selection').style.width=`${market.minutes/60*100}%`;
      $('ticket-hour-start').textContent=utc(hour);$('ticket-hour-end').textContent=utc(hour+3600000);
      $('ticket-hour-map').setAttribute('aria-label',`Selected ${market.minutes}-minute interval ${utc(start)} to ${utc(end)} UTC within the hour`);
      $('ticket-interval-timing').textContent=closed?'Interval complete':queued?`Opens ${utc(start)} UTC`:`${market.remaining} left`;
    }
    const delta=available?value-benchmark:null;
    $('ticket-spot').style.color=closed&&delta!==null?(delta>=0?'var(--green)':'var(--red)'):'';
    $('ticket-comparison').textContent=queued?'Benchmark available at open':!available?'Comparison unavailable':`${delta===0?'At the benchmark':`${price(Math.abs(delta))} ${delta>0?'above':'below'} benchmark`} (${delta>=0?'+':''}${(delta/benchmark*100).toFixed(3)}%)`;
    $('ticket-comparison').style.color=delta===null?'var(--muted)':delta>=0?'var(--green)':'var(--red)';
    $('ticket-up-rule').textContent=benchmark===null?'↗ Up: close ≥ benchmark':`↗ Up: close ≥ ${price(benchmark)}`;
    $('ticket-down-rule').textContent=benchmark===null?'↘ Down: close < benchmark':`↘ Down: close < ${price(benchmark)}`;
    const context=document.querySelector('.prediction-context');
    context.dataset.side=side||'';
  }
  /** Render execution state from the latest account, market, and interface state. */ function renderExecutionState(){
    renderPredictionContext();
    const model=window.PredictModel,state=health();
    const chance=market.status==='open'&&(state.ready||model.feedMode==='demo')?model.estimateChances(market,model.spot,model.now,model.volatility):null;
    $('up-chance').textContent=chance?`${chance.up}%`:'—';
    $('down-chance').textContent=chance?`${chance.down}%`:'—';
    const q=renderLivePricing(chance);

    $('price-health').textContent=model.feedMode==='demo'?'Synthetic preview':model.isHistorical?'Historical view':state.age===null?'Spot: no live update':`${model.coin.feed==='simulated'?'Simulated price':model.coin.feed==='twelvedata'?'Oil spot':'Spot'} updated ${state.age}s ago`;
    $('history-health').textContent=model.feedMode==='demo'?'Synthetic benchmarks':model.historyStatus==='ready'?'History loaded':model.historyStatus==='error'?'History unavailable':'Loading history';
    $('execution-health').textContent=state.ready?`Data ready · ${model.calibrations?.[model.coin.symbol]?'Calibrated':'Uncalibrated'} model`:state.reason;
    $('execution-health').style.color=state.ready?'var(--green)':'var(--amber)';
    $('submit-prediction').disabled=!state.ready||(side!==null&&!q)||!account.ready;
    $('submit-prediction').textContent=!state.ready?state.reason:side===null?'Pick Up or Down':!account.user?'Log in to predict →':`Review ${side==='up'?'Up':'Down'} prediction →`;
    sideButtons.forEach(button=>{button.disabled=market.status!=='open'||!state.ready;});
    $('confirm-prediction').disabled=submitting||!state.ready||reviewExpired();
    const delta=model.spot-market.strike;
    $('ticket-delta').textContent=(model.isHistorical||market.status==='settled')&&Number.isFinite(market.close)&&Number.isFinite(market.strike)?(market.close>=market.strike?'+':'−')+price(Math.abs(market.close-market.strike)):state.age!==null&&state.age<=15&&Number.isFinite(delta)&&Number.isFinite(market.strike)?(delta>=0?'+':'−')+price(Math.abs(delta)):'—';
    $('ticket-delta').style.color=delta>=0?'var(--green)':'var(--red)';
    if(review&&!reviewExpired()&&!state.ready&&!submitting){review=null;$('review-dialog').close();notify('Data unavailable. Wait for reconnection and review again.');}
  }
  /** Check whether the reviewed interval has reached its final thirty-second order cutoff. */ function reviewExpired(){return !!review&&Date.now()>=review.endsAt-30000;}
  /** Render review timing from the latest account, market, and interface state. */ function renderReviewTiming(){
    if(!review)return;
    const seconds=Math.max(0,Math.ceil((review.endsAt-30000-Date.now())/1000));
    $('review-time').textContent=seconds?`${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s to betting cutoff`:'Betting closed · final 30 seconds';
    $('review-time').classList.toggle('expired',!seconds);
    if(!seconds){$('confirm-prediction').disabled=true;if(!submitting)$('confirm-prediction').textContent='Too late to place';}
  }
  let reviewSummarySignature='';
  /** Render review summary from the latest account, market, and interface state. */ function renderReviewSummary(q){
    const signature=`${q.cents}:${q.contracts}`;
    if(signature===reviewSummarySignature)return;
    reviewSummarySignature=signature;
    $('review-summary').innerHTML=`<div><span>${shares(q.contracts)} shares at ${(q.cents/100).toFixed(2)} credits</span><strong>${money(q.cost)}</strong></div><div><span>Return if correct</span><strong>${money(q.payout)}</strong></div><div class="profit-row"><span>Potential profit</span><strong>+${money(q.profit)}</strong></div>`;
  }
  /** Render review chance from the latest account, market, and interface state. */ function renderReviewChance(){
    if(!review)return;
    renderReviewTiming();
    if(reviewExpired())return;
    const model=window.PredictModel,m=markets.find(item=>item.id===review.marketId);
    if(m&&!submitting){
      review.strike=m.strike;
      $('review-detail').textContent=`${review.start} – ${review.end} UTC · Benchmark ${price(m.strike)} · Live ${price(model.spot)}`;
    }
    const chance=m&&model.dataStatus(model,m).ready?model.estimateChances(m,model.spot,model.now,model.volatility):null;
    $('review-chance').textContent=submitting?`${review.cents}% ${review.side==='up'?'Up':'Down'}`:chance?`${chance[review.side]}% ${review.side==='up'?'Up':'Down'}`:'—';
    $('review-chance').title='Heuristic model estimate and prediction credit cost. Updates with the selected price feed.';
    if(chance&&!submitting){
      const q=quoteFor(m,review.side,review.budget,chance);
      if(q){Object.assign(review,q);renderReviewSummary(q);}
    }

  }
  /** Render chances from the latest account, market, and interface state. */ function renderChances() {
    const model=window.PredictModel;
    renderStatusLine();
    renderExecutionState();
    renderReviewChance();
    markets.forEach(m=>{
      const assessment=model.coin.feed==='oilpriceapi'&&model.feedMode==='live'&&!model.isHistorical;
      const reference=marketElements.get(m.id)?.reference;
      if(reference){reference.hidden=!assessment;setText(reference,assessment&&Number.isFinite(model.spot)?price(model.spot):'—');}
      const element=marketElements.get(m.id)?.chances;if(!element)return;
      element.hidden=m.status==='queued';
      if(element.hidden)return;
      const stale=m.status==='open'&&model.feedMode==='live'&&!model.dataStatus(model,m).ready;
      const chance=stale?null:model.estimateChances(m,model.spot,model.now,model.volatility);
      const distance=marketElements.get(m.id)?.distance;
      if(distance){
        const delta=model.spot-m.strike,hasPrice=Number.isFinite(model.spot)&&model.spot>0,hasTarget=Number.isFinite(m.strike)&&m.strike>0;
        const age=Date.now()-model.priceUpdatedAt;
        const fresh=model.feedMode==='demo'||(Number.isFinite(age)&&model.priceUpdatedAt>0&&age>=-5000&&age<=(model.coin.maxPriceAgeMs||15000));
        const valid=hasPrice&&hasTarget&&fresh;
        distance.textContent=assessment?'Latest spot assessment · reference only':valid?`${delta>=0?'↗ +':'↘ −'}${(Math.abs(delta)/m.strike*100).toFixed(2)}% ${delta>=0?'above':'below'}`:!hasTarget?'Waiting for target':!hasPrice?'Waiting for price':'Waiting for fresh price';
        distance.style.color=valid?(delta>=0?'var(--green)':'var(--red)'):'var(--muted)';
      }
      setText(marketElements.get(m.id).up,`↗ Up ${chance?chance.up+'%':'—'}`);
      setText(marketElements.get(m.id).down,`↘ Down ${chance?chance.down+'%':'—'}`);
      element.title=chance?.label==='ESTIMATE'?'Model probability based on adaptive 24-hour volatility and time to settlement. Historical calibration applies when validated for this coin; prediction credit costs follow these percentages.':chance?.label==='BASELINE'?'Neutral baseline for an upcoming interval.':chance?.label==='RESULT'?'Completed result, not a forecast.':'Waiting for a fresh price and valid benchmark.';
    });
  }
  /** Render segment predictions from the latest account, market, and interface state. */ function renderSegmentPredictions(){
    markets.forEach(m=>{
      const container=marketElements.get(m.id)?.predictions;if(!container)return;
      const saved=segmentPredictions(m);
      const stamp=marketElements.get(m.id)?.card.querySelector('.settled-stamp');
      if(stamp){
        const pending=saved.some(p=>p.settled_at==null);
        const won=saved.some(p=>p.settled_at!=null&&p.outcome===p.side);
        const lost=saved.some(p=>p.settled_at!=null&&p.outcome!==p.side);
        const wonCents=saved.filter(p=>p.settled_at!=null&&p.outcome===p.side).reduce((total,p)=>total+(p.payout_cents||0)-p.cost_cents,0);
        const lostCents=saved.filter(p=>p.settled_at!=null&&p.outcome!==p.side).reduce((total,p)=>total+p.cost_cents,0);
        const winLabel=`Win +${money(wonCents/100)}`,lossLabel=`Loss −${money(lostCents/100)}`;
        stamp.textContent=!saved.length?'No wager':pending?'Awaiting settlement':won&&lost?`${winLabel} / ${lossLabel}`:won?winLabel:lossLabel;
        stamp.title=!saved.length?'No wager in this segment':pending?'Waiting for all your wagers to settle':`Net result: ${money((wonCents-lostCents)/100)}. Winnings exclude the original wager cost.`;
        stamp.classList.toggle('has-wager',saved.length>0);
        stamp.classList.toggle('won',!pending&&won&&!lost);
        stamp.classList.toggle('lost',!pending&&lost&&!won);
        stamp.removeAttribute('aria-hidden');
      }
      container.replaceChildren(...saved.map(p=>{
        const status=p.settled_at==null?'pending':p.outcome===p.side?'won':'lost';
        const badge=document.createElement('span');
        badge.className=`segment-prediction ${status==='pending'?p.side:status}`;
        badge.textContent=`${p.side==='up'?'↑':'↓'} ${money(p.cost_cents/100)} @ ${p.cents}%`;
        const label=`Your ${p.side==='up'?'Up':'Down'} bet · ${money(p.cost_cents/100)} at ${p.cents}% · ${status==='pending'?'pending':status==='won'?'Win':'Loss'}`;
        badge.title=label;badge.setAttribute('aria-label',label);
        return badge;
      }));
      container.hidden=m.status==='settled'||!saved.length;
    });
  }
  /** Render markets from the latest account, market, and interface state. */ function renderMarkets() {
    $('market-grid').innerHTML=[60,30,15].map(minutes=>{
      const items=markets.filter(m=>m.minutes===minutes);
      return `<div class="tier" data-duration="${minutes}"><div class="tier-label">${minutes}<small>MINUTES</small></div><div class="tier-cards" style="--columns:${items.length}">${items.map(m=>{
        const settled=m.status==='settled',queued=m.status==='queued',result=settled&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?outcome(m.strike,m.close):null;
        return `<button type="button" class="market-card ${m.status} ${result?'result-'+result:''} ${m.id===market.id?'selected':''}" data-market="${m.id}" aria-pressed="${m.id===market.id}" aria-label="${minutes} minute market ${m.start} to ${m.end} UTC, ${m.status}"><div class="card-top"><span class="card-time">${m.start} – ${m.end}</span><span class="badge ${queued?'neutral':settled?(result===null?'neutral':result==='up'?'green':'red'):'green'}">${queued?'UPCOMING':settled?(result===null?'CLOSED':result==='up'?'↗ UP WON':'↘ DOWN WON'):'● OPEN'}</span></div><div class="card-benchmark"><div class="segment-price"><span class="initial-price" ${window.PredictModel.coin.feed==='oilpriceapi'&&window.PredictModel.feedMode==='live'&&!window.PredictModel.isHistorical?'hidden':''}>${Number.isFinite(m.strike)?price(m.strike):'—'}</span>${settled&&Number.isFinite(m.close)?`<span class="settlement-separator" aria-label="to">→</span><strong class="settlement-price ${result||''}">${price(m.close)}</strong>`:''}<span data-reference-price="${m.id}" hidden></span>${m.status==='open'?`<span class="segment-countdown" data-remaining="${m.id}">${m.remaining}</span>`:''}</div>${queued?'<small>Benchmark set at open</small>':''}</div><div class="card-context"><div class="card-distance" data-distance="${m.id}" ${m.status!=='open'?'hidden':''}>Spot distance unavailable</div><div class="card-bottom">${queued?`<span class="queued-label">Opens at ${m.start}</span>`:settled?`${Number.isFinite(m.close)?'':'<span>Awaiting history</span>'}`:''}</div></div><div class="chance-block" data-chances="${m.id}"><div class="chance-row">${settled&&result!==null?`<span class="segment-result ${result}" role="img" aria-label="${result==='up'?'Up':'Down'} won" title="${result==='up'?'Up':'Down'} won">${result==='up'?'↑':'↓'}</span>`:''}${settled?'<span class="settled-stamp">No wager</span>':''}<span class="chance-up" ${settled?'hidden':''}>↗ Up —</span><span class="chance-down" ${settled?'hidden':''}>↘ Down —</span></div></div><span class="segment-predictions" data-predictions="${m.id}" hidden></span></button>`;
      }).join('')}</div></div>`;
    }).join('');
    marketElements.clear();
    $('market-grid').querySelectorAll('[data-market]').forEach(card=>{
      marketElements.set(card.dataset.market,{card,chances:card.querySelector('[data-chances]'),distance:card.querySelector('[data-distance]'),reference:card.querySelector('[data-reference-price]'),predictions:card.querySelector('[data-predictions]'),up:card.querySelector('.chance-up'),down:card.querySelector('.chance-down')});
    });
    renderSegmentPredictions();
    renderChances();
  }
  /** Estimate the selected interval probabilities from the current underlying observation. */ function liveChance(selected=market){const model=window.PredictModel;return model.estimateChances(selected,model.spot,model.now,model.volatility);}
  /** Compute a budget-constrained order quote using live direction probabilities. */ function quoteFor(selected,direction,budget,chance=liveChance(selected)){return chance?quote({...selected,up:chance.up},direction,budget,budgetAvailable(selected)):null;}
  /** Read the ticket stake and selected side to produce the current executable demo quote. */ function currentQuote() {return quoteFor(market,side,Number($('stake').value));}
  /** Render live pricing from the latest account, market, and interface state. */ function renderLivePricing(chance){
    const open=market.status==='open',q=open?quoteFor(market,side,Number($('stake').value),chance):null;
    $('up-price').textContent=open&&chance?`${(chance.up/100).toFixed(2)} credits`:'—';
    $('down-price').textContent=open&&chance?`${(chance.down/100).toFixed(2)} credits`:'—';
    $('contract-price').textContent=q?`at ${(q.cents/100).toFixed(2)} credits each`:'';
    $('contracts').textContent=q?shares(q.contracts):'—';$('cost').textContent=q?money(q.cost):'—';$('return').textContent=q?money(q.payout):'—';$('profit').textContent=q?'+'+money(q.profit):'—';
    if(open)$('ticket-note').textContent=q?'Bets close 30s before interval end · No real money':(side===null?'Choose Up or Down to review your prediction.':'Enter 1–1,000 credits within your available balance.');
    return q;
  }
  /** Render interval details from the latest account, market, and interface state. */ function renderIntervalDetails(){
    const model=window.PredictModel,queued=market.status==='queued';
    const result=!queued&&Number.isFinite(market.strike)&&Number.isFinite(market.close)?outcome(market.strike,market.close):null;
    $('interval-result').textContent=queued?'Upcoming interval':result?`${result==='up'?'↑ Up':'↓ Down'} settled`:'Awaiting settlement price';
    $('interval-result').style.color=queued?'var(--amber)':result==='up'?'var(--green)':result==='down'?'var(--red)':'var(--muted)';
    const facts=[['Coin',`${model.coin.name} (${model.coin.symbol})`],['Duration',`${market.minutes} minutes`],['Time frame',`${market.start} – ${market.end} UTC`]];
    if(Number.isFinite(market.startsAt))facts.push(['Date',new Date(market.startsAt).toISOString().slice(0,10)]);
    if(queued){facts.push(['Starting target','Set when the interval opens']);}
    else{
      facts.push(['Closing price',Number.isFinite(market.close)?price(market.close):'Awaiting history']);
      const saved=segmentPredictions(market);
      if(saved.length){
        const settled=saved.filter(p=>p.settled_at!=null),cost=saved.reduce((sum,p)=>sum+p.cost_cents,0),paid=settled.reduce((sum,p)=>sum+p.payout_cents,0);
        facts.push(['Your committed amount',money(cost/100)],['Your bets',saved.map(p=>`${p.side==='up'?'↑ Up':'↓ Down'} · ${money(p.cost_cents/100)} · ${p.settled_at==null?'Awaiting settlement':p.outcome===p.side?'✓ Won':'✕ Lost'}`).join('; ')],['Returned so far',money(paid/100)]);
        if(settled.length===saved.length)facts.push(['Your net result',money((paid-cost)/100)]);
      }
    }
    $('interval-facts').replaceChildren(...facts.flatMap(([label,value])=>{const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;return [term,detail];}));
    $('interval-message').textContent=queued?'Predictions become available when this interval opens. Up includes an unchanged price.':result?'This interval is closed. Account settlements may remain pending until the closing candle is available.':'This interval is closed. Missing candle data keeps settlement pending.';
  }
  /** Render ticket from the latest account, market, and interface state. */ function renderTicket() {
    const nextBudgetKey=predictionKey(window.PredictModel.coin.symbol,market.id,market.startsAt);
    // A new instrument or interval requires a fresh budget, including on initial load.
    if(nextBudgetKey!==budgetMarketKey){$('stake').value='';budgetMarketKey=nextBudgetKey;}
    renderStatusLine();
    const open=market.status==='open',queued=market.status==='queued';
    $('ticket-heading').textContent=open?'Make a prediction':queued?'Upcoming interval':'Settlement details';
    $('ticket-mode').textContent=open?'POINTS PREDICTION':queued?'UPCOMING':'CLOSED';
    $('ticket-mode').className='badge '+(open?'green':queued?'amber':'neutral');
    $('prediction-controls').hidden=!open;$('interval-details').hidden=open;
    $('ticket-coin-icon').src=window.PredictModel.coin.icon||'assets/coins/btc.svg';
    $('ticket-coin-icon').alt=window.PredictModel.coin.symbol;
    if(!open)renderIntervalDetails();
    $('ticket-duration').textContent=`${market.minutes} MIN`;
    $('ticket-selected-duration').textContent=`${market.minutes}-minute ${open?'prediction':queued?'interval':'settlement'}`;
    $('ticket-selected-range').textContent=`${market.start} – ${market.end} UTC`;
    $('ticket-status').textContent=open?'OPEN':queued?'UPCOMING':'SETTLED';
    $('ticket-status').className='badge '+(open?'green':'neutral');
    $('ticket-time').textContent=`${market.start} – ${market.end} UTC`;
    $('ticket-question').textContent=open?`${window.PredictModel.coin.name} up or down?`:window.PredictModel.coin.name;
    $('ticket-strike').textContent=queued?'Set at open':Number.isFinite(market.strike)?price(market.strike):'Loading…';
    $('ticket-delta-label').textContent=(window.PredictModel.isHistorical||market.status==='settled')?'SETTLED VS BENCHMARK':'SPOT VS BENCHMARK';
    sideButtons.forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.side===side));button.disabled=!open;});
    $('stake').disabled=!open;$('stake').max=budgetAvailable().toFixed(2);
    stakeButtons.forEach(button=>{button.disabled=!open;const amount=button.dataset.stake==='max'?budgetAvailable():Number(button.dataset.stake);button.classList.toggle('selected',Number($('stake').value)===amount);button.setAttribute('aria-pressed',String(Number($('stake').value)===amount));});
    const q=currentQuote();
    $('submit-prediction').classList.toggle('bear',side==='down');
    $('submit-prediction').classList.toggle('pick-direction',side===null);
    $('ticket-note').textContent=!open?(queued?'Select an open market to make a prediction.':Number.isFinite(market.strike)&&Number.isFinite(market.close)?`Settlement: ${outcome(market.strike,market.close)==='up'?'Up':'Down'} at ${price(market.close)}.`:'Waiting for market history.'):!q?(side===null?'Choose Up or Down to review your prediction.':'Enter 1–1,000 credits within your available balance.'):'Bets close 30s before interval end · No real money';
    $('settlement-description').textContent=!Number.isFinite(market.strike)&&!queued?'Waiting for a benchmark from minute history.':queued?'The starting benchmark is set when this interval opens.':`Up wins if the closing minute-candle close is at least ${price(market.strike)}. An unchanged price resolves Up. ${window.PredictModel.coin.feed==='twelvedata'?'Twelve Data oil minute close · USD/barrel':window.PredictModel.coin.feed==='simulated'?'Simulated oil benchmark · USD/barrel':'Coinbase proxy · not a 60-second average'}. `;
    $('balance').textContent=money(balance());
    renderExecutionState();
  }
  let pendingSignature='';
  /** Render pending times from the latest account, market, and interface state. */ function renderPendingTimes(){
    if(document.hidden)return;
    positions.filter(p=>p.settled_at==null).forEach(p=>{
      const label=document.getElementById(`pending-time-${p.id}`);if(!label)return;
      const seconds=Math.max(0,Math.ceil(p.ends_at-Date.now()/1000));
      const status=seconds?`${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s left`:'Awaiting settlement';
      label.textContent=`${p.start}–${p.end} UTC · ${new Date(p.starts_at*1000).toISOString().slice(0,10)} · ${status}`;
    });
  }
  /** Render positions from the latest account, market, and interface state. */ function renderPositions() {
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
      const values=document.createElement('div'),cost=document.createElement('strong'),contracts=document.createElement('small');cost.textContent=money(p.cost);contracts.textContent=`${shares(p.contracts)} shares · ${money(Math.ceil(p.cost_cents*100/p.cents)/100)} if correct`;values.append(cost,contracts);row.append(detail,values);return row;
    }));
    renderPendingTimes();
  }
  $('market-grid').addEventListener('click',event=>{
    const button=event.target.closest('[data-market]');if(!button)return;
    market=markets.find(m=>m.id===button.dataset.market);side=null;
    review=null;$('review-dialog').close();
    marketElements.forEach(({card},id)=>{const selected=id===market.id;card.classList.toggle('selected',selected);card.setAttribute('aria-pressed',String(selected));});
    renderTicket();
  });
  let directionHintTimer;
  /** Highlight chosen direction controls consistently across interval cards. */ function highlightDirections(){
    clearTimeout(directionHintTimer);
    sideButtons.forEach(button=>button.classList.remove('direction-hint'));
    void sideButtons[0].offsetWidth;
    sideButtons.forEach(button=>button.classList.add('direction-hint'));
    sideButtons[0].scrollIntoView({block:'center',behavior:'auto'});
    sideButtons[0].focus({preventScroll:true});
    directionHintTimer=setTimeout(()=>sideButtons.forEach(button=>button.classList.remove('direction-hint')),1100);
  }
  sideButtons.forEach(button=>button.addEventListener('click',()=>{side=button.dataset.side;sideButtons.forEach(item=>item.classList.remove('direction-hint'));renderTicket();}));
  stakeButtons.forEach(button=>button.addEventListener('click',()=>{$('stake').value=button.dataset.stake==='max'?budgetAvailable().toFixed(2):button.dataset.stake;renderTicket();}));
  $('stake').addEventListener('input',renderTicket);
  $('prediction-mode').addEventListener('change',()=>{playMode=$('prediction-mode').value;review=null;$('review-dialog').close();$('stake').value='';$('balance-label').textContent=playMode==='contest'?'Contest allowance':'Practice balance';$('prediction-mode-note').textContent=playMode==='contest'?'Hourly close HH:00 GMT · 1,000 total credits per hour':'Practice does not affect contest rank';renderAccount();});
  ['rules-open','rules-inline'].forEach(id=>$(id).addEventListener('click',()=>$('rules-dialog').showModal()));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('prediction-form').addEventListener('submit',event=>{
    event.preventDefault();if(side===null){highlightDirections();notify('Choose Up or Down to review your prediction.');return;}if(!account.user){location.href='login.html';return;}if(!health().ready){notify(health().reason);return;}const q=currentQuote();if(!q)return;
    review={mode:playMode,requestId:crypto.randomUUID(),startsAt:market.startsAt,endsAt:market.endsAt,coin:window.PredictModel.coin.symbol,marketId:market.id,start:market.start,end:market.end,minutes:market.minutes,strike:market.strike,hour:window.PredictModel.hour,side,budget:Number($('stake').value),...q};
    const down=review.side==='down',arrow=down?'↓':'↑',direction=down?'Down':'Up';
    $('review-direction').classList.toggle('down',down);
    $('review-arrow').textContent=arrow;
    $('review-side').textContent=`Predict ${direction}`;
    $('confirm-prediction').classList.toggle('bear',down);
    $('confirm-prediction').textContent=down?'Predict DOWN Now':'Predict UP Now';
    $('review-title').textContent=`${playMode==='contest'?'Contest':'Practice'} · ${side==='up'?'Up':'Down'} · ${window.PredictModel.coin.name} ${market.minutes} min`;
    $('review-detail').textContent=`${market.start} – ${market.end} UTC · Benchmark ${price(market.strike)}`;
    renderReviewSummary(q);
    $('review-error').textContent='';
    renderReviewChance();
    $('review-dialog').showModal();
  });
  $('confirm-prediction').addEventListener('click',async()=>{
    if(!review||submitting)return;
    if(reviewExpired()){renderReviewTiming();return;}
    if(!health().ready){notify(health().reason);review=null;$('review-dialog').close();return;}
    const m=markets.find(m=>m.id===review.marketId),q=quoteFor(m,review.side,review.budget);
    if(!q||review.coin!==window.PredictModel.coin.symbol||review.hour!==window.PredictModel.hour){$('review-dialog').close();review=null;notify('Market changed. Review your prediction again.');return;}
    Object.assign(review,q,{strike:m.strike});renderReviewSummary(q);
    const button=$('confirm-prediction'),buttonLabel=button.textContent;submitting=true;button.disabled=true;button.textContent='Saving prediction…';$('review-error').textContent='';
    try{await account.place({...review});review=null;side=null;$('stake').value='';$('review-dialog').close();renderTicket();notify('Prediction saved to your '+playMode+' history.');}
    catch(error){$('review-error').textContent=error.message;notify(error.message);}
    finally{submitting=false;button.textContent=buttonLabel;renderExecutionState();renderReviewChance();}
  });
  /** Render account from the latest account, market, and interface state. */ function renderAccount(){
    positions=account.predictions.filter(p=>(p.mode||'practice')===playMode).map(p=>({...p,marketId:p.market_id,minutes:Number(p.market_id.split('-')[0]),start:new Date(p.starts_at*1000).toISOString().slice(11,16),end:new Date(p.ends_at*1000).toISOString().slice(11,16),cost:p.cost_cents/100}));
    predictionIndex.clear();
    positions.forEach(p=>{const key=predictionKey(p.coin,p.marketId,p.starts_at*1000);if(!predictionIndex.has(key))predictionIndex.set(key,[]);predictionIndex.get(key).push(p);});
    const previous=account.lastHourContest;
    if(previous){
      const start=new Date(previous.starts_at*1000),end=new Date(previous.ends_at*1000);
      $('last-hour-range').textContent=`${start.toISOString().slice(0,10)} · ${start.toISOString().slice(11,16)}–${end.toISOString().slice(11,16)} GMT`;
      const score=previous.score_cents/100;
      $('last-hour-score').textContent=previous.state==='no_entries'?'—':`${score>0?'+':''}${score.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} credits`;
      $('last-hour-score').style.color=previous.state==='no_entries'?'var(--muted)':score<0?'var(--red)':score>0?'var(--green)':'var(--text)';
      $('last-hour-state').textContent=previous.state==='no_entries'?'No contest entries':previous.state==='final'?`Final · ${previous.rank===1?'Winner':'Rank '+previous.rank}`:`Provisional · awaiting settlement${previous.pending?' · '+previous.pending+' pending':''}`;
    }else{
      $('last-hour-range').textContent='—';$('last-hour-score').textContent='—';$('last-hour-state').textContent=account.user?'Loading results…':'Log in to see your score';
    }
    const wallet=account.contestWallet;
    $('hourly-tally').hidden=playMode!=='contest';
    $('hourly-tally').textContent=wallet?.reset_pending?'Previous hour awaiting settlement — credits unlock after winners are final.':`This hour won / lost: ${(wallet?.net_cents||0)>0?'+':''}${((wallet?.net_cents||0)/100).toFixed(2)} credits · ${wallet?.pending||0} pending`;
    $('positions-storage').textContent=account.user?'Live orders only':'Log in to save predictions';
    renderSegmentPredictions();renderPositions();renderTicket();
  }
  window.addEventListener('account-update',()=>{if(account.error)notify(account.error);});
  window.addEventListener('account-update',renderAccount);
  window.addEventListener('coin-change',()=>{initialMarketChosen=false;side=null;review=null;$('review-dialog').close();renderMarkets();renderTicket();});
  window.addEventListener('btc-market-update',()=>{if(!initialMarketChosen){const active=markets.find(m=>m.minutes===15&&m.status==='open'&&Number.isFinite(m.strike));if(active){market=active;initialMarketChosen=true;}}if(review&&review.hour!==window.PredictModel.hour&&!reviewExpired()){review=null;$('review-dialog').close();}renderMarkets();renderTicket();renderReviewChance();});
  window.addEventListener('btc-chances-update',renderChances);
  window.addEventListener('btc-price-update',renderChances);
  setInterval(()=>{renderPendingTimes();renderReviewTiming();},1000);
  renderMarkets();renderAccount();
})();
