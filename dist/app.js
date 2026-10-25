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
  let pendingPositions=[];
  const predictionIndex=new Map();
  const /** Build an instrument, interval, and start-time key to distinguish orders in repeated hours. */ predictionKey=(coin,id,start)=>`${coin}:${id}:${start}`;
  /** Find saved predictions matching an instrument and exact interval start. */ function segmentPredictions(selected){
    const model=window.PredictModel;
    return account.user&&model.feedMode!=='demo'?predictionIndex.get(predictionKey(model.coin.symbol,selected.id,selected.startsAt))||[]:[];
  }
  const /** Update a DOM text node only when the displayed value changes. */ setText=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
  let market=markets.find(m=>m.id==='15-2'),side=null,review=null,initialMarketChosen=false,submitting=false,budgetMarketKey=null;
  const /** Return the signed-in account balance in credits or the initial preview balance. */ balance=()=>account.user?(account.contestWallet?.remaining_cents||0)/100:initialBalance;
  /** Limit each prediction by the hourly balance and per-order credit cap. */ function budgetAvailable(){
    return Math.max(0,Math.min(balance(),maxPredictionCredits));
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
  /** Show insufficient credit state only for a loaded, signed-in open-market ticket. */ function renderCreditState(){
    const exhausted=account.ready&&!!account.user&&market.status==='open'&&balance()<=0;
    $('no-credits-banner').hidden=!exhausted;
    return exhausted;
  }
  /** Render execution state from the latest account, market, and interface state. */ function renderExecutionState(){
    const model=window.PredictModel,state=health(),exhausted=renderCreditState();
    const chance=market.status==='open'&&(state.ready||model.feedMode==='demo')?model.estimateChances(market,model.spot,model.now,model.volatility):null;
    $('up-chance').textContent=chance?`${chance.up}%`:'—';
    $('down-chance').textContent=chance?`${chance.down}%`:'—';
    const q=renderLivePricing(chance);

    $('price-health').textContent=model.feedMode==='demo'?'Synthetic preview':model.isHistorical?'Historical view':state.age===null?'Spot: no live update':`${model.coin.feed==='simulated'?'Simulated price':model.coin.feed==='twelvedata'?'Oil spot':'Spot'} updated ${state.age}s ago`;
    $('history-health').textContent=model.feedMode==='demo'?'Synthetic benchmarks':model.historyStatus==='ready'?'History loaded':model.historyStatus==='error'?'History unavailable':'Loading history';
    $('execution-health').textContent=state.ready?`Data ready · ${model.calibrations?.[model.coin.symbol]?'Calibrated':'Uncalibrated'} model`:state.reason;
    $('execution-health').style.color=state.ready?'var(--green)':'var(--amber)';
    $('submit-prediction').disabled=exhausted||!state.ready||(side!==null&&!q)||!account.ready;
    $('submit-prediction').textContent=exhausted?'NO CREDITS':!state.ready?state.reason:side===null?'Pick Up or Down':!account.user?'Log in to predict →':`Review ${side==='up'?'Up':'Down'} prediction →`;
    sideButtons.forEach(button=>{button.disabled=exhausted||market.status!=='open'||!state.ready;});
    $('stake').disabled=exhausted||market.status!=='open';
    stakeButtons.forEach(button=>{button.disabled=exhausted||market.status!=='open';});
    $('confirm-prediction').disabled=exhausted||submitting||!state.ready||reviewExpired();
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
  /** Refresh segment probabilities and benchmark movement without rebuilding cards. */ function renderChances() {
    const model=window.PredictModel;
    renderStatusLine();
    renderExecutionState();
    renderReviewChance();
    const assessment=model.coin.feed==='oilpriceapi'&&model.feedMode==='live'&&!model.isHistorical;
    const age=Date.now()-model.priceUpdatedAt;
    const fresh=model.feedMode==='demo'||(model.feedConnection==='connected'&&!model.paused&&Number.isFinite(age)&&model.priceUpdatedAt>0&&age>=-5000&&age<=(model.coin.maxPriceAgeMs||15000));
    markets.forEach(m=>{
      const nodes=marketElements.get(m.id);
      if(!nodes?.price)return; // Upcoming and pending cards have no prices or probabilities.
      if(nodes.reference){
        if(nodes.reference.hidden===assessment)nodes.reference.hidden=!assessment;
        setText(nodes.reference,assessment&&Number.isFinite(model.spot)?price(model.spot):'—');
      }
      const ready=!assessment&&(m.status!=='open'||model.feedMode!=='live'||model.dataStatus(model,m).ready);
      const chances=ready?model.estimateChances(m,model.spot,model.now,model.volatility):null;
      setText(nodes.up,`Up ${chances?chances.up+'%':'—'}`);
      setText(nodes.down,`Down ${chances?chances.down+'%':'—'}`);
      const current=m.status==='settled'?m.close:model.spot;
      const valid=!assessment&&(m.status==='settled'||fresh)&&Number.isFinite(current)&&current>0&&Number.isFinite(m.strike)&&m.strike>0;
      if(nodes.direction.hidden===valid)nodes.direction.hidden=!valid;
      if(nodes.change.hidden===valid)nodes.change.hidden=!valid;
      const delta=current-m.strike,direction=valid?(delta>=0?'up':'down'):'';
      if(nodes.price.dataset.direction!==direction)nodes.price.dataset.direction=direction;
      setText(nodes.price,valid?price(current):'—');
      if(!valid)return;
      const movement=(Math.abs(delta)/m.strike*100).toFixed(2);
      const directionClass=`segment-direction ${direction}`,changeClass=`segment-direction-change ${direction}`;
      if(nodes.direction.className!==directionClass)nodes.direction.className=directionClass;
      if(nodes.change.className!==changeClass)nodes.change.className=changeClass;
      const label=`${direction==='up'?'Up':'Down'} ${movement}% ${m.status==='settled'?'at close':'from benchmark'}`;
      if(nodes.direction.getAttribute('aria-label')!==label)nodes.direction.setAttribute('aria-label',label);
      setText(nodes.arrow,direction==='up'?'↑':'↓');
      setText(nodes.change,`${direction==='up'?'Up +':'Down −'}${movement}%`);
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
        const winLabel=`Win +${currency.format(wonCents/100)}`,lossLabel=`Loss −${currency.format(lostCents/100)}`;
        if(!saved.length||pending){
          stamp.textContent=!saved.length?'No wager':'Awaiting settlement';
        }else{
          const resultLabels=[];
          if(won){const label=document.createElement('span');label.className='segment-win';label.textContent=winLabel;resultLabels.push(label);}
          if(lost){const label=document.createElement('span');label.className='segment-loss';label.textContent=lossLabel;resultLabels.push(label);}
          stamp.replaceChildren(...resultLabels);
        }
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
      return `<div class="tier" data-duration="${minutes}"><div class="tier-label"><span>${minutes}m</span><img class="tier-coin-icon" width="24" height="24" alt=""></div><div class="tier-cards" style="--columns:${items.length}">${items.map(m=>{
        const settled=m.status==='settled',queued=m.status==='queued',result=settled&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?outcome(m.strike,m.close):null;
        const actionIcon=settled?'<path d="M4 19h16M7 15v-4m5 4V5m5 10V8"/>':queued?'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>':'<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>';
        const action=`<button type="button" class="segment-action" data-segment-action="${m.id}" aria-haspopup="dialog" aria-controls="prediction-dialog" aria-label="${settled?'View result for':queued?'View details for':'Predict on'} ${minutes} minute segment ${m.start} to ${m.end} UTC"><svg class="segment-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${actionIcon}</svg><span class="segment-action-label">${settled?'Result':queued?'Details':'Predict'}</span></button>`;
        const compact=queued||(settled&&result===null);
        const status=queued?'UPCOMING':settled?(compact?'PENDING':'COMPLETED'):'● OPEN';
        const prices=compact?'':`<div class="segment-price-row"><span class="segment-price-values"><span class="segment-benchmark-price" title="Benchmark price">${Number.isFinite(m.strike)?price(m.strike):'—'}</span><span class="settlement-separator" aria-label="to">→</span><strong class="segment-current-price" title="${settled?'Closing price':'Current price'}">${settled&&Number.isFinite(m.close)?price(m.close):'—'}</strong><span data-reference-price="${m.id}" hidden></span></span></div>`;
        const probabilities=compact?'':`<div class="segment-odds" aria-label="${settled?'Final direction result':'Estimated direction probabilities'}"><span class="segment-odds-up">Up —</span><span class="segment-odds-divider" aria-hidden="true">|</span><span class="segment-odds-down">Down —</span></div>`;
        const remaining=compact||settled?'':`<span class="segment-countdown" data-remaining="${m.id}" aria-label="Time remaining">${m.remaining}</span>`;
        return `<div role="group" class="market-card ${m.status} ${result?'result-'+result:''} ${settled&&compact?'pending':''} ${m.id===market.id?'selected':''}" data-market="${m.id}" aria-label="${minutes} minute market ${m.start} to ${m.end} UTC, ${m.status}">
          <div class="card-top"><span class="card-time">${m.start} – ${m.end}</span>${probabilities}<span class="segment-meta"><span class="badge ${queued||compact?'neutral':settled?(result==='up'?'green':'red'):'green'}">${status}</span></span></div>
          ${prices}
          <div class="segment-controls">${action}${remaining}</div>
          ${settled&&!compact?'<div class="chance-block"><div class="chance-row"><span class="settled-stamp">No wager</span></div></div>':''}
          ${compact?'':'<span class="segment-direction" data-direction-indicator hidden role="img"><span class="segment-direction-change" aria-hidden="true" hidden></span><span class="segment-direction-arrow" aria-hidden="true"></span></span>'}
          <span class="segment-predictions" data-predictions="${m.id}" hidden></span>
        </div>`;
      }).join('')}</div></div>`;
    }).join('');
    $('market-grid').querySelectorAll('.tier-coin-icon').forEach(icon=>{
      icon.src=window.PredictModel.coin.icon||'assets/coins/btc.svg';
      icon.alt=window.PredictModel.coin.symbol;
    });
    marketElements.clear();
    $('market-grid').querySelectorAll('[data-market]').forEach(card=>{
      marketElements.set(card.dataset.market,{card,reference:card.querySelector('[data-reference-price]'),predictions:card.querySelector('[data-predictions]'),up:card.querySelector('.segment-odds-up'),down:card.querySelector('.segment-odds-down'),price:card.querySelector('.segment-current-price'),direction:card.querySelector('[data-direction-indicator]'),arrow:card.querySelector('.segment-direction-arrow'),change:card.querySelector('.segment-direction-change')});
    });
    renderSegmentPredictions();
    renderChances();
  }
  /** Estimate the selected interval probabilities from the current underlying observation. */ function liveChance(selected=market){const model=window.PredictModel;return model.estimateChances(selected,model.spot,model.now,model.volatility);}
  /** Compute a budget-constrained order quote using live direction probabilities. */ function quoteFor(selected,direction,budget,chance=liveChance(selected)){return chance?quote({...selected,up:chance.up},direction,budget,budgetAvailable()):null;}
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
    $('prediction-popup-title').textContent=open?'Predict':queued?'Segment details':'Result';
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
    sideButtons.forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.side===side));button.disabled=!open;});
    $('stake').disabled=!open;$('stake').max=budgetAvailable().toFixed(2);
    stakeButtons.forEach(button=>{button.disabled=!open;const amount=button.dataset.stake==='max'?budgetAvailable():Number(button.dataset.stake);button.classList.toggle('selected',Number($('stake').value)===amount);button.setAttribute('aria-pressed',String(Number($('stake').value)===amount));});
    const q=currentQuote();
    $('submit-prediction').classList.toggle('bear',side==='down');
    $('submit-prediction').classList.toggle('pick-direction',side===null);
    $('ticket-note').textContent=!open?(queued?'Select an open market to make a prediction.':Number.isFinite(market.strike)&&Number.isFinite(market.close)?`Settlement: ${outcome(market.strike,market.close)==='up'?'Up':'Down'} at ${price(market.close)}.`:'Waiting for market history.'):!q?(side===null?'Choose Up or Down to review your prediction.':'Enter 1–1,000 credits within your available balance.'):'Bets close 30s before interval end · No real money';
    $('settlement-description').textContent=!Number.isFinite(market.strike)&&!queued?'Waiting for a benchmark from minute history.':queued?'The starting benchmark is set when this interval opens.':`Up wins if the closing minute-candle close is at least ${price(market.strike)}. An unchanged price resolves Up.${window.PredictModel.coin.feed==='twelvedata'?' Twelve Data oil minute close · USD/barrel.':window.PredictModel.coin.feed==='simulated'?' Simulated oil benchmark · USD/barrel.':''}`;
    $('balance').textContent=money(balance());
    renderExecutionState();
  }
  let pendingSignature='';
  /** Render pending times from the latest account, market, and interface state. */ function renderPendingTimes(){
    if(document.hidden)return;
    pendingPositions.forEach(p=>{
      const label=document.getElementById(`pending-time-${p.id}`);if(!label)return;
      const seconds=Math.max(0,Math.ceil(p.ends_at-Date.now()/1000));
      const status=seconds?`${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s left`:'Awaiting settlement';
      label.textContent=`${p.start}–${p.end} UTC · ${new Date(p.starts_at*1000).toISOString().slice(0,10)} · ${status}`;
    });
  }
  /** Render positions from the latest account, market, and interface state. */ function renderPositions() {
    const pending=pendingPositions;
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
    marketElements.forEach(({card},id)=>{const selected=id===market.id;card.classList.toggle('selected',selected);});
    renderTicket();
    if(event.target.closest('[data-segment-action]')&&!$('prediction-dialog').open)$('prediction-dialog').showModal();
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
  ['rules-open','rules-inline'].forEach(id=>$(id).addEventListener('click',()=>$('rules-dialog').showModal()));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('prediction-form').addEventListener('submit',event=>{
    event.preventDefault();if(side===null){highlightDirections();notify('Choose Up or Down to review your prediction.');return;}if(!account.user){location.href='login.html';return;}if(!health().ready){notify(health().reason);return;}const q=currentQuote();if(!q)return;
    review={mode:'contest',requestId:crypto.randomUUID(),startsAt:market.startsAt,endsAt:market.endsAt,coin:window.PredictModel.coin.symbol,marketId:market.id,start:market.start,end:market.end,minutes:market.minutes,strike:market.strike,hour:window.PredictModel.hour,side,budget:Number($('stake').value),...q};
    const down=review.side==='down',arrow=down?'↓':'↑',direction=down?'Down':'Up';
    $('review-direction').classList.toggle('down',down);
    $('review-arrow').textContent=arrow;
    $('review-side').textContent=`Predict ${direction}`;
    $('confirm-prediction').classList.toggle('bear',down);
    $('confirm-prediction').textContent=down?'Predict DOWN Now':'Predict UP Now';
    $('review-title').textContent=`Contest · ${side==='up'?'Up':'Down'} · ${window.PredictModel.coin.name} ${market.minutes} min`;
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
    try{await account.place({...review});review=null;side=null;$('stake').value='';$('review-dialog').close();$('prediction-dialog').close();renderTicket();notify('Prediction saved to your contest history.');}
    catch(error){$('review-error').textContent=error.message;notify(error.message);}
    finally{submitting=false;button.textContent=buttonLabel;renderExecutionState();renderReviewChance();}
  });
  /** Show a winner badge only for the caller's finalized first-place result. */ function renderLastHourScore(){
    const previous=account.lastHourContest;
    $('last-hour-winner').hidden=!(account.user&&previous?.state==='final'&&previous.rank===1);
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
  }
  /** Render account from the latest account, market, and interface state. */ function renderAccount(){
    const positions=account.user?account.predictions.filter(p=>p.mode==='contest').map(p=>({...p,marketId:p.market_id,minutes:Number(p.market_id.split('-')[0]),start:new Date(p.starts_at*1000).toISOString().slice(11,16),end:new Date(p.ends_at*1000).toISOString().slice(11,16),cost:p.cost_cents/100})):[];
    pendingPositions=positions.filter(p=>p.settled_at==null);
    predictionIndex.clear();
    positions.forEach(p=>{const key=predictionKey(p.coin,p.marketId,p.starts_at*1000);if(!predictionIndex.has(key))predictionIndex.set(key,[]);predictionIndex.get(key).push(p);});
    renderLastHourScore();
    $('positions-storage').textContent=account.user?'Live orders only':'Log in to save predictions';
    renderSegmentPredictions();renderPositions();renderTicket();
  }
  window.addEventListener('account-update',()=>{if(account.error)notify(account.error);});
  window.addEventListener('account-update',renderAccount);
  window.addEventListener('coin-change',()=>{$('prediction-dialog').close();initialMarketChosen=false;side=null;review=null;$('review-dialog').close();renderMarkets();renderTicket();});
  window.addEventListener('btc-market-update',()=>{if(!initialMarketChosen){const active=markets.find(m=>m.minutes===15&&m.status==='open'&&Number.isFinite(m.strike));if(active){market=active;initialMarketChosen=true;}}if(review&&review.hour!==window.PredictModel.hour&&!reviewExpired()){review=null;$('review-dialog').close();}renderMarkets();renderTicket();renderReviewChance();});
  window.addEventListener('btc-chances-update',renderChances);
  window.addEventListener('btc-price-update',renderChances);
  setInterval(()=>{renderPendingTimes();renderReviewTiming();},1000);
  renderMarkets();renderAccount();
})();
