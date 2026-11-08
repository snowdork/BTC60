/** @module market-detail
 * Render last/current/next intervals using the terminal's exact minute history.
 */
(() => {
  'use strict';
  const model=window.PredictModel,/** Find a stable detail workspace element. */ $=id=>document.getElementById(id);
  const /** Format an available instrument price or a missing-data placeholder. */ price=value=>Number.isFinite(value)?window.PredictCoins.formatPrice(value,model.coin.symbol):'—';
  let minutes=5,visible=false,lastSignature='',intervals=[];
  /** Switch between the hourly overview and the three adjacent interval cards. */
  function showDetail(next){
    visible=next;$('market-detail').hidden=!next;$('hour-overview').hidden=next;
    $('show-detail').setAttribute('aria-pressed',String(next));$('show-overview').setAttribute('aria-pressed',String(!next));
    $('market-view-hint').textContent=next?'Three intervals · one-minute price detail':'1m: 60 intervals · 5m: 12 intervals · swipe rows or open Detail';
    if(next)render(true);
    else window.dispatchEvent(new Event('market-overview'));
  }
  /** Update prices and plots without replacing controls on every live tick. */
  function render(force=false){
    if(!visible||!Number.isFinite(model.displayHour)||!Number.isFinite(model.now))return;
    const now=model.now,anchor=model.isHistorical?model.displayHour+3599999:now;
    intervals=model.adjacentMarkets(minutes,anchor,now,model.candles||[]);
    const signature=`${model.coin.symbol}:${minutes}:${intervals[1].startsAt}:${model.feedMode}`;
    $('detail-title').textContent=`${minutes}-minute detail`;$('detail-coin').textContent=`${model.coin.name} / USD`;
    $('detail-context').textContent=`${new Date(anchor).toISOString().slice(0,10)} · ${model.isHistorical?'Selected hour · completed intervals':model.feedMode==='demo'?'Synthetic preview':'Following the current interval'} · UTC`;
    if(force||signature!==lastSignature){
      lastSignature=signature;
      $('detail-cards').innerHTML=intervals.map((m,index)=>`<article class="panel detail-card" data-detail-index="${index}" ${index===1?'aria-current="true"':''}>
        <div class="detail-card-heading"><h3>${['Last','Current','Next'][index]}</h3><span data-detail-status class="badge neutral"></span></div>
        <strong class="detail-range">${m.start} – ${m.end} UTC</strong><span class="detail-date">${new Date(m.startsAt).toISOString().slice(0,10)}</span>
        <p data-detail-countdown class="detail-countdown"></p>
        <div class="detail-prices"><div><span>Benchmark</span><strong data-detail-strike></strong></div><div><span data-detail-price-label></span><strong data-detail-price></strong></div></div>
        <div class="detail-plot"><svg viewBox="0 0 1000 130" preserveAspectRatio="none" role="img" aria-label="${minutes}-minute interval with one-minute price candles"><path data-detail-up class="ohlc-up"/><path data-detail-down class="ohlc-down"/><path data-detail-line class="minute-close-line"/><circle data-detail-tip r="3" fill="var(--cyan)"/></svg><span data-detail-empty class="detail-plot-empty"></span></div>
        <div class="detail-scale"><span>${m.start}</span><span>1m candles</span><span>${m.end}</span></div>
        <div class="detail-ohlc"><span data-detail-low></span><span data-detail-high></span></div>
        <p data-detail-result class="detail-result"></p><button type="button" class="segment-action" data-detail-predict="${index}">Open prediction</button>
      </article>`).join('');
    }
    const fresh=model.feedMode==='demo'||(model.spotStatus==='ready'&&model.feedConnection==='connected'&&Number.isFinite(model.priceUpdatedAt)&&Date.now()-model.priceUpdatedAt<=(model.coin.maxPriceAgeMs||15000)&&model.priceUpdatedAt<=Date.now()+5000&&!model.paused);
    $('detail-cards').querySelectorAll('[data-detail-index]').forEach((card,index)=>{
      const m=intervals[index],/** Find an indexed field within one interval card. */ get=selector=>card.querySelector(`[data-detail-${selector}]`),queued=m.status==='queued',closed=m.status==='settled';
      const live=!model.isHistorical&&!closed&&!queued&&fresh?{t:model.priceUpdatedAt,price:model.spot}:null;
      const plot=model.minutePlot(model.candles||[],m.startsAt,m.endsAt,now,live);
      const result=closed&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?model.outcome(m.strike,m.close):null;
      const seconds=Math.max(0,Math.ceil(((queued?m.startsAt:m.endsAt)-now)/1000));
      get('status').textContent=queued?'UPCOMING':closed?(result?'COMPLETED':'PENDING'):'OPEN';
      get('status').className=`badge ${queued?'neutral':closed?(result==='up'?'green':result==='down'?'red':'neutral'):'green'}`;
      get('countdown').textContent=closed?'Interval ended':`${queued?'Starts in':'Ends in'} ${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s${!queued&&seconds<=30?' · Betting closed':''}`;
      get('strike').textContent=queued?'Set at open':price(m.strike);
      get('price-label').textContent=closed?'Closing price':'Live price';get('price').textContent=closed?price(m.close):live?price(live.price):'—';
      get('up').setAttribute('d',plot.up);get('down').setAttribute('d',plot.down);get('line').setAttribute('d',plot.line);
      get('tip').setAttribute('visibility',live&&plot.tip?'visible':'hidden');
      if(plot.tip){get('tip').setAttribute('cx',plot.tip.x);get('tip').setAttribute('cy',plot.tip.y);}
      get('empty').hidden=!!plot.line||plot.count>0;get('empty').textContent=queued?'Chart begins when this interval opens':'Minute history unavailable';
      get('low').textContent=Number.isFinite(plot.low)?`Scale low ${price(plot.low)}`:'';get('high').textContent=Number.isFinite(plot.high)?`Scale high ${price(plot.high)}`:'';
      const ready=model.dataStatus(model,m,Date.now(),{allowLocked:true}).ready;
      const chance=!queued&&!closed&&(ready||model.feedMode==='demo')?model.estimateChances(m,model.spot,now,model.volatility):null;
      get('result').textContent=queued?'Benchmark is set when this interval opens.':result?`${result==='up'?'↑ Up':'↓ Down'} wins · ${price(m.strike)} → ${price(m.close)}`:closed?'Awaiting exact settlement candles':chance?`Up ${chance.up}% · Down ${chance.down}%`:'Waiting for fresh price and benchmark data';
      get('result').style.color=result==='up'?'var(--green)':result==='down'?'var(--red)':'var(--muted)';
      const action=card.querySelector('[data-detail-predict]');action.hidden=closed||queued;
      action.disabled=!model.markets.some(item=>item.id===m.id&&item.startsAt===m.startsAt)||!model.dataStatus(model,m,Date.now()).ready;
    });
  }
  window.addEventListener('market-detail-open',event=>{
    if(![1,5,15,30,60].includes(event.detail?.minutes))return;
    minutes=event.detail.minutes;
    document.querySelectorAll('[data-detail-duration]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.detailDuration)===minutes)));
    showDetail(true);
  });
  $('show-detail').addEventListener('click',()=>showDetail(true));$('show-overview').addEventListener('click',()=>showDetail(false));
  document.querySelectorAll('[data-detail-duration]').forEach(button=>button.addEventListener('click',()=>{
    minutes=Number(button.dataset.detailDuration);
    document.querySelectorAll('[data-detail-duration]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    render(true);
  }));
  $('detail-cards').addEventListener('click',event=>{
    const button=event.target.closest('[data-detail-predict]');if(!button)return;
    const m=intervals[Number(button.dataset.detailPredict)];
    if(m)window.dispatchEvent(new CustomEvent('detail-predict',{detail:{id:m.id,startsAt:m.startsAt}}));
  });
  ['btc-market-update','btc-price-update','btc-chances-update','coin-change'].forEach(name=>window.addEventListener(name,()=>render()));
})();
