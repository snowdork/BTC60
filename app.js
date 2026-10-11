(() => {
  'use strict';
  const {markets,quote,outcome,initialBalance}=window.RolrModel;
  const $=id=>document.getElementById(id);
  const price=value=>window.RolrCoins.formatPrice(value,window.RolrModel.coin.symbol);
  const money=value=>value.toLocaleString('en-US',{style:'currency',currency:'USD'});
  const storageKey='rolr_phase1_positions_v1';
  let positions=[];
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');
    if(Array.isArray(saved)) {
      let total=0;
      positions=saved.filter(p=>{
        const m=markets.find(m=>m.id===p.marketId),q=m&&quote({...m,status:'open',strike:p.strike??m.strike,up:Number.isFinite(p.cents)?(p.side==='up'?p.cents:100-p.cents):m.up},p.side,p.budget,initialBalance);
        if(!q || q.contracts!==p.contracts || q.cost!==p.cost || typeof p.id!=='string' || total+q.cost>initialBalance) return false;
        total+=q.cost;return true;
      }).slice(0,200);
    }
  } catch { /* Browser storage may be unavailable; use session state. */ }
  let market=markets.find(m=>m.id==='15-2'),side='up',review=null,initialMarketChosen=false;
  const balance=()=>Math.round((initialBalance-positions.reduce((sum,p)=>sum+p.cost,0))*100)/100;
  function notify(message) {
    $('notification').textContent=message;$('notification').classList.add('visible');
    clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('notification').classList.remove('visible'),4500);
  }
  function renderChances() {
    const model=window.RolrModel;
    markets.forEach(m=>{
      const element=document.querySelector(`[data-chances="${m.id}"]`);if(!element)return;
      const stale=m.status==='open'&&model.feedMode==='live'&&(!model.priceUpdatedAt||Date.now()-model.priceUpdatedAt>15000);
      const chance=model.estimateChances(m,stale?NaN:model.spot,model.now,model.volatility);
      element.querySelector('.chance-up').textContent=`Up ${chance?chance.up+'%':'—'}`;
      element.querySelector('.chance-down').textContent=`Down ${chance?chance.down+'%':'—'}`;
      element.title=chance?.label==='ESTIMATE'?'Heuristic estimate centered on the price to beat, scaled by recent minute volatility and time remaining. Not calibrated odds; contract quotes are separate.':chance?.label==='BASELINE'?'Neutral 50/50 baseline before the interval opens; no benchmark is set yet.':chance?.label==='RESULT'?'Completed demo result, not a forecast.':'Waiting for a fresh price and valid benchmark.';
    });
  }
  function renderMarkets() {
    $('market-grid').innerHTML=[60,30,15].map(minutes=>{
      const items=markets.filter(m=>m.minutes===minutes);
      return `<div class="tier"><div class="tier-label">${minutes}<small>MINUTES</small></div><div class="tier-cards" style="--columns:${items.length}">${items.map(m=>{
        const settled=m.status==='settled',queued=m.status==='queued',result=settled&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?outcome(m.strike,m.close):null;
        return `<button type="button" class="market-card ${m.status} ${m.id===market.id?'selected':''}" data-market="${m.id}" aria-pressed="${m.id===market.id}" aria-label="${minutes} minute market ${m.start} to ${m.end} UTC, ${m.status}"><div class="card-top"><span class="card-time">${m.start} – ${m.end}</span><span class="badge ${queued?'neutral':settled?(result===null?'neutral':result==='up'?'green':'red'):'green'}">${queued?'UPCOMING':settled?(result===null?'CLOSED':result==='up'?'↗ UP WON':'↘ DOWN WON'):'● OPEN'}</span></div><div class="card-benchmark">${Number.isFinite(m.strike)?price(m.strike):'—'}<small>${queued?'Benchmark set at open':'Demo price to beat'}</small></div><div class="card-bottom">${queued?`<span class="queued-label">Opens at ${m.start}</span>`:settled?`<span>${Number.isFinite(m.close)?'Final '+price(m.close):'Awaiting history'}</span>`:`<span data-remaining="${m.id}">${m.remaining}</span>`}</div><div class="chance-row" data-chances="${m.id}"><span class="chance-up">Up —</span><span class="chance-down">Down —</span></div></button>`;
      }).join('')}</div></div>`;
    }).join('');
    renderChances();
    document.querySelectorAll('[data-market]').forEach(button=>button.addEventListener('click',()=>{market=markets.find(m=>m.id===button.dataset.market);review=null;renderMarkets();renderTicket();}));
  }
  function currentQuote() {return quote(market,side,Number($('stake').value),balance());}
  function renderTicket() {
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
    $('submit-prediction').disabled=!q || positions.length>=200;
    $('submit-prediction').classList.toggle('bear',side==='down');
    $('submit-prediction').textContent=open?`Review ${side==='up'?'Up':'Down'} prediction →`:queued?`Opens at ${market.start} UTC`:window.RolrModel.isHistorical?'Historical market · Closed':'Market settled';
    $('ticket-note').textContent=!open?(queued?'Select an open market to make a prediction.':Number.isFinite(market.strike)&&Number.isFinite(market.close)?`Demo settlement: ${outcome(market.strike,market.close)==='up'?'Up':'Down'} at ${price(market.close)}.`:'Waiting for market history.'):positions.length>=200?'Demo limit of 200 predictions reached.':!q?'Enter a budget of at least $1 within your demo balance.':'Simulated prices · No fees · No real money';
    $('settlement-description').textContent=!Number.isFinite(market.strike)&&!queued?'Waiting for a demo benchmark from minute history.':queued?'The starting benchmark is set when this interval opens.':`Up wins if the closing 60-second average is at least ${price(market.strike)}. Otherwise Down wins.`;
    $('balance').textContent=money(balance());
  }
  function renderPositions() {
    $('position-count').textContent=positions.length;
    if(!positions.length)return;
    $('positions-list').replaceChildren(...positions.slice().reverse().map(p=>{
      const m={...markets.find(m=>m.id===p.marketId),...(p.start?{start:p.start,end:p.end,minutes:p.minutes}:{})},row=document.createElement('div');row.className='position-row';
      const detail=document.createElement('div'),title=document.createElement('strong'),time=document.createElement('small');
      title.textContent=`${p.side==='up'?'↗ Up':'↘ Down'} · ${window.RolrCoins.getCoin(p.coin||'BTC').symbol} · ${m.minutes} min`;title.style.color=p.side==='up'?'var(--green)':'var(--red)';time.textContent=`${m.start} – ${m.end} UTC · Demo pending`;detail.append(title,time);
      const values=document.createElement('div'),cost=document.createElement('strong'),contracts=document.createElement('small');cost.textContent=money(p.cost);contracts.textContent=`${p.contracts} contracts · ${money(p.contracts)} if correct`;values.append(cost,contracts);row.append(detail,values);return row;
    }));
  }
  document.querySelectorAll('[data-side]').forEach(button=>button.addEventListener('click',()=>{side=button.dataset.side;renderTicket();}));
  document.querySelectorAll('[data-stake]').forEach(button=>button.addEventListener('click',()=>{$('stake').value=button.dataset.stake==='max'?balance().toFixed(2):button.dataset.stake;renderTicket();}));
  $('stake').addEventListener('input',renderTicket);
  ['rules-open','rules-inline'].forEach(id=>$(id).addEventListener('click',()=>$('rules-dialog').showModal()));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('prediction-form').addEventListener('submit',event=>{
    event.preventDefault();const q=currentQuote();if(!q || positions.length>=200)return;
    review={coin:window.RolrModel.coin.symbol,marketId:market.id,start:market.start,end:market.end,minutes:market.minutes,strike:market.strike,hour:window.RolrModel.hour,side,budget:Number($('stake').value),...q};
    $('review-title').textContent=`${side==='up'?'Up':'Down'} · ${window.RolrModel.coin.name} ${market.minutes} min`;
    $('review-detail').textContent=`${market.start} – ${market.end} UTC · Benchmark ${price(market.strike)}`;
    $('review-summary').innerHTML=`<div><span>${q.contracts} contracts at ${q.cents}¢</span><strong>${money(q.cost)}</strong></div><div><span>Return if correct</span><strong>${money(q.payout)}</strong></div><div class="profit-row"><span>Potential profit</span><strong>+${money(q.profit)}</strong></div>`;
    $('review-dialog').showModal();
  });
  $('confirm-prediction').addEventListener('click',()=>{
    if(!review)return;
    const m=markets.find(m=>m.id===review.marketId),q=quote(m,review.side,review.budget,balance());
    if(!q || review.coin!==window.RolrModel.coin.symbol || review.hour!==window.RolrModel.hour || positions.length>=200){$('review-dialog').close();review=null;renderTicket();notify('Balance changed. Review your prediction again.');return;}
    positions.push({...review,id:crypto.randomUUID()});review=null;
    let persisted=true;try{localStorage.setItem(storageKey,JSON.stringify(positions));}catch{persisted=false;}
    $('review-dialog').close();renderPositions();renderTicket();
    notify(persisted?'Demo prediction placed. No real money used.':'Demo prediction placed for this session. Browser storage unavailable.');
  });
  window.addEventListener('storage',event=>{if(event.key===storageKey)location.reload();});
  window.addEventListener('coin-change',()=>{initialMarketChosen=false;review=null;$('review-dialog').close();renderMarkets();renderTicket();});
  window.addEventListener('btc-market-update',()=>{if(!initialMarketChosen){const active=markets.find(m=>m.minutes===15&&m.status==='open'&&Number.isFinite(m.strike));if(active){market=active;initialMarketChosen=true;}}review=null;$('review-dialog').close();renderMarkets();renderTicket();});
  window.addEventListener('btc-chances-update',renderChances);
  window.addEventListener('btc-price-update',()=>{renderChances();const delta=(window.RolrModel.isHistorical?market.close:window.RolrModel.spot)-market.strike; $('ticket-delta').textContent=Number.isFinite(market.strike)&&Number.isFinite(window.RolrModel.isHistorical?market.close:window.RolrModel.spot)?(delta>=0?'+':'−')+price(Math.abs(delta)):'—';$('ticket-delta').style.color=delta>=0?'var(--green)':'var(--red)';});
  renderMarkets();renderPositions();renderTicket();
})();
