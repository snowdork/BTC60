/** @module btc-chart
 * Maintain quote transports, exact minute benchmarks, hourly chart state, and synthetic preview.
 */
/* Public Coinbase spot visualization. Contract quotes and benchmarks are demos. */
(() => {
  'use strict';
  const model=window.PredictModel,/** Find an interface element by its stable DOM identifier. */ $=id=>document.getElementById(id);
  const PRICE_UPDATE_MS=1000;
  let coin=model.coin;
  const /** Report whether the selected instrument uses the deterministic simulation feed. */ simulated=()=>coin.feed==='simulated';
  const /** Choose server polling for simulated and oil-provider instruments. */ serverFeed=()=>simulated()||['twelvedata','oilpriceapi'].includes(coin.feed);
  const /** Read the instrument quote freshness limit, falling back to fifteen seconds. */ maxAge=()=>coin.maxPriceAgeMs||15000;
  const /** Name the active quote provider for the chart and observation banner. */ sourceLabel=()=>coin.feed==='oilpriceapi'?'OilPriceAPI spot assessments':coin.feed==='twelvedata'?'Twelve Data live oil':simulated()?'Simulated oil':'Coinbase';
  const /** Format a monetary display value using the module currency formatter. */ money=v=>window.PredictCoins.formatPrice(v,coin.symbol);
  const hourlyPercent=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
  const /** Round epoch milliseconds down to the beginning of the UTC hour. */ hourOf=t=>Math.floor(t/3600000)*3600000;
  const /** Format the current time value as UTC hour and minute. */ time=t=>new Date(t).toISOString().slice(11,16);
  const /** Format an epoch-millisecond timestamp as a UTC clock including seconds. */ clock=t=>new Date(t).toISOString().slice(11,19);
  const localClock=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'});
  const localTimezone=localClock.resolvedOptions().timeZone;
  const /** Format a nonnegative duration as minutes and seconds. */ remaining=ms=>`${Math.max(0,Math.floor(ms/60000))}m ${String(Math.max(0,Math.floor(ms/1000)%60)).padStart(2,'0')}s`;
  let historical=false,historyFailed=false;
  let mode='live',paused=false,socket=null,retryTimer=null,fetchController=null,historyVersion=0,feedVersion=0;
  let hour=hourOf(Date.now()),points=[],candles=[],lastPriceAt=0,lastPrice=null,lastHistoryAt=0,lastSpotPollAt=-Infinity,backoff=1000;
  const secondHistory=new Map();
  /** Keep one observed price per second, isolated by coin and feed mode, for two hours. */
  function recordSecond(now){
    if(historical||paused||stopped||!Number.isFinite(lastPrice)||lastPrice<=0)return;
    if(mode!=='demo'&&(!hasFreshQuote()||model.priceUpdatedAt<hourOf(now)))return;
    const trail=model.secondPoints;if(!trail)return;
    const t=Math.floor(now/1000)*1000,last=trail.at(-1);
    if(last&&t<last.t)return;
    const closing=candles.findLast(c=>c[0]*1000+60000<=now);
    const price=closing&&closing[0]*1000+60000>model.priceUpdatedAt?Number(closing[4]):lastPrice;
    if(last?.t===t)last.price=price;
    else trail.push({t,price});
    while(trail.length&&trail[0].t<now-7200000)trail.shift();
    if(trail.length>7201)trail.splice(0,trail.length-7201);
  }
  let demoEpoch=Date.now(),demoStart=new Date().setUTCHours(17,42,12,0),demoSecond=-1,lastDraw=0;
  let lastPlotAt=-Infinity;
  let previousBannerPrice,bannerTrend='',lastBannerUpdate=-Infinity;
  /** Render banner price from the latest account, market, and interface state. */ function renderBannerPrice(){
    const state=historical?(Number.isFinite(lastPrice)?'ready':historyFailed?'unavailable':'loading'):model.spotStatus;
    const value=state==='ready'&&Number.isFinite(lastPrice)?lastPrice:null,banner=$('btc-spot');
    if(value===previousBannerPrice&&banner.dataset.state===state)return;
    if(!historical&&state==='ready'&&banner.dataset.state===state&&Number.isFinite(previousBannerPrice)&&Date.now()-lastBannerUpdate<PRICE_UPDATE_MS)return;
    lastBannerUpdate=Date.now();
    if(value!==null&&Number.isFinite(previousBannerPrice)){
      bannerTrend=value>previousBannerPrice?'up':'down';
    }
    if(value===null)bannerTrend='';
    previousBannerPrice=value;
    const formatted=value===null?(state==='loading'?'Loading…':'Data Not Available'):money(value),decimal=formatted.lastIndexOf('.');
    banner.dataset.state=state;
    if(decimal<0){banner.textContent=formatted;return;}
    const digits=document.createElement('span');
    digits.className='spot-decimals';
    digits.dataset.trend=bannerTrend;
    digits.textContent=formatted.slice(decimal+1);
    banner.replaceChildren(formatted.slice(0,decimal+1),digits);
  }
  let spotController=null;
  let frameId=0,stopped=false,connectionStartedAt=0,lastPriceBroadcast=0;
  const /** Return live wall-clock time or the synthetic preview timeline. */ currentTime=()=>mode==='demo'?demoStart+Date.now()-demoEpoch:Date.now();
  /** Update the feed badge label and visual tone. */ function status(text,tone='amber'){$('feed-status').dataset.live=String(['LIVE','SIMULATED','SIMULATED OIL','LIVE OIL'].includes(text));$('feed-status').textContent=text;$('feed-status').className=`badge ${tone}`;}
  /** Dispatch a chart state event for the prediction ticket and market renderer. */ function broadcast(name){window.dispatchEvent(new Event(name));}
  /** Check quote freshness independently of the WebSocket connection or chart history. */ function hasFreshQuote(){
    return Number.isFinite(lastPrice)&&Number.isFinite(model.priceUpdatedAt)&&Date.now()-model.priceUpdatedAt<=maxAge()&&model.priceUpdatedAt<=Date.now()+5000;
  }
  /** Explain unavailable quotes while retaining history and continuing automatic retries. */ function unavailableSpot(detail='Retrying automatically…'){
    if(hasFreshQuote())return;
    model.spotStatus='unavailable';model.feedConnection='disconnected';status('UNAVAILABLE');
    $('feed-message').textContent=`Data Not Available for ${coin.symbol}/USD. ${detail}`;$('feed-message').hidden=false;
    renderBannerPrice();broadcast('btc-chances-update');
  }
  let volatilityCandles=null,volatilityMinute=-1;
  let indexedCandles=null,candlesByTime=new Map();
  /** Rebuild the boundary lookup only when minute history is replaced. */
  function candleIndex(){
    if(indexedCandles!==candles){
      indexedCandles=candles;
      candlesByTime=new Map(candles.map(c=>[c[0]*1000,c]));
    }
    return candlesByTime;
  }
  /** Align interval states and opening/closing benchmarks to the displayed hour. */ function syncMarkets(now,force=false) {
    const state=[];model.paused=paused;model.now=now;model.displayHour=hour;model.candles=candles;const minute=Math.floor(now/60000);
    if(candles!==volatilityCandles||minute!==volatilityMinute){
      model.volatility=model.minuteVolatility(candles,now);volatilityCandles=candles;volatilityMinute=minute;
    }
    model.hour=`${coin.symbol}:${mode}:${new Date(hour).toISOString()}`;
    const boundaries=candleIndex();
    model.markets.forEach(m=>{
      const index=Number(m.id.split('-')[1]),start=hour+index*m.minutes*60000,end=start+m.minutes*60000;
      const opening=boundaries.get(start-60000),closing=boundaries.get(end-60000);
      const marketStatus=now>=end?'settled':now>=start?'open':'queued';
      const strike=marketStatus==='queued'?null:opening?Number(opening[4]):null;
      const close=marketStatus==='settled'&&closing?Number(closing[4]):null;
      const changed=m.status!==marketStatus||m.strike!==strike||m.close!==close||m.start!==time(start);
      Object.assign(m,{start:time(start),end:time(end),status:marketStatus,strike,close,startsAt:start,endsAt:end,remaining:remaining(end-now)+(marketStatus==='open'&&now>=end-5000?' - Locked':'')});
      if(m.up===null)m.up=50;
      state.push(changed);
      const label=document.querySelector(`[data-remaining="${m.id}"]`);if(label)label.textContent=m.remaining;
    });
    if(force||state.some(Boolean))broadcast('btc-market-update');
    broadcast('btc-chances-update');
  }
  /** Append or replace a quote sample while retaining the displayed hour history. */ function appendPoint(t,price) {
    if(!Number.isFinite(price)||price<=0||t<model.priceUpdatedAt)return;
    // One plotted point per second bounds the in-memory series to one hour.
    if(t>=hour&&t<=hour+3600000){
      const bucket=Math.floor(t/1000)*1000,last=points.at(-1);
      if(last&&Math.floor(last.t/1000)*1000===bucket)last.price=price;
      else {points.push({t,price});if(last&&t<last.t)points.sort((a,b)=>a.t-b.t);}
      if(points.length>3662)points.splice(0,points.length-3662);
    }
    lastPrice=price;lastPriceAt=Date.now();model.priceUpdatedAt=t;model.spot=price;model.spotStatus='ready';
    recordSecond(currentTime());
    renderBannerPrice();
    if(Date.now()-lastPriceBroadcast>=PRICE_UPDATE_MS){lastPriceBroadcast=Date.now();broadcast('btc-price-update');}
  }
  /** Calculate an illustrative synthetic price; these values cannot execute orders. */ function demoPrice(minute,second=0){return coin.demoBase*(1+(minute*1.5+Math.sin(minute*.48)*19+Math.sin(minute*1.8)*4+Math.sin(second*.5)*1.4)/67450);}
  /** Populate the synthetic preview hour with deterministic chart points. */ function demoHistory(now) {
    candles=[];
    for(let minute=-61;minute<120;minute++) {
      const t=hour+minute*60000;
      if(t>now)break;
      const price=demoPrice(minute);
      candles.push([t/1000,price-4,price+4,price-1,price,1]);
    }
    points=candles.filter(c=>c[0]*1000>=hour&&c[0]*1000+60000<=now).map(c=>({t:c[0]*1000+60000,price:c[4]}));
    syncMarkets(now,true);
  }
  /** Fetch an interval's provider candles, falling back to server pricing history for recent ranges. */
  async function loadMinuteHistory(start,end,{signal}={}){
    const instrument=coin;
    const useServer=['simulated','twelvedata','oilpriceapi'].includes(instrument.feed);
    const params=new URLSearchParams({granularity:'60',start:new Date(start).toISOString(),end:new Date(end).toISOString()});
    const url=useServer?`/api/candles?coin=${encodeURIComponent(instrument.symbol)}&start=${Math.floor(start/1000)}&end=${Math.floor(end/1000)}`:`https://api.exchange.coinbase.com/products/${encodeURIComponent(instrument.product)}/candles?${params}`;
    try{
      const response=await fetch(url,{signal});
      if(!response.ok)throw Error('Minute history unavailable');
      const rows=await response.json();
      if(!Array.isArray(rows))throw Error('Invalid minute history');
      return rows;
    }catch(error){
      if(signal?.aborted||start<Date.now()-86400000)throw error;
      // The server can still reach the provider when the browser's direct request fails.
      const response=await fetch(`/api/pricing-history?coin=${encodeURIComponent(instrument.symbol)}`,{signal});
      if(!response.ok)throw Error('Minute history unavailable');
      const rows=(await response.json()).candles;
      if(!Array.isArray(rows))throw Error('Invalid minute history');
      const selected=rows.filter(c=>Array.isArray(c)&&c[0]*1000>=start&&c[0]*1000<end);
      if(!selected.length)throw Error('No minute history for this interval');
      return selected;
    }
  }
  model.loadMinuteHistory=loadMinuteHistory;
  /** Load exact minute benchmarks and volatility history, discarding responses for superseded hours or instruments. */ async function loadHistory() {
    if(mode!=='live'||stopped)return;
    if(fetchController)fetchController.abort();
    historyFailed=false;model.historyStatus='loading';model.pricingHistoryStatus='loading';
    const controller=new AbortController();fetchController=controller;
    const version=++historyVersion,requestedHour=hour,requestedCoin=coin.symbol;
    const timeout=setTimeout(()=>controller.abort(),60000);
    try {
      const historyStart=hour-3660000,historyEnd=Math.min(Date.now(),hour+7200000);
      const chartData=await loadMinuteHistory(historyStart,historyEnd,{signal:controller.signal});
      const /** Prevent a stale asynchronous history response from replacing a newer instrument or hour. */ isCurrentRequest=()=>mode==='live'&&version===historyVersion&&requestedHour===hour&&requestedCoin===coin.symbol;
      if(!isCurrentRequest())return;
      if(!Array.isArray(chartData))throw new Error('Invalid chart history');
      /** Apply validated history only to the request context that remains current. */ function applyHistory(data){
        const displayEnd=Math.min(Date.now(),hour+3600000);
        candles=[...new Map(data.filter(c=>Array.isArray(c)&&c.length>=5&&c.slice(0,5).every(Number.isFinite)&&c[4]>0&&c[0]*1000>=displayEnd-86400000&&c[0]*1000<historyEnd).map(c=>[c[0],c])).values()].sort((a,b)=>a[0]-b[0]);
        const history=candles.filter(c=>c[0]*1000>=hour&&c[0]*1000+60000<=displayEnd).map(c=>({t:c[0]*1000+60000,price:c[4]}));
        // The preceding minute's close is the known price at the hour's start.
        const opening=candles.find(c=>c[0]*1000===hour-60000);
        if(opening)history.unshift({t:hour,price:opening[4]});
        const cutoff=history.at(-1)?.t??hour;
        points=[...history,...points.filter(p=>p.t>cutoff)];
        lastHistoryAt=Date.now();model.historyStatus='ready';model.historyUpdatedAt=lastHistoryAt;
        syncMarkets(Date.now(),true);draw(Date.now(),true);
      }
      // Render chart history immediately; the longer pricing backfill is independent.
      applyHistory(chartData);
      if(!historical){
        try{
          const pricingResponse=await fetch(`/api/pricing-history?coin=${encodeURIComponent(coin.symbol)}`,{signal:controller.signal});
          if(!pricingResponse.ok)throw new Error('Pricing history unavailable');
          const pricingData=(await pricingResponse.json()).candles;
          if(!Array.isArray(pricingData))throw new Error('Invalid pricing history');
          if(!isCurrentRequest())return;
          applyHistory([...pricingData,...chartData]);
          model.pricingHistoryStatus='ready';
        }catch(error){
          if(!isCurrentRequest())return;
          model.pricingHistoryStatus='error';broadcast('btc-chances-update');
          $('chart-source').textContent='Chart history loaded · pricing history unavailable';
        }
      }
      if(historical){lastPrice=candles.find(c=>c[0]*1000===hour+3600000-60000)?.[4]??null;model.spot=lastPrice??NaN;status('HISTORICAL','neutral');$('chart-source').textContent=`${sourceLabel()} history · settlements`;}
      syncMarkets(Date.now(),true);draw(Date.now(),true);
    } catch(error) {
      if(mode==='live'&&version===historyVersion){historyFailed=true;model.historyStatus='error';broadcast('btc-chances-update');$('chart-source').textContent='History unavailable · reconnect or use synthetic preview';}
    } finally {clearTimeout(timeout);if(fetchController===controller)fetchController=null;}
  }
  /** Fetch an initial quote and retry missing updates, validating provider timestamps before displaying prices. */ async function pollSpot(){
    if(spotController||stopped||historical||mode!=='live')return;
    if(Date.now()-lastSpotPollAt<(serverFeed()?5000:PRICE_UPDATE_MS))return;
    lastSpotPollAt=Date.now();
    const controller=new AbortController(),requestedCoin=coin.symbol,version=feedVersion,useServer=serverFeed();
    spotController=controller;
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const url=useServer?`/api/spot?coin=${encodeURIComponent(requestedCoin)}`:`https://api.exchange.coinbase.com/products/${encodeURIComponent(coin.product)}/ticker`;
      const response=await fetch(url,{signal:controller.signal,cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw Error(data?.error||data?.message||'Price feed unavailable');
      if(version!==feedVersion||coin.symbol!==requestedCoin||mode!=='live'||historical||stopped)return;
      const tick=useServer?data:{price:Number(data?.price),time:Date.parse(data?.time)};
      if(coin.feed==='oilpriceapi'&&tick.quoteKind==='assessment'){
        if(!Number.isFinite(tick.price)||tick.price<=0||!Number.isFinite(tick.time)||tick.time>Date.now()+5000)throw Error('Invalid oil assessment');
        appendPoint(Date.now(),tick.price);model.priceUpdatedAt=tick.time;model.feedConnection='disconnected';
        $('chart-source').textContent=`OilPriceAPI · assessed ${new Date(tick.time).toISOString().slice(0,16).replace('T',' ')} UTC · checked every 5s`;
        $('feed-message').textContent=`${tick.message} Source: ${new Date(tick.time).toISOString().slice(0,16).replace('T',' ')} UTC`;$('feed-message').hidden=false;
        status('SPOT ASSESSMENT','amber');broadcast('btc-price-update');return;
      }
      if(!Number.isFinite(tick?.price)||tick.price<=0||!Number.isFinite(tick.time)||Date.now()-tick.time>maxAge()||tick.time>Date.now()+5000)throw Error('Price quote stale or invalid');
      model.feedConnection='connected';appendPoint(tick.time,tick.price);
      $('feed-message').textContent='';$('feed-message').hidden=true;
      if(!paused)status(simulated()?'SIMULATED OIL':useServer?'LIVE OIL':'LIVE',simulated()?'amber':'green');
    }catch(error){
      if(version===feedVersion&&coin.symbol===requestedCoin&&mode==='live'&&!historical&&!stopped)unavailableSpot(useServer?`${controller.signal.aborted?'Price provider timed out.':error.message} Retrying automatically…`:undefined);
    }finally{clearTimeout(timeout);if(spotController===controller)spotController=null;}
  }
  /** Close active quote transports and cancel their timers before switching feeds. */ function disconnect() {
    clearTimeout(retryTimer);retryTimer=null;
    if(spotController){spotController.abort();spotController=null;}
    if(socket){const old=socket;socket=null;old.onclose=null;old.close();}
    if(fetchController){fetchController.abort();fetchController=null;}
    historyVersion++;feedVersion++;lastSpotPollAt=-Infinity;
  }
  /** Start the selected quote transport and update feed connection state. */ function connect() {
    if(mode!=='live'||historical||stopped)return;
    pollSpot();
    if(serverFeed())return;
    if(!hasFreshQuote()){status('CONNECTING');model.feedConnection='connecting';}
    connectionStartedAt=Date.now();
    try {socket=new WebSocket('wss://ws-feed.exchange.coinbase.com');}catch{scheduleRetry();return;}
    const active=socket;
    active.onopen=/** Handle the open event for the current transport or resource. */ ()=>{if(socket!==active)return;model.feedConnection='connected';active.send(JSON.stringify({type:'subscribe',product_ids:[coin.product],channels:['ticker']}));};
    active.onmessage=/** Handle the message event for the current transport or resource. */ event=>{
      if(socket!==active||mode!=='live'||historical)return;
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(data.type!=='ticker'||data.product_id!==coin.product)return;
      const price=Number(data.price),t=Date.parse(data.time);
      if(!Number.isFinite(price)||price<=0||!Number.isFinite(t)||Date.now()-t>15000||t>Date.now()+5000)return;
      if(hourOf(Date.now())!==hour)resetHour(Date.now());
      model.feedConnection='connected';appendPoint(t,price);backoff=1000;
      $('feed-message').textContent='';$('feed-message').hidden=true;
      if(!paused)status('LIVE','green');
    };
    active.onerror=/** Handle the error event for the current transport or resource. */ ()=>{if(socket===active)active.close();};
    active.onclose=/** Handle the close event for the current transport or resource. */ ()=>{if(socket!==active)return;socket=null;scheduleRetry();broadcast('btc-chances-update');};
  }
  /** Schedule a connection retry without creating multiple outstanding retry timers. */ function scheduleRetry() {
    if(mode!=='live'||historical||stopped)return;
    if(!hasFreshQuote()){model.feedConnection='disconnected';status('RECONNECTING');}
    clearTimeout(retryTimer);retryTimer=setTimeout(connect,backoff);backoff=Math.min(30000,backoff*2);
  }
  /** Reset chart and benchmark state for a UTC hour before loading its history. */ function resetHour(now,targetHour=hourOf(now)) {
    lastPlotAt=-Infinity;
    previousBannerPrice=undefined;bannerTrend='';
    $('feed-message').textContent='';$('feed-message').hidden=true;
    hour=targetHour;historical=hour<hourOf(now);model.isHistorical=historical;model.feedMode=mode;model.priceUpdatedAt=0;model.spotStatus='loading';model.historyStatus='loading';model.feedConnection='disconnected';model.historyUpdatedAt=0;historyFailed=false;points=[];candles=[];lastPrice=null;lastPriceAt=0;model.spot=NaN;
    const historyKey=`${mode}:${coin.symbol}`;
    if(!secondHistory.has(historyKey))secondHistory.set(historyKey,[]);
    model.secondPoints=secondHistory.get(historyKey);
    syncMarkets(now,true);if(mode==='demo'){demoHistory(historical?hour+3600000:now);if(historical){lastPrice=points.at(-1)?.price??null;model.spot=lastPrice??NaN;syncMarkets(now,true);}}else loadHistory();
  }
  /** Switch between live and synthetic preview modes and reload the selected hour. */ function setMode(next,targetHour) {
    disconnect();mode=next;paused=false;lastHistoryAt=0;backoff=1000;demoEpoch=Date.now();demoSecond=-1;
    $('demo-preview').textContent=mode==='demo'?`${simulated()?'Oil game':'Live '+coin.symbol}`:'Synthetic preview';
    $('chart-pause').textContent='Pause';$('chart-pause').setAttribute('aria-pressed','false');
    $('clock-label').textContent=mode==='demo'?'Simulated UTC':'UTC';
    resetHour(currentTime(),targetHour);
    if(mode==='demo'){status('SIMULATED','amber');$('chart-source').textContent='Synthetic preview · no live feed';}
    else{$('chart-source').textContent=`${sourceLabel()} prices · points predictions`;connect();}
    if(historical){status('HISTORICAL','neutral');$('chart-source').textContent=mode==='demo'?'Simulated history · settlements':`${sourceLabel()} history · settlements`;}
    draw(currentTime());
  }
  let annotationCandles=null,annotationHour=null,annotationMinute=null,annotationMode=null,annotationHistorical=null;
  /** Render minute summary arrows beneath the corresponding candle centers. */
  function renderMinuteTrend(displayTime){
    window.PredictMinuteTrend.render($('minute-heatmap'),{candles,startsAt:hour,endsAt:hour+3600000,now:displayTime,historical,label:'this hour'});
  }
  /** Mark completed quarters only when both exact settlement boundary candles exist. */
  function renderSegmentResults(displayTime){
    const markers=[],closes=new Map(candles.map(c=>[c[0]*1000,Number(c[4])]));
    for(let index=0;index<4;index++){
      const start=hour+index*900000,end=start+900000;
      if(end>displayTime)continue;
      const opening=closes.get(start-60000),closing=closes.get(end-60000);
      if(!Number.isFinite(opening)||opening<=0||!Number.isFinite(closing)||closing<=0)continue;
      const direction=closing>=opening?'up':'down',marker=document.createElement('span');
      marker.className='segment-result';marker.dataset.direction=direction;
      marker.style.left=`${index*25+12.5}%`;marker.textContent=direction==='up'?'↑':'↓';
      marker.title=`${time(start)}–${time(end)} UTC · ${direction==='up'?'Up':'Down'} wins${mode==='demo'?' · Synthetic preview':''}`;
      marker.setAttribute('role','img');marker.setAttribute('aria-label',marker.title);markers.push(marker);
    }
    $('segment-results').replaceChildren(...markers);
  }
  /** Project valid price points into SVG coordinates and update chart and benchmark labels. */ function draw(now,force=false) {
    const displayTime=historical?hour+3600000:now;
    $('hour-overview').dataset.state=historical?'completed':'live';
    $('chart-pair-label').textContent=`${coin.symbol} · ${time(hour)} – ${time(hour+3600000)} UTC · FULL HOUR`;
    const duration=Number($('hour-overview').dataset.duration)||15;
    $('hour-cutoffs').setAttribute('d',Array.from({length:60/duration},(_,index)=>{
      const x=((index+1)*duration*60000-5000)/3600000*1000;
      return `M${x} 0V130`;
    }).join(' '));
    $('time-cursor').hidden=historical;
    $('next-hour').disabled=!historical;$('current-hour').hidden=!historical;$('chart-pause').disabled=historical;
    $('hour-date').textContent=`${new Date(hour).toISOString().slice(0,10)} · UTC`;
    $('price-context').textContent=coin.feed==='oilpriceapi'?'SPOT ASSESSMENT · USD / BARREL':historical?'HOUR CLOSE':mode==='demo'?'SYNTHETIC PREVIEW':simulated()?'SIMULATED · USD / BARREL':coin.feed==='twelvedata'?'LIVE SPOT · USD / BARREL':'LIVE SPOT';
    $('market-heading').textContent=historical?'Settlement history · results':'Choose your market';
    const fraction=Math.max(0,Math.min(1,(now-hour)/3600000));
    const stack=$('timeline-stack'),chart=$('btc-chart'),bounds=chart.getBoundingClientRect(),stackBounds=stack.getBoundingClientRect();
    // Match the hourly chart's live marker to its plot bounds.
    stack.style.setProperty('--hour-progress',`${fraction*100}%`);
    stack.style.setProperty('--cursor-x',`${bounds.left-stackBounds.left+fraction*bounds.width}px`);
    stack.style.setProperty('--cursor-top',`${bounds.top-stackBounds.top}px`);
    $('time-cursor-label').textContent=clock(now);
    const wallTime=Date.now();
    $('workspace-clock').textContent=`${clock(wallTime)} GMT`;
    $('workspace-local-clock').textContent=localClock.format(wallTime);
    $('workspace-local-clock').title=`Local time · ${localTimezone}`;
    $('hour-window-label').textContent=`${time(hour)} — ${time(hour+3600000)}`;
    if($('chart-times').dataset.hour!==String(hour)){$('chart-times').dataset.hour=String(hour);$('chart-times').replaceChildren(...[0,15,30,45,60].map(minute=>{const span=document.createElement('span');span.textContent=time(hour+minute*60000);return span;}));}
    renderBannerPrice();
    const plotTime=Date.now();
    if(!force&&plotTime-lastPlotAt<PRICE_UPDATE_MS)return;
    lastPlotAt=plotTime;
    const quoteFresh=mode==='demo'||hasFreshQuote();
    const fresh=quoteFresh&&(mode==='demo'||model.feedConnection==='connected');
    const minutePlot=coin.feed==='oilpriceapi'&&mode==='live'?null:model.minutePlot(candles,hour,hour+3600000,displayTime,!historical&&quoteFresh?{t:model.priceUpdatedAt,price:model.spot}:null,model.secondPoints);
    $('chart-high').textContent=Number.isFinite(minutePlot?.high)?money(minutePlot.high):'';
    $('chart-low').textContent=Number.isFinite(minutePlot?.low)?money(minutePlot.low):'';
    $('minute-bars-up').setAttribute('d',minutePlot?.up||'');$('minute-bars-down').setAttribute('d',minutePlot?.down||'');
    const valid=points.filter(p=>p.t>=hour&&p.t<=displayTime);
    const hasPoints=minutePlot?!!minutePlot.line:valid.length>0;
    const annotationMinuteNow=Math.floor(displayTime/60000);
    if(annotationCandles!==candles||annotationHour!==hour||annotationMinute!==annotationMinuteNow||annotationMode!==mode||annotationHistorical!==historical){
      renderMinuteTrend(displayTime);
      renderSegmentResults(displayTime);
      annotationCandles=candles;annotationHour=hour;annotationMinute=annotationMinuteNow;
      annotationMode=mode;annotationHistorical=historical;
    }
    $('chart-empty').hidden=hasPoints;
    $('chart-empty').textContent=historical?(historyFailed?'Data Not Available for this hour.':'Loading the selected hour…'):model.spotStatus==='unavailable'?'Data Not Available · retrying automatically…':coin.feed==='oilpriceapi'&&mode==='live'?'Checking latest spot assessment every 5 seconds…':mode==='demo'?'Starting synthetic preview…':lastPriceAt?'Waiting for history…':`Loading ${coin.symbol}/USD prices…`;
    const opening=candleIndex().get(hour-60000)?.[4];
    const change=(historical||model.spotStatus==='ready')&&Number.isFinite(lastPrice)&&Number.isFinite(opening)&&opening>0?lastPrice-opening:null;
    const sign=change<0?'−':'+';
    $('btc-change').textContent=change===null?(model.spotStatus==='unavailable'?'Retrying price feed…':'Waiting for price data'):`${sign}${money(Math.abs(change))} (${sign}${hourlyPercent.format(Math.abs(change)/opening*100)}%) ${historical?'that hour':'this hour'}`;
    $('btc-change').style.color=change!==null&&change<0?'var(--red)':'var(--green)';
    if(!hasPoints){$('btc-line').removeAttribute('d');$('btc-area').removeAttribute('d');$('btc-tip').setAttribute('visibility','hidden');return;}
    if(minutePlot){
      $('btc-line').setAttribute('d',minutePlot.line);$('btc-area').removeAttribute('d');
      if(minutePlot.tip){$('btc-tip').setAttribute('cx',minutePlot.tip.x);$('btc-tip').setAttribute('cy',minutePlot.tip.y);}
      $('btc-tip').setAttribute('visibility',!historical&&fresh&&minutePlot.tip?'visible':'hidden');
      $('chart-description').textContent=`${coin.name} ${historical?'historical':'current'} hour on ${new Date(hour).toISOString().slice(0,10)}, ${time(hour)}–${time(hour+3600000)} UTC. ${minutePlot.count} completed one-minute OHLC candles and ${minutePlot.secondCount} observed one-second prices. The line retains recorded second-by-second movement; earlier history uses minute closes. Live price is provisional.`;
      return;
    }
    let low=Math.min(...valid.map(p=>p.price)),high=Math.max(...valid.map(p=>p.price));
    const pad=Math.max(coin.demoBase*.00012,(high-low)*.18);low-=pad;high+=pad;
    const /** Project a timestamp into the chart horizontal coordinate. */ x=t=>(t-hour)/3600000*1000,/** Project a price into the chart vertical coordinate. */ y=p=>116-(p-low)/(high-low)*102;
    const path=valid.map((p,index)=>`${index?'L':'M'}${x(p.t).toFixed(3)},${y(p.price).toFixed(3)}`).join(' '),first=valid[0],last=valid.at(-1);
    $('btc-line').setAttribute('d',path);
    $('btc-area').setAttribute('d',`${path} L${x(last.t)},130 L${x(first.t)},130 Z`);
    $('btc-tip').setAttribute('cx',x(last.t));$('btc-tip').setAttribute('cy',y(last.price));$('btc-tip').setAttribute('visibility','visible');
    $('chart-description').textContent=historical?`${coin.name} historical price from ${time(hour)} to ${time(hour+3600000)} UTC on ${new Date(hour).toISOString().slice(0,10)}. Last available price ${money(last.price)}. Outcomes are settlement proxies.`:`${mode==='demo'?'Simulated':coin.feed==='oilpriceapi'?'Polled spot assessment (observation times, not market ticks)':sourceLabel()} ${coin.symbol}/USD hourly price. Latest ${money(last.price)}. Alternating red and yellow dots mark the current time at ${clock(now)} UTC.`;
  }
  /** Advance chart time and repaint when needed without issuing a draw for every unchanged frame. */ function frame(stamp) {
    if(stopped)return;
    if(!document.hidden&&stamp-lastDraw>=1000){
      if(historical){lastDraw=stamp;if(!paused)draw(currentTime());frameId=setTimeout(()=>frame(performance.now()),1000);return;}
      lastDraw=stamp;const now=currentTime();
      if(hourOf(now)!==hour)resetHour(now);
      if(mode==='demo'){
        const second=Math.floor(now/1000);
        if(second!==demoSecond){demoSecond=second;const minute=(now-hour)/60000;appendPoint(now,demoPrice(minute,second));}
        status('SIMULATED','amber');
      } else {
        if(serverFeed()||Date.now()-model.priceUpdatedAt>=PRICE_UPDATE_MS)pollSpot();
        if(coin.feed!=='oilpriceapi'&&lastPriceAt&&!hasFreshQuote()){unavailableSpot();if(socket){socket.close();}}
        if(socket&&Date.now()-connectionStartedAt>20000&&(!lastPriceAt||socket.readyState===WebSocket.CONNECTING))socket.close();
        // Refresh shortly after each minute closes so new interval benchmarks
        // do not wait until the wall-clock second of the initial page load.
        const minuteClosed=Math.floor(Date.now()/60000)>Math.floor(lastHistoryAt/60000)&&Date.now()%60000>=2000;
        if(!fetchController&&(minuteClosed||Date.now()-lastHistoryAt>60000)){lastHistoryAt=Date.now();loadHistory();}
      }
      recordSecond(now);syncMarkets(now);if(!paused)draw(now);else status('PAUSED','neutral');
    }
    frameId=setTimeout(()=>frame(performance.now()),1000);
  }
  $('demo-preview').addEventListener('click',()=>setMode(mode==='live'?'demo':'live'));
  $('feed-retry').addEventListener('click',()=>setMode('live',mode==='live'&&historical?hour:undefined));
  $('chart-pause').addEventListener('click',()=>{
    paused=!paused;model.paused=paused;broadcast('btc-chances-update');$('chart-pause').textContent=paused?'Resume':'Pause';$('chart-pause').setAttribute('aria-pressed',String(paused));
    if(paused)status('PAUSED','neutral');else {status(mode==='demo'?'SIMULATED':Date.now()-model.priceUpdatedAt<maxAge()?(simulated()?'SIMULATED OIL':serverFeed()?'LIVE OIL':'LIVE'):'STALE',mode==='demo'||simulated()?'amber':Date.now()-model.priceUpdatedAt<maxAge()?'green':'amber');syncMarkets(currentTime());draw(currentTime());}
  });
  document.addEventListener('visibilitychange',()=>{if(historical){if(!document.hidden){syncMarkets(currentTime());draw(currentTime());}return;}if(!document.hidden&&!paused){const now=currentTime();if(hourOf(now)!==hour)resetHour(now);syncMarkets(now,true);draw(now);if(mode==='live')loadHistory();}});
  window.addEventListener('pagehide',()=>{stopped=true;disconnect();clearTimeout(frameId);});
  window.addEventListener('pageshow',event=>{
    if(!event.persisted||!stopped)return;
    stopped=false;lastDraw=0;setMode(mode,historical?hour:undefined);
    frameId=setTimeout(()=>frame(performance.now()),1000);
  });
  /** Switch instrument, persist its category preference, and reset feed/history state. */ function selectCoin(symbol){
    coin=window.PredictCoins.getCoin(symbol);model.coin=coin;
    document.querySelectorAll('[data-coin]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.coin===coin.symbol)));
    for(const id of ['spot-coin-icon','price-coin-icon']){
      const icon=$(id);icon.hidden=!coin.icon;
      icon.onerror=/** Hide an unavailable coin icon. */ ()=>{icon.hidden=true;};
      if(coin.icon)icon.src=coin.icon;
      icon.alt=`${coin.name} logo`;
    }
    $('coin-name').textContent=coin.name.toUpperCase();
    $('market-pair-label').textContent=`${coin.symbol} / USD · PREDICTION MARKETS`;
    $('chart-pair-label').textContent=`${coin.symbol} / USD · 1H · 1m candles`;
    $('chart-title').textContent=`${coin.name} hourly price`;
    document.querySelector('.hour-chart').setAttribute('aria-label',`${coin.name} price for the current hour`);
    document.title=`${coin.name} · ${window.Predict60Category?.name||'Crypto'} · Predict60`;
    const description=coin.feed==='oilpriceapi'?'OilPriceAPI physical spot assessments with original source dates. These feeds do not supply the exact minute benchmarks required by this hourly game. Predictions remain unavailable.':coin.feed==='twelvedata'?'Twelve Data live spot prices in USD per barrel, updated minutely. Benchmarks use the exact completed one-minute candle before each interval boundary. Closed markets, stale quotes, and missing benchmark candles block new orders. No simulated substitute is used.':simulated()?'Simulated oil prices in USD per barrel. Opening and closing benchmarks use the simulated minute close immediately before each interval boundary. These are illustrative prices, not exchange quotes.':'Coinbase Exchange USD prices. Opening and closing benchmarks use the minute candle close immediately before each interval boundary. These are proxy settlements, not official exchange contracts or averaged prices.';
    $('settlement-source').textContent=coin.feed==='oilpriceapi'?'HOURLY PREDICTIONS UNAVAILABLE':coin.feed==='twelvedata'?'SETTLEMENT · LIVE OIL MINUTE CLOSE':simulated()?'SETTLEMENT · SIMULATED OIL':'Settlement:';
    $('settlement-source-detail').textContent=description;
    $('rules-source').textContent=description;
    try{localStorage.setItem(`predict_selected_coin_${coin.category||'crypto'}`,coin.symbol);}catch{}
    setMode(mode,historical?hour:undefined);broadcast('coin-change');
  }
  /** Navigate historical hours while preventing selection beyond the current hour. */ function navigateHour(target){setMode(mode,Math.min(target,hourOf(currentTime())));}
  window.addEventListener('market-hour-select',event=>{
    const target=event.detail?.hour;
    if(Number.isFinite(target)&&target%3600000===0)navigateHour(target);
  });
  $('previous-hour').addEventListener('click',()=>navigateHour(hour-3600000));
  $('next-hour').addEventListener('click',()=>navigateHour(hour+3600000));
  $('current-hour').addEventListener('click',()=>navigateHour(hourOf(currentTime())));
  window.addEventListener('market-overview',()=>draw(currentTime(),true));
  window.addEventListener('market-duration-change',()=>draw(currentTime(),true));
  window.addEventListener('resize',()=>draw(currentTime(),true));
  document.querySelectorAll('[data-coin]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.coin!==coin.symbol)selectCoin(button.dataset.coin);}));
  let savedCoin=window.PredictCoins.available[0].symbol;try{const preference=localStorage.getItem(`predict_selected_coin_${window.Predict60Category?.id||'crypto'}`)||localStorage.getItem('predict_selected_coin');if(window.PredictCoins.available.some(coin=>coin.symbol===preference))savedCoin=preference;}catch{}
  selectCoin(savedCoin);frameId=setTimeout(()=>frame(performance.now()),1000);
})();
