(() => {
  'use strict';
  const {markets,quote,outcome,initialBalance}=window.PredictModel;
  const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,document.getElementById(id));return elements.get(id);};
  const sideButtons=[...document.querySelectorAll('[data-side]')];
  const stakeButtons=[...document.querySelectorAll('[data-stake]')];
  const marketElements=new Map();
  const price=value=>window.PredictCoins.formatPrice(value,window.PredictModel.coin.symbol);
  const currency=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  const money=value=>currency.format(value);
  const shareFormatter=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
  const shares=value=>shareFormatter.format(value);
  const account=window.BTC60Account;
  let positions=[];
  const predictionIndex=new Map();
  const predictionKey=(coin,id,start)=>`${coin}:${id}:${start}`;
  function segmentPredictions(selected){
    const model=window.PredictModel;
    return account.user&&model.feedMode!=='demo'?predictionIndex.get(predictionKey(model.coin.symbol,selected.id,selected.startsAt))||[]:[];
  }
  const setText=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
  let market=markets.find(m=>m.id==='15-2'),side=null,review=null,initialMarketChosen=false,submitting=false;
  const balance=()=>account.user?account.user.balance_cents/100:initialBalance;
  function notify(message) {
    $('notification').textContent=message;$('notification').classList.add('visible');
    clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('notification').classList.remove('visible'),4500);
  }
  function renderStatusLine(){
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
  function health(){return window.PredictModel.dataStatus(window.PredictModel,market);}
  function renderPredictionContext(){
    const model=window.PredictModel,closed=market.status==='settled',queued=market.status==='queued';
    const benchmark=Number.isFinite(market.strike)?market.strike:null;
    const age=Date.now()-model.priceUpdatedAt;
    const fresh=model.feedMode==='demo'||(model.feedConnection==='connected'&&model.priceUpdatedAt>0&&age>=-5000&&age<=(model.coin.maxPriceAgeMs||15000));
    const value=closed?market.close:!queued&&fresh?model.spot:null;
    const available=Number.isFinite(value)&&benchmark!==null;
    $('ticket-spot-label').textContent=model.coin.feed==='oilpriceapi'?'SPOT ASSESSMENT · USD / BARREL':closed?'CLOSING BENCHMARK':model.feedMode==='demo'?'SYNTHETIC SPOT':model.coin.feed==='simulated'?'SIMULATED · USD / BARREL':model.coin.feed==='twelvedata'?'LIVE SPOT · USD / BARREL':'LIVE SPOT';
    $('ticket-spot').textContent=Number.isFinite(value)?price(value):'—';
    $('ticket-price-time').textContent=closed?'Minute candle immediately before interval close':queued?'Starting benchmark is set when this interval opens':model.feedMode==='demo'?'Synthetic preview · no account orders':fresh?`Source update ${new Date(model.priceUpdatedAt).toISOString().slice(11,19)} UTC`: 'Waiting for a connected, fresh price';
    const start=market.startsAt,end=market.endsAt;
    if(Number.isFinite(start)&&Number.isFinite(end)){
      const hour=Math.floor(start/3600000)*3600000;
      const utc=t=>new Date(t).toISOString().slice(11,16);
      $('ticket-hour-selection').style.left=`${(start-hour)/3600000*100}%`;
      $('ticket-hour-selection').style.width=`${market.minutes/60*100}%`;
      $('ticket-hour-start').textContent=utc(hour);$('ticket-hour-end').textContent=utc(hour+3600000);
      $('ticket-hour-map').setAttribute('aria-label',`Selected ${market.minutes}-minute interval ${utc(start)} to ${utc(end)} UTC within the hour`);
      $('ticket-interval-timing').textContent=closed?'Interval complete':queued?`Opens ${utc(start)} UTC`:`${market.remaining} left`;
    }
    const delta=available?value-benchmark:null;
    $('ticket-comparison').textContent=queued?'Benchmark available at open':!available?'Comparison unavailable':`${delta===0?'At the benchmark':`${price(Math.abs(delta))} ${delta>0?'above':'below'} benchmark`} (${delta>=0?'+':''}${(delta/benchmark*100).toFixed(3)}%)`;
    $('ticket-comparison').style.color=delta===null?'var(--muted)':delta>=0?'var(--green)':'var(--red)';
    $('ticket-up-rule').textContent=benchmark===null?'↗ Up: close ≥ benchmark':`↗ Up: close ≥ ${price(benchmark)}`;
    $('ticket-down-rule').textContent=benchmark===null?'↘ Down: close < benchmark':`↘ Down: close < ${price(benchmark)}`;
    const context=document.querySelector('.prediction-context');
    context.dataset.side=side||'';
  }
  function renderExecutionState(){
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
  function reviewExpired(){return !!review&&Date.now()>=review.endsAt-30000;}
  function renderReviewTiming(){
    if(!review)return;
    const seconds=Math.max(0,Math.ceil((review.endsAt-30000-Date.now())/1000));
    $('review-time').textContent=seconds?`${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s to betting cutoff`:'Betting closed · final 30 seconds';
    $('review-time').classList.toggle('expired',!seconds);
    if(!seconds){$('confirm-prediction').disabled=true;if(!submitting)$('confirm-prediction').textContent='Too late to place';}
  }
  let reviewSummarySignature='';
  function renderReviewSummary(q){
    const signature=`${q.cents}:${q.contracts}`;
    if(signature===reviewSummarySignature)return;
    reviewSummarySignature=signature;
    $('review-summary').innerHTML=`<div><span>${shares(q.contracts)} shares at ${q.cents}¢</span><strong>${money(q.cost)}</strong></div><div><span>Return if correct</span><strong>${money(q.payout)}</strong></div><div class="profit-row"><span>Potential profit</span><strong>+${money(q.profit)}</strong></div>`;
  }
  function renderReviewChance(){
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
    $('review-chance').title='Heuristic model estimate and demo contract price. Updates with the selected price feed.';
    if(chance&&!submitting){
      const q=quoteFor(m,review.side,review.budget,chance);
      if(q){Object.assign(review,q);renderReviewSummary(q);}
    }

  }
  function renderChances() {
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
      element.title=chance?.label==='ESTIMATE'?'Model probability based on adaptive 24-hour volatility and time to settlement. Historical calibration applies when validated for this coin; demo contract prices follow these percentages.':chance?.label==='BASELINE'?'Neutral baseline for an upcoming interval.':chance?.label==='RESULT'?'Completed demo result, not a forecast.':'Waiting for a fresh price and valid benchmark.';
    });
  }
  function renderSegmentPredictions(){
    markets.forEach(m=>{
      const container=marketElements.get(m.id)?.predictions;if(!container)return;
      const saved=segmentPredictions(m);
      const stamp=marketElements.get(m.id)?.card.querySelector('.settled-stamp');
      if(stamp){
        const results=['up','down'].flatMap(direction=>['won','lost'].flatMap(status=>{
          const orders=saved.filter(p=>p.side===direction&&p.settled_at!=null&&(p.outcome===p.side?'won':'lost')===status);
          if(!orders.length)return [];
          const mark=document.createElement('span');
          mark.className=`wager-settlement ${status}`;
          const cost=orders.reduce((total,p)=>total+p.cost_cents,0);
          const payout=orders.reduce((total,p)=>total+(p.payout_cents||0),0);
          const amount=(status==='won'?payout-cost:cost)/100;
          mark.textContent=`${direction==='up'?'↑':'↓'} ${status==='won'?'Win':'Lose'} ${money(amount)}`;
          mark.title=`Your ${direction==='up'?'Up':'Down'} wager${orders.length===1?'':'s'} · ${status==='won'?'Net profit':'Amount lost'} ${money(amount)}`;
          return [mark];
        }));
        stamp.replaceChildren(...results);
        if(!results.length)stamp.textContent=saved.length?'SETTLED':'No Wager';
        stamp.classList.toggle('has-wager',results.length>0);
        if(results.length)stamp.removeAttribute('aria-hidden');
        else stamp.setAttribute('aria-hidden','true');
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
      container.hidden=!saved.length;
    });
  }
  function renderMarkets() {
    $('market-grid').innerHTML=[60,30,15].map(minutes=>{
      const items=markets.filter(m=>m.minutes===minutes);
      return `<div class="tier" data-duration="${minutes}"><div class="tier-label">${minutes}<small>MINUTES</small></div><div class="tier-cards" style="--columns:${items.length}">${items.map(m=>{
        const settled=m.status==='settled',queued=m.status==='queued',result=settled&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?outcome(m.strike,m.close):null;
        return `<button type="button" class="market-card ${m.status} ${result?'result-'+result:''} ${m.id===market.id?'selected':''}" data-market="${m.id}" aria-pressed="${m.id===market.id}" aria-label="${minutes} minute market ${m.start} to ${m.end} UTC, ${m.status}">${settled?'<span class="settled-stamp" aria-hidden="true">No Wager</span>':''}${settled&&result!==null?`<span class="segment-result ${result}" role="img" aria-label="${result==='up'?'Up':'Down'} won" title="${result==='up'?'Up':'Down'} won">${result==='up'?'↑':'↓'}</span>`:''}<div class="card-top"><span class="card-time">${m.start} – ${m.end}</span><span class="badge ${queued?'neutral':settled?(result===null?'neutral':result==='up'?'green':'red'):'green'}">${queued?'UPCOMING':settled?(result===null?'CLOSED':result==='up'?'↗ UP WON':'↘ DOWN WON'):'● OPEN'}</span></div><div class="card-benchmark"><div class="segment-price"><span ${window.PredictModel.coin.feed==='oilpriceapi'&&window.PredictModel.feedMode==='live'&&!window.PredictModel.isHistorical?'hidden':''}>${Number.isFinite(m.strike)?price(m.strike):'—'}</span><span data-reference-price="${m.id}" hidden></span>${m.status==='open'?`<span class="segment-countdown" data-remaining="${m.id}">${m.remaining}</span>`:''}</div>${queued?'<small>Benchmark set at open</small>':''}</div><div class="card-context"><div class="card-distance" data-distance="${m.id}" ${m.status!=='open'?'hidden':''}>Spot distance unavailable</div><div class="card-bottom">${queued?`<span class="queued-label">Opens at ${m.start}</span>`:settled?`<span>${Number.isFinite(m.close)?'Final '+price(m.close):'Awaiting history'}</span>`:''}</div></div><div class="chance-block" data-chances="${m.id}"><div class="chance-row"><span class="chance-up">↗ Up —</span><span class="chance-down">↘ Down —</span></div></div><span class="segment-predictions" data-predictions="${m.id}" hidden></span></button>`;
      }).join('')}</div></div>`;
    }).join('');
    marketElements.clear();
    $('market-grid').querySelectorAll('[data-market]').forEach(card=>{
      marketElements.set(card.dataset.market,{card,chances:card.querySelector('[data-chances]'),distance:card.querySelector('[data-distance]'),reference:card.querySelector('[data-reference-price]'),predictions:card.querySelector('[data-predictions]'),up:card.querySelector('.chance-up'),down:card.querySelector('.chance-down')});
    });
    renderSegmentPredictions();
    renderChances();
  }
  function liveChance(selected=market){const model=window.PredictModel;return model.estimateChances(selected,model.spot,model.now,model.volatility);}
  function quoteFor(selected,direction,budget,chance=liveChance(selected)){return chance?quote({...selected,up:chance.up},direction,budget,balance()):null;}
  function currentQuote() {return quoteFor(market,side,Number($('stake').value));}
  function renderLivePricing(chance){
    const open=market.status==='open',q=open?quoteFor(market,side,Number($('stake').value),chance):null;
    $('up-price').textContent=open&&chance?`${chance.up}¢`:'—';
    $('down-price').textContent=open&&chance?`${chance.down}¢`:'—';
    $('contract-price').textContent=q?`at ${q.cents}¢ each`:'';
    $('contracts').textContent=q?shares(q.contracts):'—';$('cost').textContent=q?money(q.cost):'—';$('return').textContent=q?money(q.payout):'—';$('profit').textContent=q?'+'+money(q.profit):'—';
    if(open)$('ticket-note').textContent=q?'Bets close 30s before interval end · No real money':(side===null?'Choose Up or Down to review your prediction.':'Enter a budget of at least $1 within your demo balance.');
    return q;
  }
  function renderIntervalDetails(){
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
  function renderTicket() {
    renderStatusLine();
    const open=market.status==='open',queued=market.status==='queued';
    $('ticket-heading').textContent=open?'Make a prediction':queued?'Upcoming interval':'Settlement details';
    $('ticket-mode').textContent=open?'DEMO ORDER':queued?'UPCOMING':'CLOSED';
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
    $('stake').disabled=!open;$('stake').max=balance().toFixed(2);
    stakeButtons.forEach(button=>{button.disabled=!open;const amount=button.dataset.stake==='max'?balance():Number(button.dataset.stake);button.classList.toggle('selected',Number($('stake').value)===amount);button.setAttribute('aria-pressed',String(Number($('stake').value)===amount));});
    const q=currentQuote();
    $('submit-prediction').classList.toggle('bear',side==='down');
    $('submit-prediction').classList.toggle('pick-direction',side===null);
    $('ticket-note').textContent=!open?(queued?'Select an open market to make a prediction.':Number.isFinite(market.strike)&&Number.isFinite(market.close)?`Demo settlement: ${outcome(market.strike,market.close)==='up'?'Up':'Down'} at ${price(market.close)}.`:'Waiting for market history.'):!q?(side===null?'Choose Up or Down to review your prediction.':'Enter a budget of at least $1 within your demo balance.'):'Bets close 30s before interval end · No real money';
    $('settlement-description').textContent=!Number.isFinite(market.strike)&&!queued?'Waiting for a demo benchmark from minute history.':queued?'The starting benchmark is set when this interval opens.':`Up wins if the closing minute-candle close is at least ${price(market.strike)}. An unchanged price resolves Up. ${window.PredictModel.coin.feed==='twelvedata'?'Twelve Data oil minute close · USD/barrel':window.PredictModel.coin.feed==='simulated'?'Simulated oil benchmark · USD/barrel':'Coinbase proxy · not a 60-second average'}. `;
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
  function highlightDirections(){
    clearTimeout(directionHintTimer);
    sideButtons.forEach(button=>button.classList.remove('direction-hint'));
    void sideButtons[0].offsetWidth;
    sideButtons.forEach(button=>button.classList.add('direction-hint'));
    sideButtons[0].scrollIntoView({block:'center',behavior:'auto'});
    sideButtons[0].focus({preventScroll:true});
    directionHintTimer=setTimeout(()=>sideButtons.forEach(button=>button.classList.remove('direction-hint')),1100);
  }
  sideButtons.forEach(button=>button.addEventListener('click',()=>{side=button.dataset.side;sideButtons.forEach(item=>item.classList.remove('direction-hint'));renderTicket();}));
  stakeButtons.forEach(button=>button.addEventListener('click',()=>{$('stake').value=button.dataset.stake==='max'?balance().toFixed(2):button.dataset.stake;renderTicket();}));
  $('stake').addEventListener('input',renderTicket);
  ['rules-open','rules-inline'].forEach(id=>$(id).addEventListener('click',()=>$('rules-dialog').showModal()));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('prediction-form').addEventListener('submit',event=>{
    event.preventDefault();if(side===null){highlightDirections();notify('Choose Up or Down to review your prediction.');return;}if(!account.user){location.href='login.html';return;}if(!health().ready){notify(health().reason);return;}const q=currentQuote();if(!q)return;
    review={requestId:crypto.randomUUID(),startsAt:market.startsAt,endsAt:market.endsAt,coin:window.PredictModel.coin.symbol,marketId:market.id,start:market.start,end:market.end,minutes:market.minutes,strike:market.strike,hour:window.PredictModel.hour,side,budget:Number($('stake').value),...q};
    const down=review.side==='down',arrow=down?'↓':'↑',direction=down?'Down':'Up';
    $('review-direction').classList.toggle('down',down);
    $('review-arrow').textContent=arrow;
    $('review-side').textContent=`Predict ${direction}`;
    $('confirm-prediction').classList.toggle('bear',down);
    $('confirm-prediction').textContent=down?'Predict DOWN Now':'Predict UP Now';
    $('review-title').textContent=`${side==='up'?'Up':'Down'} · ${window.PredictModel.coin.name} ${market.minutes} min`;
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
    try{await account.place({...review});review=null;side=null;$('review-dialog').close();renderTicket();notify('Demo prediction saved to your account.');}
    catch(error){$('review-error').textContent=error.message;notify(error.message);}
    finally{submitting=false;button.textContent=buttonLabel;renderExecutionState();renderReviewChance();}
  });
  function renderAccount(){
    positions=account.predictions.map(p=>({...p,marketId:p.market_id,minutes:Number(p.market_id.split('-')[0]),start:new Date(p.starts_at*1000).toISOString().slice(11,16),end:new Date(p.ends_at*1000).toISOString().slice(11,16),cost:p.cost_cents/100}));
    predictionIndex.clear();
    positions.forEach(p=>{const key=predictionKey(p.coin,p.marketId,p.starts_at*1000);if(!predictionIndex.has(key))predictionIndex.set(key,[]);predictionIndex.get(key).push(p);});
    $('account-name').textContent=account.user?.name||'';
    $('account-name').hidden=!account.user;$('logout-button').hidden=!account.user;
    $('login-link').hidden=!!account.user;$('signup-link').hidden=!!account.user;
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
