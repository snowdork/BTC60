/** @module market-detail
 * Render and navigate a single play using exact minute history for its time range.
 */
(() => {
  'use strict';
  const model=window.PredictModel,/** Find a stable detail workspace element. */ $=id=>document.getElementById(id);
  const /** Format an available instrument price or a missing-data placeholder. */ price=value=>Number.isFinite(value)?window.PredictCoins.formatPrice(value,model.coin.symbol):'—';
  const creditFormatter=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  let minutes=15,visible=true,durationSelected=true,lastSignature='',intervals=[],selectedStart=null;
  const historyCache=new Map();
  let sourceCandles=null,extraCandles=null,mergedCandles=[];
  let cardFields=new WeakMap();
  /** Reuse the merged history until either source is replaced. */
  function playCandles(cached){
    const source=model.candles,extra=cached?.rows;
    if(source!==sourceCandles||extra!==extraCandles){
      sourceCandles=source;extraCandles=extra;
      mergedCandles=extra?.length?[...new Map([...(source||[]),...extra].map(c=>[c[0],c])).values()]:source||[];
    }
    return mergedCandles;
  }
  /** Resolve card fields once per markup build, keeping live ticks free of repeated selectors. */
  function field(card,name){
    if(!cardFields.has(card))cardFields.set(card,new Map());
    const fields=cardFields.get(card);
    if(!fields.has(name))fields.set(name,card.querySelector(`[data-detail-${name}]`));
    return fields.get(name);
  }
  let historyRequest=null;
  /** Show the saved bet amount and execution percentage for this exact coin and interval. */
  function renderPredictionTags(selected,container){
    const account=window.Predict60Account;
    const saved=account?.user&&model.feedMode!=='demo'?(account.predictions||[]).filter(p=>
      p.mode==='contest'&&p.coin===model.coin.symbol&&p.market_id===selected.id&&
      p.starts_at*1000===selected.startsAt&&p.ends_at*1000===selected.endsAt):[];
    const signature=JSON.stringify(saved.map(p=>[p.id,p.side,p.cost_cents,p.cents,p.settled_at,p.outcome]));
    container.hidden=!saved.length;
    if(container.dataset.signature===signature)return;
    container.dataset.signature=signature;
    container.replaceChildren(...saved.map(p=>{
      const tag=document.createElement('span');
      const direction=p.side==='up'?'↑ Up':'↓ Down';
      const amount=Number.isFinite(p.cost_cents)?creditFormatter.format(p.cost_cents/100):'—';
      const result=p.settled_at==null?'':p.outcome===p.side?' · Won':' · Lost';
      tag.className=`play-prediction-tag ${p.side==='up'?'up':'down'}`;
      tag.textContent=`${direction} · ${amount} credits @ ${p.cents}%${result}`;
      tag.title='Saved bet amount and execution percentage';
      return tag;
    }));
  }
  const /** Identify history by instrument and absolute interval, including across day boundaries. */ historyKey=m=>`${model.coin.symbol}:${model.coin.product}:${m.startsAt}:${m.endsAt}`;
  /** Cancel superseded requests without allowing late responses to redraw another play. */
  function cancelHistory(){
    if(!historyRequest)return;
    historyRequest.controller.abort();clearTimeout(historyRequest.timeout);historyRequest=null;
  }
  /** Fetch missing candles for the selected play while keeping live quotes and orders on the live feed. */
  function ensureHistory(m,rows){
    if(m.status==='queued'||model.feedMode==='demo'||typeof model.loadMinuteHistory!=='function')return;
    const key=historyKey(m),cached=historyCache.get(key),now=Date.now();
    if(historyRequest?.key===key||cached?.retryAt>now)return;
    const end=Math.min(m.endsAt,Math.floor(model.now/60000)*60000);
    const timestamps=new Set(rows.filter(c=>Array.isArray(c)&&c.slice(0,5).every(Number.isFinite)).map(c=>c[0]*1000));
    let missing=false;
    for(let t=m.startsAt-60000;t<end;t+=60000){if(!timestamps.has(t)){missing=true;break;}}
    if(!missing)return;
    // Initial history already has a request; browsing another interval needs its own range.
    if(selectedStart===null&&model.historyStatus==='loading')return;
    cancelHistory();
    const controller=new AbortController(),request={key,controller};
    historyRequest=request;
    request.timeout=setTimeout(()=>controller.abort(),20000);
    model.loadMinuteHistory(m.startsAt-60000,end,{signal:controller.signal}).then(data=>{
      if(historyRequest!==request||controller.signal.aborted)return;
      if(!Array.isArray(data))throw Error('Invalid minute history');
      historyCache.set(key,{rows:data,retryAt:Date.now()+30000});
      if(historyCache.size>24)historyCache.delete(historyCache.keys().next().value);
    }).catch(()=>{
      if(historyRequest===request)historyCache.set(key,{rows:cached?.rows||[],error:true,retryAt:Date.now()+15000});
    }).finally(()=>{
      clearTimeout(request.timeout);
      if(historyRequest!==request)return;
      historyRequest=null;render();
    });
  }
  /** Switch between the hourly overview and the selected play. */
  function showDetail(next){
    visible=next;$('market-detail').hidden=!next;$('hour-overview').hidden=next;
    $('show-detail').setAttribute('aria-pressed',String(next));$('show-overview').setAttribute('aria-pressed',String(!next));
    durationSelected=next;
    if(!next)selectedStart=null;
    renderDurationSelection();
    if(next)render(true);
    else window.dispatchEvent(new Event('market-overview'));
  }
  /** Highlight only an explicit interval choice while keeping Hour as the full-hour context. */
  function renderDurationSelection(){
    $('market-detail').dataset.duration=String(minutes);
    $('hour-overview').dataset.duration=String(durationSelected?minutes:60);
    document.querySelectorAll('[data-detail-duration]').forEach(button=>button.setAttribute('aria-pressed',String(durationSelected&&Number(button.dataset.detailDuration)===minutes)));
  }
  /** Select an interval without changing the active chart view. */
  function selectInterval(nextMinutes,startsAt=null){
    if(![5,15,30,60].includes(nextMinutes))return;
    minutes=nextMinutes;selectedStart=Number.isFinite(startsAt)?startsAt:null;durationSelected=true;
    renderDurationSelection();
    if(visible)render(true);
    else window.dispatchEvent(new CustomEvent('market-duration-change',{detail:{startsAt:selectedStart}}));
  }
  /** Update prices and plots without replacing controls on every live tick. */
  function render(force=false){
    if(!visible||!Number.isFinite(model.displayHour)||!Number.isFinite(model.now))return;
    const now=model.feedMode==='demo'?model.now:Math.max(model.now,Date.now());
    const anchor=selectedStart??(model.isHistorical?model.displayHour+3599999:now);
    const startsAt=Math.floor(anchor/(minutes*60000))*minutes*60000;
    const bounds={startsAt,endsAt:startsAt+minutes*60000};
    const key=historyKey(bounds),cached=historyCache.get(key);
    const candles=playCandles(cached);
    intervals=[model.adjacentMarkets(minutes,anchor,now,candles)[1]];
    const selected=intervals[0];
    if(historyRequest&&historyRequest.key!==key)cancelHistory();
    ensureHistory(selected,candles);
    const completed=selected.status==='settled'&&Number.isFinite(selected.strike)&&Number.isFinite(selected.close);
    const state=selected.status==='queued'?'upcoming':selected.status==='settled'?(completed?'completed':'pending'):'live';
    $('market-detail').dataset.state=state;
    const signature=`${model.coin.symbol}:${minutes}:${selected.startsAt}:${model.feedMode}:${state}:${completed?model.outcome(selected.strike,selected.close):''}`;
    $('detail-title').textContent=`${model.coin.name} price chart`;
    $('play-coin-icon').hidden=!model.coin.icon;
    if(model.coin.icon)$('play-coin-icon').src=model.coin.icon;
    $('play-coin-icon').alt=model.coin.name;
    $('play-coin-fallback').hidden=!!model.coin.icon;
    $('play-coin-fallback').textContent=model.coin.symbol;
    $('detail-context').textContent=`${new Date(anchor).toISOString().slice(0,10)} · ${model.feedMode==='demo'?'Synthetic preview':selectedStart!==null||model.isHistorical?'Browsing selected interval':'Following the current interval'} · UTC`;
    $('play-timeframe').textContent=`${model.coin.symbol} · ${selected.start} – ${selected.end} UTC · ${minutes} MIN`;
    if(force||signature!==lastSignature){
      lastSignature=signature;
      cardFields=new WeakMap();
      $('detail-cards').innerHTML=intervals.map((m,index)=>window.PredictSegmentCard.markup(m,{index})).join('');
    }
    const quoteFresh=model.feedMode==='demo'||(model.spotStatus==='ready'&&Number.isFinite(model.priceUpdatedAt)&&Date.now()-model.priceUpdatedAt<=(model.coin.maxPriceAgeMs||15000)&&model.priceUpdatedAt<=Date.now()+5000&&!model.paused);
    const fresh=quoteFresh&&(model.feedMode==='demo'||model.feedConnection==='connected');
    const ready=model.dataStatus(model,selected,Date.now(),{allowLocked:true}).ready;
    const chance=selected.status==='open'&&(ready||model.feedMode==='demo')?model.estimateChances(selected,model.spot,now,model.volatility):null;
    const timelineLive=!model.isHistorical&&quoteFresh?{t:model.priceUpdatedAt,price:model.spot}:null;
    const timeline=model.minutePlot(candles,selected.startsAt,selected.endsAt,now,timelineLive,model.secondPoints);
    window.PredictMinuteTrend.render($('play-minute-heatmap'),{candles,startsAt:selected.startsAt,endsAt:selected.endsAt,now,historical:model.isHistorical,label:'this interval'});
    $('play-up').setAttribute('d',timeline.up);$('play-down').setAttribute('d',timeline.down);$('play-line').setAttribute('d',timeline.line);
    $('play-tip').setAttribute('visibility',timeline.tip?'visible':'hidden');
    if(timeline.tip){$('play-tip').setAttribute('cx',timeline.tip.x);$('play-tip').setAttribute('cy',timeline.tip.y);}
    const cursor=Math.max(0,Math.min(1000,(now-intervals[0].startsAt)/(minutes*60000)*1000));
    $('play-cursor').hidden=selected.status!=='open';
    $('play-cursor').style.left=`${cursor/10}%`;
    $('play-cutoff').style.left=`${100-5/(minutes*60)*100}%`;
    $('play-now-label').textContent=intervals[0].status==='open'?'LIVE · NOW':intervals[0].status==='queued'?'UPCOMING':'PAST PLAY';
    $('play-live').hidden=selectedStart===null&&!model.isHistorical;
    $('play-previous').disabled=selected.startsAt-minutes*60000-60000<Date.now()-30*86400000;
    $('play-next').disabled=intervals[0].startsAt>now;
    $('play-chart-empty').hidden=!!timeline.line||timeline.count>0;
    $('play-chart-empty').textContent=selected.status==='queued'?'Chart begins when this play opens':historyRequest?.key===key?'Loading selected interval…':cached?.error?'Minute history unavailable · retrying automatically':'No minute candles available for this interval';
    const times=`<span>${selected.start}</span><span>${selected.end}</span>`;
    if($('play-times').innerHTML!==times)$('play-times').innerHTML=times;
    $('detail-cards').querySelectorAll('[data-detail-index]').forEach((card,index)=>{
      const m=intervals[index],/** Find an indexed field within one interval card. */ get=selector=>field(card,selector),queued=m.status==='queued',closed=m.status==='settled';
      const live=!model.isHistorical&&!closed&&!queued&&fresh?{t:model.priceUpdatedAt,price:model.spot}:null;
      const result=closed&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?model.outcome(m.strike,m.close):null;
      const seconds=Math.max(0,Math.ceil(((queued?m.startsAt:m.endsAt)-now)/1000));
      renderPredictionTags(m,get('predictions'));
      get('coin').src=model.coin.icon||'assets/coins/btc.svg';get('coin').alt=model.coin.name;
      get('coin-name').textContent=`${model.coin.symbol} · ${minutes} MIN`;
      get('status').textContent=queued?'UPCOMING':closed?(result?'COMPLETED':'PENDING'):'OPEN';
      get('status').className=`badge ${queued?'neutral':closed?(result==='up'?'green':result==='down'?'red':'neutral'):'green'}`;
      get('countdown').textContent=closed?'Interval ended':`${queued?'Starts in':'Ends in'} ${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s${!queued&&seconds<=5?' · Betting closed':''}`;
      get('strike').textContent=queued?'Set at open':price(m.strike);
      get('price-label').textContent=closed?'Closing price':'Live price';get('price').textContent=closed?price(m.close):live?price(live.price):'—';
      const displayedPrice=closed?m.close:live?.price;
      get('price').dataset.direction=Number.isFinite(displayedPrice)&&Number.isFinite(m.strike)?(displayedPrice>=m.strike?'up':'down'):'';
      get('chances').hidden=!chance;
      window.PredictSegmentCard.updateOdds(get('up-chance'),chance?.up,'Up');
      window.PredictSegmentCard.updateOdds(get('down-chance'),chance?.down,'Down');
      get('summary').hidden=!!chance;
      get('summary').textContent=queued?'Benchmark is set when this interval opens.':result?`${result==='up'?'↑ Up':'↓ Down'} wins · ${price(m.strike)} → ${price(m.close)}`:closed?'Awaiting exact settlement candles':'Waiting for fresh price and benchmark data';
      const movement=queued?null:window.PredictSegmentCard.priceMovement(m.strike,displayedPrice);
      get('movement').hidden=!movement;
      get('movement').textContent=movement?movement.label:'';
      get('movement').dataset.direction=movement?movement.direction:'';
      get('result').style.color=result==='up'?'var(--green)':result==='down'?'var(--red)':'var(--muted)';
      const action=get('predict');action.hidden=false;
      action.disabled=!closed&&!queued&&(!model.markets.some(item=>item.id===m.id&&item.startsAt===m.startsAt)||!model.dataStatus(model,m,Date.now()).ready);
    });
  }
  window.addEventListener('market-interval-select',event=>selectInterval(event.detail?.minutes,event.detail?.startsAt));
  $('show-detail').addEventListener('click',()=>showDetail(true));$('show-overview').addEventListener('click',()=>showDetail(false));
  $('market-grid').addEventListener('dblclick',event=>{
    if(event.target.closest('button, a, input, select, textarea, [contenteditable]'))return;
    const card=event.target.closest('[data-market]');
    const interval=card&&model.markets.find(item=>item.id===card.dataset.market);
    if(!interval)return;
    selectInterval(interval.minutes,interval.startsAt);
    showDetail(true);
  });
  $('detail-cards').addEventListener('dblclick',event=>{
    if(event.target.closest('button, a, input, select, textarea, [contenteditable]'))return;
    const card=event.target.closest('[data-detail-index]');
    const interval=card&&intervals[Number(card.dataset.detailIndex)];
    if(!interval)return;
    const hour=Math.floor(interval.startsAt/3600000)*3600000;
    showDetail(false);
    if(hour!==model.displayHour&&hour<=Math.floor(model.now/3600000)*3600000){
      window.dispatchEvent(new CustomEvent('market-hour-select',{detail:{hour}}));
    }
  });
  document.querySelectorAll('[data-detail-duration]').forEach(button=>button.addEventListener('click',()=>{
    selectInterval(Number(button.dataset.detailDuration));
  }));
  $('detail-cards').addEventListener('click',event=>{
    const button=event.target.closest('[data-detail-predict]');if(!button)return;
    const m=intervals[Number(button.dataset.detailPredict)];
    if(m)window.dispatchEvent(new CustomEvent('detail-predict',{detail:{id:m.id,startsAt:m.startsAt,market:m}}));
  });
  const /** Move the selected play by one interval in either direction. */ move=direction=>{
    const current=intervals[0];if(!current)return;
    selectedStart=current.startsAt+direction*minutes*60000;
    render(true);
  };
  $('play-previous').addEventListener('click',()=>move(-1));
  $('play-next').addEventListener('click',()=>move(1));
  $('play-live').addEventListener('click',()=>{selectedStart=null;if(model.isHistorical)$('current-hour').click();render(true);});
  window.addEventListener('coin-change',()=>{cancelHistory();historyCache.clear();selectedStart=null;render(true);});
  showDetail(true);
  ['btc-market-update','btc-price-update','btc-chances-update','account-update'].forEach(name=>window.addEventListener(name,()=>render()));
  window.addEventListener('pagehide',cancelHistory);
})();
