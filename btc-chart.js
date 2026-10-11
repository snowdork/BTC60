/* Public Coinbase spot visualization. Contract quotes and benchmarks are demos. */
(() => {
  'use strict';
  const model=window.RolrModel,$=id=>document.getElementById(id);
  const money=v=>v.toLocaleString('en-US',{style:'currency',currency:'USD'});
  const hourOf=t=>Math.floor(t/3600000)*3600000;
  const time=t=>new Date(t).toISOString().slice(11,16);
  const clock=t=>new Date(t).toISOString().slice(11,19);
  const remaining=ms=>`${Math.max(0,Math.floor(ms/60000))}m ${String(Math.max(0,Math.floor(ms/1000)%60)).padStart(2,'0')}s`;
  let mode='live',paused=false,socket=null,retryTimer=null,fetchController=null,historyVersion=0;
  let hour=hourOf(Date.now()),points=[],candles=[],lastPriceAt=0,lastPrice=null,lastHistoryAt=0,backoff=1000;
  let demoEpoch=Date.now(),demoStart=new Date().setUTCHours(17,42,12,0),demoSecond=-1,lastDraw=0;
  let frameId=0,stopped=false,connectionStartedAt=0;
  const currentTime=()=>mode==='demo'?demoStart+Date.now()-demoEpoch:Date.now();
  function status(text,tone='amber'){$('feed-status').textContent=text;$('feed-status').className=`badge ${tone}`;}
  function broadcast(name){window.dispatchEvent(new Event(name));}
  function syncMarkets(now,force=false) {
    const state=[];
    model.hour=`${mode}:${new Date(hour).toISOString()}`;
    model.markets.forEach(m=>{
      const index=Number(m.id.split('-')[1]),start=hour+index*m.minutes*60000,end=start+m.minutes*60000;
      const opening=candles.find(c=>c[0]*1000===start-60000),closing=candles.find(c=>c[0]*1000===end-60000);
      const marketStatus=now>=end?'settled':now>=start?'open':'queued';
      const strike=marketStatus==='queued'?null:opening?Number(opening[4]):null;
      const close=marketStatus==='settled'&&closing?Number(closing[4]):null;
      const changed=m.status!==marketStatus||m.strike!==strike||m.close!==close||m.start!==time(start);
      Object.assign(m,{start:time(start),end:time(end),status:marketStatus,strike,close,remaining:remaining(end-now)});
      if(m.up===null)m.up=50;
      state.push(changed);
      const label=document.querySelector(`[data-remaining="${m.id}"]`);if(label)label.textContent=m.remaining;
    });
    if(force||state.some(Boolean))broadcast('btc-market-update');
  }
  function appendPoint(t,price) {
    if(t<hour||t>hour+3600000||!Number.isFinite(price)||price<=0)return;
    // One plotted point per second bounds the in-memory series to one hour.
    const bucket=Math.floor(t/1000)*1000,last=points.at(-1);
    if(last&&Math.floor(last.t/1000)*1000===bucket)last.price=price;
    else {points.push({t,price});points.sort((a,b)=>a.t-b.t);}
    if(points.length>3662)points.splice(0,points.length-3662);
    lastPrice=price;lastPriceAt=Date.now();model.spot=price;
    broadcast('btc-price-update');
  }
  function demoHistory(now) {
    candles=[];
    for(let minute=-1;minute<60;minute++) {
      const t=hour+minute*60000;
      if(t>now)break;
      const price=67450+minute*1.5+Math.sin(minute*.48)*19+Math.sin(minute*1.8)*4;
      candles.push([t/1000,price-4,price+4,price-1,price,1]);
    }
    points=candles.filter(c=>c[0]*1000>=hour&&c[0]*1000+60000<=now).map(c=>({t:c[0]*1000+60000,price:c[4]}));
    syncMarkets(now,true);
  }
  async function loadHistory() {
    if(mode!=='live'||stopped)return;
    if(fetchController)fetchController.abort();
    const controller=new AbortController();fetchController=controller;
    const version=++historyVersion,requestedHour=hour;
    const timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const params=new URLSearchParams({granularity:'60',start:new Date(hour-60000).toISOString(),end:new Date(Date.now()).toISOString()});
      const response=await fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?${params}`,{signal:controller.signal});
      if(!response.ok)throw new Error('History unavailable');
      const data=await response.json();
      if(mode!=='live'||version!==historyVersion||requestedHour!==hour)return;
      if(!Array.isArray(data))throw new Error('Invalid history');
      candles=data.filter(c=>Array.isArray(c)&&c.length>=5&&c.slice(0,5).every(Number.isFinite)&&c[4]>0&&c[0]*1000>=hour-60000&&c[0]*1000<=Date.now()).sort((a,b)=>a[0]-b[0]);
      const history=candles.filter(c=>c[0]*1000>=hour&&c[0]*1000+60000<=Date.now()).map(c=>({t:c[0]*1000+60000,price:c[4]}));
      // Keep streaming points received while history was loading.
      const cutoff=history.at(-1)?.t??hour;
      points=[...history,...points.filter(p=>p.t>cutoff)];lastHistoryAt=Date.now();
      syncMarkets(Date.now(),true);
    } catch(error) {
      if(mode==='live'&&version===historyVersion){$('chart-source').textContent='History unavailable · reconnect or preview demo';}
    } finally {clearTimeout(timeout);if(fetchController===controller)fetchController=null;}
  }
  function disconnect() {
    clearTimeout(retryTimer);retryTimer=null;
    if(socket){const old=socket;socket=null;old.onclose=null;old.close();}
    if(fetchController){fetchController.abort();fetchController=null;}
    historyVersion++;
  }
  function connect() {
    if(mode!=='live'||stopped)return;
    status(lastPriceAt?'RECONNECTING':'CONNECTING');
    connectionStartedAt=Date.now();
    try {socket=new WebSocket('wss://ws-feed.exchange.coinbase.com');}catch{scheduleRetry();return;}
    const active=socket;
    active.onopen=()=>{if(socket!==active)return;active.send(JSON.stringify({type:'subscribe',product_ids:['BTC-USD'],channels:['ticker']}));};
    active.onmessage=event=>{
      if(socket!==active||mode!=='live')return;
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(data.type!=='ticker'||data.product_id!=='BTC-USD')return;
      const price=Number(data.price),t=Date.parse(data.time);
      if(!Number.isFinite(price)||price<=0||!Number.isFinite(t)||Date.now()-t>15000||t>Date.now()+5000)return;
      if(hourOf(Date.now())!==hour)resetHour(Date.now());
      appendPoint(t,price);backoff=1000;if(!paused)status('LIVE','green');
    };
    active.onerror=()=>{if(socket===active)active.close();};
    active.onclose=()=>{if(socket!==active)return;socket=null;scheduleRetry();};
  }
  function scheduleRetry() {
    if(mode!=='live'||stopped)return;
    status('DISCONNECTED');clearTimeout(retryTimer);retryTimer=setTimeout(connect,backoff);backoff=Math.min(30000,backoff*2);
  }
  function resetHour(now) {
    hour=hourOf(now);points=[];candles=[];lastPrice=null;lastPriceAt=0;model.spot=NaN;
    syncMarkets(now,true);if(mode==='demo')demoHistory(now);else loadHistory();
  }
  function setMode(next) {
    disconnect();mode=next;paused=false;lastHistoryAt=0;backoff=1000;demoEpoch=Date.now();demoSecond=-1;
    $('demo-preview').textContent=mode==='demo'?'Live BTC':'Demo preview';
    $('chart-pause').textContent='Pause';$('chart-pause').setAttribute('aria-pressed','false');
    $('clock-label').textContent=mode==='demo'?'Simulated UTC':'UTC';
    resetHour(currentTime());
    if(mode==='demo'){status('SIMULATED','amber');$('chart-source').textContent='Animated demo · no live feed';}
    else{$('chart-source').textContent='Coinbase spot · demo contracts';connect();}
    draw(currentTime());
  }
  function draw(now) {
    const fraction=Math.max(0,Math.min(1,(now-hour)/3600000));
    const stack=$('timeline-stack'),chart=$('btc-chart'),bounds=chart.getBoundingClientRect(),stackBounds=stack.getBoundingClientRect();
    // Pixel geometry keeps one vertical line aligned on every duration row.
    stack.style.setProperty('--cursor-x',`${bounds.left-stackBounds.left+fraction*bounds.width}px`);
    $('time-cursor-label').textContent=clock(now);
    $('workspace-clock').textContent=`${clock(now)} UTC`;
    $('hour-window-label').textContent=`${time(hour)} — ${time(hour+3600000)}`;
    $('hour-remaining').textContent=`${remaining(hour+3600000-now)} remaining${mode==='demo'?' · demo':''}`;
    $('chart-times').replaceChildren(...[0,15,30,45,60].map(minute=>{const span=document.createElement('span');span.textContent=time(hour+minute*60000);return span;}));
    const valid=points.filter(p=>p.t>=hour&&p.t<=now);
    const hasPoints=valid.length>0;
    $('chart-empty').hidden=hasPoints;
    $('chart-empty').textContent=mode==='demo'?'Starting demo…':lastPriceAt?'Waiting for history…':'Waiting for live BTC/USD · use Demo preview if unavailable';
    $('btc-spot').textContent=Number.isFinite(lastPrice)?money(lastPrice):'—';
    const opening=candles.find(c=>c[0]*1000===hour-60000)?.[4];
    const change=Number.isFinite(lastPrice)&&Number.isFinite(opening)?lastPrice-opening:null;
    $('btc-change').textContent=change===null?'Waiting for price data':`${change>=0?'+':'−'}${money(Math.abs(change))} this hour`;
    $('btc-change').style.color=change!==null&&change<0?'var(--red)':'var(--green)';
    if(!hasPoints){$('btc-line').removeAttribute('d');$('btc-area').removeAttribute('d');$('btc-tip').setAttribute('visibility','hidden');$('chart-price-tag').hidden=true;return;}
    let low=Math.min(...valid.map(p=>p.price)),high=Math.max(...valid.map(p=>p.price));
    const pad=Math.max(8,(high-low)*.18);low-=pad;high+=pad;
    const x=t=>(t-hour)/3600000*1000,y=p=>116-(p-low)/(high-low)*102;
    const path=valid.map((p,i)=>`${i?'L':'M'}${x(p.t).toFixed(3)},${y(p.price).toFixed(3)}`).join(' '),first=valid[0],last=valid.at(-1);
    $('btc-line').setAttribute('d',path);
    $('btc-area').setAttribute('d',`${path} L${x(last.t)},130 L${x(first.t)},130 Z`);
    $('btc-tip').setAttribute('cx',x(last.t));$('btc-tip').setAttribute('cy',y(last.price));$('btc-tip').setAttribute('visibility','visible');
    $('chart-price-high').textContent=money(high);$('chart-price-low').textContent=money(low);
    const tag=$('chart-price-tag');tag.hidden=false;tag.textContent=money(last.price);tag.style.left=`${Math.min(90,Math.max(10,x(last.t)/10))}%`;tag.style.top=`${Math.max(10,y(last.price)/130*100)}%`;
    $('chart-description').textContent=`${mode==='demo'?'Simulated':'Coinbase'} BTC/USD hourly price. Latest ${money(last.price)}. Red dashed cursor at ${clock(now)} UTC.`;
  }
  function frame(stamp) {
    if(stopped)return;
    if(!document.hidden&&stamp-lastDraw>=250){
      lastDraw=stamp;const now=currentTime();
      if(hourOf(now)!==hour)resetHour(now);
      if(mode==='demo'){
        const second=Math.floor(now/1000);
        if(second!==demoSecond){demoSecond=second;const minute=(now-hour)/60000;appendPoint(now,67450+minute*1.5+Math.sin(minute*.48)*19+Math.sin(minute*1.8)*4+Math.sin(second*.5)*1.4);}
        status('SIMULATED','amber');
      } else {
        if(lastPriceAt&&Date.now()-lastPriceAt>15000){status('STALE');if(socket){socket.close();}}
        if(!lastPriceAt&&stamp>15000)status('DISCONNECTED');
        if(socket&&Date.now()-connectionStartedAt>20000&&(!lastPriceAt||socket.readyState===WebSocket.CONNECTING))socket.close();
        if(!fetchController&&Date.now()-lastHistoryAt>60000){lastHistoryAt=Date.now();loadHistory();}
      }
      syncMarkets(now);if(!paused)draw(now);else status('PAUSED','neutral');
    }
    frameId=requestAnimationFrame(frame);
  }
  $('demo-preview').addEventListener('click',()=>setMode(mode==='live'?'demo':'live'));
  $('feed-retry').addEventListener('click',()=>setMode('live'));
  $('chart-pause').addEventListener('click',()=>{
    paused=!paused;$('chart-pause').textContent=paused?'Resume':'Pause';$('chart-pause').setAttribute('aria-pressed',String(paused));
    if(paused)status('PAUSED','neutral');else {status(mode==='demo'?'SIMULATED':Date.now()-lastPriceAt<15000?'LIVE':'STALE',mode==='demo'?'amber':Date.now()-lastPriceAt<15000?'green':'amber');syncMarkets(currentTime());draw(currentTime());}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!paused){const now=currentTime();if(hourOf(now)!==hour)resetHour(now);syncMarkets(now,true);draw(now);if(mode==='live')loadHistory();}});
  window.addEventListener('pagehide',()=>{stopped=true;disconnect();cancelAnimationFrame(frameId);});
  setMode('live');frameId=requestAnimationFrame(frame);
})();
