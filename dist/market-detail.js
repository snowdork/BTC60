/** @module market-detail
 * Render and navigate a single play using exact minute history for its time range.
 */
(() => {
  'use strict';
  const model=window.PredictModel,elements=new Map();
  const /** Find and retain a stable workspace element, separate from replaceable card fields. */ $=id=>{if(!elements.has(id))elements.set(id,document.getElementById(id));return elements.get(id);};
  /** Write a DOM property only when the displayed value changes. */
  function set(node,key,value){if(node[key]!==value)node[key]=value;}
  /** Write an SVG or image attribute only when its serialized value changes. */
  function attribute(node,name,value){const text=String(value);if(node.getAttribute(name)!==text)node.setAttribute(name,text);}
  const /** Format an available instrument price or a missing-data placeholder. */ price=value=>Number.isFinite(value)?window.PredictCoins.formatPrice(value,model.coin.symbol):'—';
  const creditFormatter=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const movementFormatter=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
  let minutes=15,visible=true,durationSelected=true,lastSignature='',intervals=[],selectedStart=null;
  const historyCache=new Map();
  let sourceCandles=null,extraCandles=null,mergedCandles=[];
  let cardFields=new WeakMap();
  let predictionSource=null,predictionUser=null;
  const predictionIndex=new Map();
  const /** Identify saved orders by their coin, market and exact absolute boundaries. */ predictionKey=(coin,id,start,end)=>`${coin}:${id}:${start}:${end}`;
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
    if(predictionSource!==account?.predictions||predictionUser!==account?.user){
      predictionSource=account?.predictions;predictionUser=account?.user;predictionIndex.clear();
      for(const p of predictionUser?predictionSource||[]:[]){
        if(p.mode!=='contest')continue;
        const key=predictionKey(p.coin,p.market_id,p.starts_at*1000,p.ends_at*1000);
        if(!predictionIndex.has(key))predictionIndex.set(key,[]);
        predictionIndex.get(key).push(p);
      }
    }
    const saved=account?.user&&model.feedMode!=='demo'?predictionIndex.get(
      predictionKey(model.coin.symbol,selected.id,selected.startsAt,selected.endsAt))||[]:[];
    const signature=JSON.stringify(saved.map(p=>[p.id,p.side,p.cost_cents,p.cents,p.settled_at,p.outcome]));
    set(container,'hidden',!saved.length);
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
    set($('market-detail').dataset,'state',state);
    const signature=`${model.coin.symbol}:${minutes}:${selected.startsAt}:${model.feedMode}:${state}:${completed?model.outcome(selected.strike,selected.close):''}`;
    set($('detail-title'),'textContent',`${model.coin.name} price chart`);
    set($('play-coin-icon'),'hidden',!model.coin.icon);
    if(model.coin.icon)attribute($('play-coin-icon'),'src',model.coin.icon);
    set($('play-coin-icon'),'alt',model.coin.name);
    set($('play-coin-fallback'),'hidden',!!model.coin.icon);
    set($('play-coin-fallback'),'textContent',model.coin.symbol);
    attribute($('play-interval-clock'),'data-duration',minutes);
    attribute($('play-interval-clock'),'aria-label',`${minutes}-minute interval`);
    set($('play-interval-minutes'),'textContent',String(minutes));
    set($('detail-context'),'textContent',`${new Date(anchor).toISOString().slice(0,10)} · ${model.feedMode==='demo'?'Synthetic preview':selectedStart!==null||model.isHistorical?'Browsing selected interval':'Following the current interval'} · UTC`);
    set($('play-timeframe'),'textContent',`${selected.start} – ${selected.end} UTC`);
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
    attribute($('play-up'),'d',timeline.up);attribute($('play-down'),'d',timeline.down);attribute($('play-line'),'d',timeline.line);
    attribute($('play-tip'),'visibility',timeline.tip?'visible':'hidden');
    if(timeline.tip){attribute($('play-tip'),'cx',timeline.tip.x);attribute($('play-tip'),'cy',timeline.tip.y);}
    const cursor=Math.max(0,Math.min(1000,(now-intervals[0].startsAt)/(minutes*60000)*1000));
    set($('play-cursor'),'hidden',selected.status!=='open');
    set($('play-cursor').style,'left',`${cursor/10}%`);
    set($('play-cutoff').style,'left',`${100-5/(minutes*60)*100}%`);
    const completedResult=completed?model.outcome(selected.strike,selected.close):null;
    set($('play-now-label'),'textContent',completed?'COMPLETED':state==='pending'?'PENDING':state==='live'?'LIVE · NOW':'UPCOMING');
    set($('play-now-label'),'className',completed?`badge ${completedResult==='up'?'green':'red'}`:state==='pending'?'badge neutral':'');
    set($('play-live'),'hidden',selectedStart===null&&!model.isHistorical);
    set($('play-previous'),'disabled',selected.startsAt-minutes*60000-60000<Date.now()-30*86400000);
    set($('play-next'),'disabled',intervals[0].startsAt>now);
    set($('play-chart-empty'),'hidden',!!timeline.line||timeline.count>0);
    set($('play-chart-empty'),'textContent',selected.status==='queued'?'Chart begins when this play opens':historyRequest?.key===key?'Loading selected interval…':cached?.error?'Minute history unavailable · retrying automatically':'No minute candles available for this interval');
    const times=`<span>${selected.start}</span><span>${selected.end}</span>`;
    if($('play-times').innerHTML!==times)$('play-times').innerHTML=times;
    $('detail-cards').querySelectorAll('[data-detail-index]').forEach((card,index)=>{
      const m=intervals[index],/** Find an indexed field within one interval card. */ get=selector=>field(card,selector),queued=m.status==='queued',closed=m.status==='settled';
      const live=!model.isHistorical&&!closed&&!queued&&fresh?{t:model.priceUpdatedAt,price:model.spot}:null;
      const result=closed&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?model.outcome(m.strike,m.close):null;
      const seconds=Math.max(0,Math.ceil(((queued?m.startsAt:m.endsAt)-now)/1000));
      renderPredictionTags(m,get('predictions'));
      attribute(get('coin'),'src',model.coin.icon||'assets/coins/btc.svg');set(get('coin'),'alt',model.coin.name);
      set(get('coin-name'),'textContent',model.coin.symbol);
      set(get('coin-name'),'hidden',!!model.coin.icon);
      set(get('status'),'textContent',queued?'UPCOMING':closed?(result?'COMPLETED':'PENDING'):'OPEN');
      set(get('status'),'className',`badge ${queued?'neutral':closed?(result==='up'?'green':result==='down'?'red':'neutral'):'green'}`);
      set($('play-countdown'),'textContent',closed?'Interval ended':`${queued?'Starts in':'Ends in'} ${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s${!queued&&seconds<=5?' · Betting closed':''}`);
      set(get('strike'),'textContent',queued?'Set at open':price(m.strike));
      set(get('price-label'),'textContent',closed?'Closing price':'Live price');set(get('price'),'textContent',closed?price(m.close):live?price(live.price):'—');
      const displayedPrice=closed?m.close:live?.price;
      set(get('price').dataset,'direction',Number.isFinite(displayedPrice)&&Number.isFinite(m.strike)?(displayedPrice>=m.strike?'up':'down'):'');
      set(get('chances'),'hidden',!chance);
      window.PredictSegmentCard.updateOdds(get('up-chance'),chance?.up,'Up');
      window.PredictSegmentCard.updateOdds(get('down-chance'),chance?.down,'Down');
      const movement=queued?null:window.PredictSegmentCard.priceMovement(m.strike,displayedPrice);
      const percent=movement?`${movement.percent<0?'−':'+'}${movementFormatter.format(Math.abs(movement.percent))}%`:'';
      set(get('summary'),'hidden',!!chance);
      set(get('summary'),'textContent',queued?'Benchmark is set when this interval opens.':result?`${result==='up'?'↑ Up':'↓ Down'} wins`:closed?'Awaiting exact settlement candles':'Waiting for fresh price and benchmark data');
      set(get('movement'),'hidden',!movement);
      set(get('movement'),'textContent',movement?(result?percent:`${movement.direction==='up'?'↑ Up':'↓ Down'} ${percent}`):'');
      set(get('movement').dataset,'direction',movement?movement.direction:'');
      set(get('result').style,'color',result==='up'?'var(--green)':result==='down'?'var(--red)':'var(--muted)');
      const action=get('action');set(action,'hidden',false);
      set(action,'disabled',!closed&&!queued&&(!model.markets.some(item=>item.id===m.id&&item.startsAt===m.startsAt)||!model.dataStatus(model,m,Date.now()).ready));
      for(const node of [get('up-chance'),get('down-chance')])set(node,'disabled',closed||queued||action.disabled);
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
    const button=event.target.closest('[data-detail-predict]');if(!button||button.disabled)return;
    const m=intervals[Number(button.dataset.detailPredict)];
    if(m)window.dispatchEvent(new CustomEvent('detail-predict',{detail:{id:m.id,startsAt:m.startsAt,market:m,side:button.dataset.predictSide}}));
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
  ['btc-market-update','btc-price-update','btc-chances-update'].forEach(name=>window.addEventListener(name,()=>render()));
  window.addEventListener('account-update',()=>{predictionSource=null;render();});
  window.addEventListener('pagehide',cancelHistory);
})();
