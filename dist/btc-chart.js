/** @module btc-chart
 * Maintain quote transports, exact minute benchmarks, hourly chart state, and synthetic preview.
 */
/* Public Coinbase spot visualization. Contract quotes and benchmarks are demos. */
(() => {
  'use strict';
  const model=window.PredictModel,/** Find an interface element by its stable DOM identifier. */ $=id=>document.getElementById(id);
  const PRICE_UPDATE_MS=2000;
  let coin=model.coin;
  const /** Report whether the selected instrument uses the deterministic simulation feed. */ simulated=()=>coin.feed==='simulated';
  const /** Choose server polling for simulated and oil-provider instruments. */ serverFeed=()=>simulated()||['twelvedata','oilpriceapi'].includes(coin.feed);
  const /** Read the instrument quote freshness limit, falling back to fifteen seconds. */ maxAge=()=>coin.maxPriceAgeMs||15000;
  const /** Name the active quote provider for the chart and observation banner. */ sourceLabel=()=>coin.feed==='oilpriceapi'?'OilPriceAPI spot assessments':coin.feed==='twelvedata'?'Twelve Data live oil':simulated()?'Simulated oil':'Coinbase';
  const /** Format a monetary display value using the module currency formatter. */ money=v=>window.PredictCoins.formatPrice(v,coin.symbol);
  const /** Round epoch milliseconds down to the beginning of the UTC hour. */ hourOf=t=>Math.floor(t/3600000)*3600000;
  const /** Format the current time value as UTC hour and minute. */ time=t=>new Date(t).toISOString().slice(11,16);
  const /** Format an epoch-millisecond timestamp as a UTC clock including seconds. */ clock=t=>new Date(t).toISOString().slice(11,19);
  const localClock=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'});
  const localTimezone=localClock.resolvedOptions().timeZone;
  const /** Format a nonnegative duration as minutes and seconds. */ remaining=ms=>`${Math.max(0,Math.floor(ms/60000))}m ${String(Math.max(0,Math.floor(ms/1000)%60)).padStart(2,'0')}s`;
  let historical=false,historyFailed=false;
  let mode='live',paused=false,socket=null,retryTimer=null,fetchController=null,historyVersion=0,feedVersion=0;
  let hour=hourOf(Date.now()),points=[],candles=[],lastPriceAt=0,lastPrice=null,lastHistoryAt=0,lastSpotPollAt=-Infinity,backoff=1000;
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
  /** Update the feed badge label and visual tone. */ function status(text,tone='amber'){$('feed-status').textContent=text;$('feed-status').className=`badge ${tone}`;}
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
  /** Align interval states and opening/closing benchmarks to the displayed hour. */ function syncMarkets(now,force=false) {
    const state=[];model.paused=paused;model.now=now;const minute=Math.floor(now/60000);
    if(candles!==volatilityCandles||minute!==volatilityMinute){
      model.volatility=model.minuteVolatility(candles,now);volatilityCandles=candles;volatilityMinute=minute;
    }
    model.hour=`${coin.symbol}:${mode}:${new Date(hour).toISOString()}`;
    model.markets.forEach(m=>{
      const index=Number(m.id.split('-')[1]),start=hour+index*m.minutes*60000,end=start+m.minutes*60000;
      const opening=candles.find(c=>c[0]*1000===start-60000),closing=candles.find(c=>c[0]*1000===end-60000);
      const marketStatus=now>=end?'settled':now>=start?'open':'queued';
      const strike=marketStatus==='queued'?null:opening?Number(opening[4]):null;
      const close=marketStatus==='settled'&&closing?Number(closing[4]):null;
      const changed=m.status!==marketStatus||m.strike!==strike||m.close!==close||m.start!==time(start);
      Object.assign(m,{start:time(start),end:time(end),status:marketStatus,strike,close,startsAt:start,endsAt:end,remaining:remaining(end-now)});
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
    renderBannerPrice();
    if(Date.now()-lastPriceBroadcast>=PRICE_UPDATE_MS){lastPriceBroadcast=Date.now();broadcast('btc-price-update');}
  }
  /** Calculate an illustrative synthetic price; these values cannot execute orders. */ function demoPrice(minute,second=0){return coin.demoBase*(1+(minute*1.5+Math.sin(minute*.48)*19+Math.sin(minute*1.8)*4+Math.sin(second*.5)*1.4)/67450);}
  /** Populate the synthetic preview hour with deterministic chart points. */ function demoHistory(now) {
    candles=[];
    for(let minute=-1;minute<60;minute++) {
      const t=hour+minute*60000;
      if(t>now)break;
      const price=demoPrice(minute);
      candles.push([t/1000,price-4,price+4,price-1,price,1]);
    }
    points=candles.filter(c=>c[0]*1000>=hour&&c[0]*1000+60000<=now).map(c=>({t:c[0]*1000+60000,price:c[4]}));
    syncMarkets(now,true);
  }
  /** Load exact minute benchmarks and volatility history, discarding responses for superseded hours or instruments. */ async function loadHistory() {
    if(mode!=='live'||stopped)return;
    if(fetchController)fetchController.abort();
    historyFailed=false;model.historyStatus='loading';model.pricingHistoryStatus='loading';
    const controller=new AbortController();fetchController=controller;
    const version=++historyVersion,requestedHour=hour,requestedCoin=coin.symbol;
    const timeout=setTimeout(()=>controller.abort(),60000);
    try {
      const params=new URLSearchParams({granularity:'60',start:new Date(hour-60000).toISOString(),end:new Date(Math.min(Date.now(),hour+3600000)).toISOString()});
      const historyUrl=serverFeed()?`/api/candles?coin=${encodeURIComponent(coin.symbol)}&start=${Math.floor((hour-60000)/1000)}&end=${Math.floor(Math.min(Date.now(),hour+3600000)/1000)}`:`https://api.exchange.coinbase.com/products/${coin.product}/candles?${params}`;
      const response=await fetch(historyUrl,{signal:controller.signal});
      if(!response.ok)throw new Error('History unavailable');
      const chartData=await response.json();
      const /** Prevent a stale asynchronous history response from replacing a newer instrument or hour. */ isCurrentRequest=()=>mode==='live'&&version===historyVersion&&requestedHour===hour&&requestedCoin===coin.symbol;
      if(!isCurrentRequest())return;
      if(!Array.isArray(chartData))throw new Error('Invalid chart history');
      /** Apply validated history only to the request context that remains current. */ function applyHistory(data){
        const displayEnd=Math.min(Date.now(),hour+3600000);
        candles=[...new Map(data.filter(c=>Array.isArray(c)&&c.length>=5&&c.slice(0,5).every(Number.isFinite)&&c[4]>0&&c[0]*1000>=displayEnd-86400000&&c[0]*1000<displayEnd).map(c=>[c[0],c])).values()].sort((a,b)=>a[0]-b[0]);
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
    if(Date.now()-lastSpotPollAt<5000)return;
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
  /** Render sixty minute direction cells from exact candle opens and closes. */
  function renderMinuteHeatmap(displayTime){
    const map=$('minute-heatmap'),currentMinute=Math.max(0,Math.min(59,Math.floor((displayTime-hour)/60000)));
    const minuteCandles=new Map(candles.filter(c=>c[0]*1000>=hour&&c[0]*1000<hour+3600000).map(c=>[Math.floor((c[0]*1000-hour)/60000),c]));
    const moves=[...minuteCandles.values()].map(c=>Math.abs((Number(c[4])-Number(c[3]))/Number(c[3]))).filter(Number.isFinite);
    const scale=Math.max(...moves,0.000001);
    const dots=Array.from({length:60},(_,minute)=>{
      const dot=document.createElement('span'),candle=minuteCandles.get(minute),start=hour+minute*60000;
      dot.className='minute-dot';
      dot.style.left=`${(minute+1)/60*100}%`;
      if(candle&&start+60000<=displayTime){
        const open=Number(candle[3]),close=Number(candle[4]),move=(close-open)/open,direction=move>=0?'up':'down';
        const heat=Math.max(.15,Math.min(1,Math.abs(move)/scale));
        dot.className+=` ${direction}`;dot.style.setProperty('--heat-glow',`${2+heat*5}px`);dot.style.setProperty('--heat-opacity',String(.45+heat*.55));
        dot.title=`${time(start)}–${time(start+60000)} UTC · ${direction==='up'?'Up':'Down'} ${Math.abs(move*100).toFixed(3)}%`;
        dot.setAttribute('aria-label',dot.title);
      }else if(!historical&&minute===currentMinute){
        dot.className+=' current';dot.title=`${time(start)} UTC · Current minute`;dot.setAttribute('aria-label',dot.title);
      }else{
        dot.title=`${time(start)} UTC · ${start>=displayTime?'Upcoming':'No minute data'}`;dot.setAttribute('aria-label',dot.title);
      }
      return dot;
    });
    map.replaceChildren(...dots);
    const up=dots.filter(dot=>dot.className.includes(' up')).length,down=dots.filter(dot=>dot.className.includes(' down')).length;
    map.setAttribute('aria-label',`Minute-by-minute direction for this hour: ${up} up, ${down} down, ${60-up-down} pending or unavailable`);
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
  /** Interpolate samples with bounded cubic tangents, preserving prices and local extrema. */
  function smoothPath(samples){
    if(!samples.length)return '';
    const slopes=samples.slice(1).map((point,index)=>{
      const previous=samples[index],width=point.x-previous.x;
      return width>0?(point.y-previous.y)/width:0;
    });
    const tangents=samples.map((point,index)=>{
      if(index===0)return slopes[0]||0;
      if(index===samples.length-1)return slopes[index-1]||0;
      const before=slopes[index-1],after=slopes[index];
      return before*after>0?Math.sign(before)*Math.min(Math.abs(before),Math.abs(after)):0;
    });
    let path=`M${samples[0].x.toFixed(3)},${samples[0].y.toFixed(3)}`;
    for(let index=1;index<samples.length;index++){
      const previous=samples[index-1],point=samples[index],third=(point.x-previous.x)/3;
      path+=` C${(previous.x+third).toFixed(3)},${(previous.y+third*tangents[index-1]).toFixed(3)} ${(point.x-third).toFixed(3)},${(point.y-third*tangents[index]).toFixed(3)} ${point.x.toFixed(3)},${point.y.toFixed(3)}`;
    }
    return path;
  }
  /** Project valid price points into SVG coordinates and update chart and benchmark labels. */ function draw(now,force=false) {
    const displayTime=historical?hour+3600000:now;
    $('time-cursor').hidden=historical;
    $('next-hour').disabled=!historical;$('current-hour').hidden=!historical;$('chart-pause').disabled=historical;
    $('hour-date').textContent=`${new Date(hour).toISOString().slice(0,10)} · UTC`;
    $('price-context').textContent=coin.feed==='oilpriceapi'?'SPOT ASSESSMENT · USD / BARREL':historical?'HOUR CLOSE':mode==='demo'?'SYNTHETIC PREVIEW':simulated()?'SIMULATED · USD / BARREL':coin.feed==='twelvedata'?'LIVE SPOT · USD / BARREL':'LIVE SPOT';
    $('market-heading').textContent=historical?'Settlement history · results':'Choose your market';
    const fraction=Math.max(0,Math.min(1,(now-hour)/3600000));
    const stack=$('timeline-stack'),chart=$('btc-chart'),bounds=chart.getBoundingClientRect(),stackBounds=stack.getBoundingClientRect();
    // Pixel geometry keeps one vertical line aligned on every duration row.
    stack.style.setProperty('--cursor-x',`${bounds.left-stackBounds.left+fraction*bounds.width}px`);
    $('time-cursor-label').textContent=clock(now);
    const wallTime=Date.now();
    $('workspace-clock').textContent=`${clock(wallTime)} UTC`;
    $('workspace-local-clock').textContent=localClock.format(wallTime);
    $('workspace-local-clock').title=`Local time · ${localTimezone}`;
    $('hour-window-label').textContent=`${time(hour)} — ${time(hour+3600000)}`;
    if($('chart-times').dataset.hour!==String(hour)){$('chart-times').dataset.hour=String(hour);$('chart-times').replaceChildren(...[0,15,30,45,60].map(minute=>{const span=document.createElement('span');span.textContent=time(hour+minute*60000);return span;}));}
    renderBannerPrice();
    const plotTime=Date.now();
    if(!force&&plotTime-lastPlotAt<5000)return;
    lastPlotAt=plotTime;
    const valid=points.filter(p=>p.t>=hour&&p.t<=displayTime);
    const hasPoints=valid.length>0;
    renderMinuteHeatmap(displayTime);
    renderSegmentResults(displayTime);
    $('chart-empty').hidden=hasPoints;
    $('chart-empty').textContent=historical?(historyFailed?'Data Not Available for this hour.':'Loading the selected hour…'):model.spotStatus==='unavailable'?'Data Not Available · retrying automatically…':coin.feed==='oilpriceapi'&&mode==='live'?'Checking latest spot assessment every 5 seconds…':mode==='demo'?'Starting synthetic preview…':lastPriceAt?'Waiting for history…':`Loading ${coin.symbol}/USD prices…`;
    const opening=candles.find(c=>c[0]*1000===hour-60000)?.[4];
    const change=(historical||model.spotStatus==='ready')&&Number.isFinite(lastPrice)&&Number.isFinite(opening)?lastPrice-opening:null;
    $('btc-change').textContent=change===null?(model.spotStatus==='unavailable'?'Retrying price feed…':'Waiting for price data'):`${change>=0?'+':'−'}${money(Math.abs(change))} ${historical?'that hour':'this hour'}`;
    $('btc-change').style.color=change!==null&&change<0?'var(--red)':'var(--green)';
    if(!hasPoints){$('btc-line').removeAttribute('d');$('btc-area').removeAttribute('d');$('btc-tip').setAttribute('visibility','hidden');return;}
    let low=Math.min(...valid.map(p=>p.price)),high=Math.max(...valid.map(p=>p.price));
    const pad=Math.max(coin.demoBase*.00012,(high-low)*.18);low-=pad;high+=pad;
    const /** Project a timestamp into the chart horizontal coordinate. */ x=t=>(t-hour)/3600000*1000,/** Project a price into the chart vertical coordinate. */ y=p=>116-(p-low)/(high-low)*102;
    const path=smoothPath(valid.map(p=>({x:x(p.t),y:y(p.price)}))),first=valid[0],last=valid.at(-1);
    $('btc-line').setAttribute('d',path);
    $('btc-area').setAttribute('d',`${path} L${x(last.t)},130 L${x(first.t)},130 Z`);
    $('btc-tip').setAttribute('cx',x(last.t));$('btc-tip').setAttribute('cy',y(last.price));$('btc-tip').setAttribute('visibility','visible');
    $('chart-description').textContent=historical?`${coin.name} historical price from ${time(hour)} to ${time(hour+3600000)} UTC on ${new Date(hour).toISOString().slice(0,10)}. Last available price ${money(last.price)}. Outcomes are settlement proxies.`:`${mode==='demo'?'Simulated':coin.feed==='oilpriceapi'?'Polled spot assessment (observation times, not market ticks)':sourceLabel()} ${coin.symbol}/USD hourly price. Latest ${money(last.price)}. Red dashed cursor at ${clock(now)} UTC.`;
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
        if(serverFeed()||Date.now()-model.priceUpdatedAt>=5000)pollSpot();
        if(coin.feed!=='oilpriceapi'&&lastPriceAt&&!hasFreshQuote()){unavailableSpot();if(socket){socket.close();}}
        if(socket&&Date.now()-connectionStartedAt>20000&&(!lastPriceAt||socket.readyState===WebSocket.CONNECTING))socket.close();
        if(!fetchController&&Date.now()-lastHistoryAt>60000){lastHistoryAt=Date.now();loadHistory();}
      }
      syncMarkets(now);if(!paused)draw(now);else status('PAUSED','neutral');
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
    $('price-coin-icon').hidden=!coin.icon;$('price-coin-icon').onerror=/** Handle the error event for the current transport or resource. */ ()=>{$('price-coin-icon').hidden=true;};if(coin.icon)$('price-coin-icon').src=coin.icon;$('price-coin-icon').alt=`${coin.name} logo`;
    $('coin-name').textContent=coin.name.toUpperCase();
    $('market-pair-label').textContent=`${coin.symbol} / USD · PREDICTION MARKETS`;
    $('chart-pair-label').textContent=`${coin.symbol} / USD · 1H`;
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
  $('previous-hour').addEventListener('click',()=>navigateHour(hour-3600000));
  $('next-hour').addEventListener('click',()=>navigateHour(hour+3600000));
  $('current-hour').addEventListener('click',()=>navigateHour(hourOf(currentTime())));
  document.querySelectorAll('[data-coin]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.coin!==coin.symbol)selectCoin(button.dataset.coin);}));
  let savedCoin=window.PredictCoins.available[0].symbol;try{const preference=localStorage.getItem(`predict_selected_coin_${window.Predict60Category?.id||'crypto'}`)||localStorage.getItem('predict_selected_coin');if(window.PredictCoins.available.some(coin=>coin.symbol===preference))savedCoin=preference;}catch{}
  selectCoin(savedCoin);frameId=setTimeout(()=>frame(performance.now()),1000);
})();
