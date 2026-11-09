const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function chartHarness({oil=false,live=false,spotError=false,historyError=false,transformCandles=c=>c,quote=({now})=>({price:'108.00',time:new Date(now).toISOString()}),startTime=Date.UTC(2026,9,12,17,25,30)}={}){
 let now=startTime;
 const elements=new Map(),hour=Math.floor(now/3600000)*3600000;
 function element(id){
  if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,dataset:{},style:{setProperty(){}},classList:{},listeners:{},
   addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},
   getBoundingClientRect(){return {left:0,width:1000};},replaceChildren(...children){this.children=children;}});
  return elements.get(id);
 }
 const coin={symbol:oil?'WTI':'BTC',name:oil?'West Texas Intermediate':'Bitcoin',product:oil?'SIM-WTI':'BTC-USD',icon:'btc.svg',demoBase:100,category:oil?'oil':'crypto',feed:oil?(live?'twelvedata':'simulated'):'coinbase',maxPriceAgeMs:live?90000:15000};
 const coins=oil?[coin]:[coin,{...coin,symbol:'ETH',name:'Ethereum',product:'ETH-USD'}];
 const buttons=coins.map(c=>{const button=element(`coin-${c.symbol}`);button.dataset.coin=c.symbol;return button;});
 const model={...require('../../src/frontend/market-model.js'),markets:require('../../src/frontend/market-model.js').markets.map(m=>({...m})),coin};
 const pending=[],timers=[],requests=[],events={};let socket;
 let frameStamp=0;
 const fetch=async (url,options)=>{
  requests.push(url);
  if(url.endsWith('/ticker'))return {ok:true,json:async()=>quote({url,now,signal:options.signal})};
  if(url.startsWith('/api/spot'))return spotError?{ok:false,json:async()=>({error:'Oil feed needs a Twelve Data API key on the server.'})}:{ok:true,json:async()=>({price:110.25,time:live?now-30000:now,source:live?'Twelve Data':'oil-simulation-v1'})};
  if(oil&&url.startsWith('/api/pricing-history'))return {ok:true,json:async()=>({candles:Array.from({length:90},(_,i)=>[(hour/1000)-5400+i*60,99,102,100,100+i*.01,0])})};
  if(url.startsWith('/api/pricing-history'))return new Promise(resolve=>pending.push(resolve));
  if(historyError)throw new TypeError('Browser provider request failed');
  const query=new URL(url,'http://localhost').searchParams;
  const start=oil?Number(query.get('start'))*1000:Date.parse(query.get('start'));
  const end=oil?Number(query.get('end'))*1000:Date.parse(query.get('end'));
  const candles=[];
  for(let t=start;t<end;t+=60000) candles.push([t/1000,99,120,100,100+(t-hour+60000)/600000,1]);
  return {ok:true,json:async()=>transformCandles(candles)};
 };
 class FakeDate extends Date{static now(){return now;}}
 class Socket{constructor(){this.readyState=1;socket=this;}close(){}send(){}}
 const window={PredictModel:model,PredictCoins:{available:coins,getCoin:symbol=>coins.find(c=>c.symbol===symbol)||coin,formatPrice:v=>'$'+v.toFixed(2)},dispatchEvent(){},addEventListener:(name,fn)=>{events[name]=fn;}};
 const context={window,document:{getElementById:element,querySelector:s=>s.startsWith('[data-remaining')?null:element(s),querySelectorAll:s=>s==='[data-coin]'?buttons:[],addEventListener(){},createElement:()=>({dataset:{},style:{setProperty(){}},setAttribute(k,v){this[k]=v;}})},Date:FakeDate,Intl,URLSearchParams,fetch,AbortController,WebSocket:Socket,Event:class{},localStorage:{getItem(){return null;},setItem(){}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},performance:{now:()=>frameStamp},console};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/btc-chart.js'),'utf8'),context);
 return {element,pending,model,hour,requests,events,select(symbol){element(`coin-${symbol}`).listeners.click();},step(){now+=1000;frameStamp+=1000;timers.at(-1)();},tick(price,elapsed=0){now+=elapsed;frameStamp+=Math.max(1000,elapsed);socket.onmessage({data:JSON.stringify({type:'ticker',product_id:model.coin.product,price:String(price),time:new Date(now).toISOString()})});timers.at(-1)();}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('second-by-second prices survive history refreshes, coin switches and hour rollover',async()=>{
 const h=chartHarness({quote:({url,now})=>({price:url.includes('ETH-USD')?'208':'108',time:new Date(now).toISOString()})});
 await flush();h.tick(110,1000);h.tick(111,1000);
 const btc=h.model.secondPoints;
 assert(btc.some(p=>p.price===110));assert(btc.some(p=>p.price===111));
 h.pending.shift()({ok:true,json:async()=>({candles:[]})});await flush();
 assert.equal(h.model.secondPoints,btc,'minute history does not replace the observed trail');
 assert(btc.some(p=>p.price===110));
 h.select('ETH');await flush();h.tick(222,1000);
 assert.notEqual(h.model.secondPoints,btc);
 assert(h.model.secondPoints.every(p=>p.price>=200),'coin trails do not mix');
 h.select('BTC');await flush();
 assert.equal(h.model.secondPoints,btc);assert(btc.some(p=>p.price===110));
 h.tick(112,3600000);
 assert.equal(h.model.secondPoints,btc,'hour rollover keeps recent observations');
 assert(btc.some(p=>p.price===110));assert(btc.some(p=>p.price===112));
});

test('live price, chart and clock refresh on each one-second tick',async()=>{
 const h=chartHarness();await flush();
 let previousPath=h.element('btc-line').d,previousClock=h.element('workspace-clock').textContent;
 for(const price of [110.25,111.75]){
  h.tick(price,1000);
  assert.equal(h.element('btc-spot').children[0],'$'+Math.floor(price)+'.');
  assert.notEqual(h.element('btc-line').d,previousPath);
  assert.notEqual(h.element('workspace-clock').textContent,previousClock);
  assert.equal(h.model.now,h.model.priceUpdatedAt);
  previousPath=h.element('btc-line').d;previousClock=h.element('workspace-clock').textContent;
 }
});

test('chart history falls back to the server when the browser cannot reach the provider',async()=>{
 const h=chartHarness({historyError:true});await flush();
 assert.equal(h.pending.length,1);
 h.pending.shift()({ok:true,json:async()=>({candles:Array.from({length:90},(_,i)=>[h.hour/1000-3900+i*60,99,120,100,105,1])})});
 await flush();
 assert.equal(h.model.historyStatus,'ready');
 assert(h.model.candles.length>0);
 assert.match(h.element('btc-line').d,/^M/);
 // Resolve the independent longer pricing refresh as well.
 h.pending.shift()?.({ok:false});await flush();
});

test('returning through the browser page cache restarts live quotes and the chart clock',async()=>{
 let price=108;
 const h=chartHarness({quote:({now})=>({price:String(price),time:new Date(now).toISOString()})});await flush();
 const calls=h.requests.length;
 h.events.pageshow({persisted:false});await flush();assert.equal(h.requests.length,calls);
 h.events.pagehide();price=123;
 h.events.pageshow({persisted:true});await flush();
 assert.equal(h.model.spot,123);
 const refreshed=h.requests.length;
 h.events.pageshow({persisted:true});await flush();assert.equal(h.requests.length,refreshed);
 const clock=h.element('workspace-clock').textContent;
 h.step();assert.notEqual(h.element('workspace-clock').textContent,clock);
});

test('initial selection loads a validated price without waiting for a WebSocket trade',async()=>{
 const h=chartHarness();
 assert.equal(h.element('btc-spot').textContent,'Loading…');
 await flush();
 assert.equal(h.model.spot,108);
 assert.equal(h.model.spotStatus,'ready');
 assert.equal(h.model.feedConnection,'connected');
 assert.equal(h.element('btc-spot').children[0],'$108.');
 assert.equal(h.element('feed-message').hidden,true);
 assert(h.requests.some(url=>url.endsWith('/BTC-USD/ticker')));
 assert.equal(h.model.pricingHistoryStatus,'loading','a current quote does not substitute for missing odds history');
});

test('one click on a different coin loads its own price without refreshing',async()=>{
 const h=chartHarness({quote:({url,now})=>({price:url.includes('ETH-USD')?'2500.50':'108.00',time:new Date(now).toISOString()})});await flush();
 h.select('ETH');
 assert.equal(h.element('btc-spot').textContent,'Loading…');
 assert(!Number.isFinite(h.model.spot),'the previous coin price is cleared immediately');
 await flush();
 assert.equal(h.model.coin.symbol,'ETH');
 assert.equal(h.model.spot,2500.5);
 assert.equal(h.element('btc-spot').children[0],'$2500.');
 assert.equal(h.element('btc-spot').children[1].dataset.trend,'');
});

test('late quote responses cannot overwrite a newly selected coin',async()=>{
 let finishOld,oldSignal;
 const h=chartHarness({quote:({url,now,signal})=>url.includes('BTC-USD')?new Promise(resolve=>{finishOld=resolve;oldSignal=signal;}):({price:'2500',time:new Date(now).toISOString()})});await flush();
 h.select('ETH');await flush();
 assert.equal(oldSignal.aborted,true);
 finishOld({price:'99999',time:new Date(h.hour+1530000).toISOString()});await flush();
 assert.equal(h.model.coin.symbol,'ETH');
 assert.equal(h.model.spot,2500);
});

test('an unavailable quote is labelled and retried automatically without a refresh',async()=>{
 let calls=0;
 const h=chartHarness({quote:({now})=>{if(++calls===1)throw Error('Network unavailable');return {price:'115',time:new Date(now).toISOString()};}});await flush();
 assert.equal(h.element('btc-spot').textContent,'Data Not Available');
 assert.equal(h.element('btc-spot').dataset.state,'unavailable');
 assert.match(h.element('feed-message').textContent,/Retrying automatically/);
 assert.equal(h.model.feedConnection,'disconnected');
 assert(!Number.isFinite(h.model.spot));
 assert.match(h.element('btc-line').d,/^M/,'available history remains visible');
 for(let i=0;i<5;i++)h.step();await flush();
 assert.equal(calls,2);
 assert.equal(h.model.spot,115);
 assert.equal(h.model.feedConnection,'connected');
 assert.equal(h.element('feed-message').hidden,true);
 assert.equal(h.element('btc-spot').dataset.state,'ready');
});

test('invalid and stale provider quotes never become current prices',async()=>{
 for(const invalid of [null,{}, {price:'NaN'}, {price:'0'}, {price:'-1'}, {price:'100',age:16000}, {price:'100',age:-6000}]){
  const h=chartHarness({quote:({now})=>invalid&&({...invalid,time:new Date(now-(invalid.age||0)).toISOString()})});await flush();
  assert.equal(h.model.spotStatus,'unavailable');
  assert(!Number.isFinite(h.model.spot));
  assert.equal(h.element('btc-spot').textContent,'Data Not Available');
 }
});

test('a REST error cannot hide a newer valid live trade',async()=>{
 let failQuote;
 const h=chartHarness({quote:()=>new Promise((resolve,reject)=>{failQuote=reject;})});await flush();
 h.tick(120);
 failQuote(Error('Lookup failed'));await flush();
 assert.equal(h.model.spot,120);
 assert.equal(h.model.spotStatus,'ready');
 assert.equal(h.model.feedConnection,'connected');
 assert.equal(h.element('feed-message').hidden,true);
});

test('an older REST quote cannot replace a newer live trade',async()=>{
 let finishQuote;
 const h=chartHarness({quote:()=>new Promise(resolve=>{finishQuote=resolve;})});await flush();
 h.tick(120);
 finishQuote({price:'119',time:new Date(h.hour+1529000).toISOString()});await flush();
 assert.equal(h.model.spot,120);
});

test('an expired price is replaced by unavailable until a fresh quote arrives',async()=>{
 let available=true;
 const h=chartHarness({quote:({now})=>{if(!available)throw Error('Feed offline');return {price:'108',time:new Date(now).toISOString()};}});await flush();
 available=false;
 for(let i=0;i<16;i++){h.step();await flush();}
 assert.equal(h.element('btc-spot').textContent,'Data Not Available');
 assert.equal(h.model.feedConnection,'disconnected');
 assert.equal(h.model.dataStatus(h.model,h.model.markets[0]).ready,false);
 h.tick(125);
 assert.equal(h.model.spot,125);
 assert.equal(h.element('btc-spot').dataset.state,'ready');
 assert.equal(h.element('feed-message').hidden,true);
});

test('a fresh quote before the hour holds the exact new-hour benchmark at the active playhead',async()=>{
 const h=chartHarness({startTime:Date.UTC(2026,9,12,18,0,1),quote:({now})=>({price:'120',time:new Date(now-2000).toISOString()})});await flush();
 assert.equal(h.model.spot,120);
 assert.equal(h.model.spotStatus,'ready');
 assert.equal(h.element('btc-spot').children[0],'$120.');
 assert.match(h.element('btc-line').d,/^M0\.000,65\.000 L0\.278,65\.000$/);
 assert.equal(h.model.priceUpdatedAt,h.hour-1000,'display projection does not change the provider timestamp');
});

test('initial current hour backfills to its start before pricing history completes',async()=>{
 const h=chartHarness();await flush();
 assert.equal(h.pending.length,1);
 assert.match(h.element('btc-line').d,/^M0\.000,/);
 assert.match(h.element('btc-line').d,/L416\.667,/);
 h.pending[0]({ok:false});await flush();
 assert.match(h.element('btc-line').d,/^M0\.000,/);
 assert.equal(h.model.historyStatus,'ready');
 assert.equal(h.model.pricingHistoryStatus,'error');
});

test('minute heat map renders sixty time-aligned candle directions',async()=>{
 const h=chartHarness();await flush();
 const map=h.element('minute-heatmap'),dots=map.children;
 assert.equal(dots.length,60);
 assert.equal(dots[14].style.left,'25%');
 assert.equal(dots[29].style.left,'50%');
 assert.equal(dots[44].style.left,'75%');
 assert.equal(dots[59].style.left,'100%');
 assert.equal(dots.filter(dot=>dot.className.includes(' up')).length,25);
 assert.equal(dots[25].className,'minute-dot current');
 assert.match(dots[0].title,/17:00–17:01 UTC · Up/);
 assert.match(map['aria-label'],/25 up, 0 down, 35 pending or unavailable/);
});

test('returning to current hour restores history and ignores old pricing responses',async()=>{
 const h=chartHarness();await flush();
 h.element('previous-hour').listeners.click();await flush();
 assert.equal(h.model.isHistorical,true);
 h.element('current-hour').listeners.click();await flush();
 assert.equal(h.model.isHistorical,false);
 assert.match(h.element('btc-line').d,/^M0\.000,/);
 assert.match(h.element('btc-line').d,/L416\.667,/);
 const currentPath=h.element('btc-line').d;
 h.pending[0]({ok:true,json:async()=>({candles:[]})});await flush();
 assert.equal(h.element('btc-line').d,currentPath);
});

 test('banner fractional digits follow price moves and reset on navigation',async()=>{
 const h=chartHarness();await flush();
 const digits=()=>h.element('btc-spot').children[1];
 h.tick(108.00);assert.equal(digits().dataset.trend,'');
 h.tick(110.25,2000);
 assert.equal(digits().textContent,'25');
 assert.equal(digits().dataset.trend,'up');
 assert.equal(h.element('btc-spot').children[0],'$110.');
 h.tick(109.75,2000);assert.equal(digits().dataset.trend,'down');
 const unchangedDigits=digits();
 h.tick(109.75,2000);assert.equal(digits().dataset.trend,'down');
 assert.equal(digits(),unchangedDigits,'unchanged price preserves the existing DOM node');
 h.element('previous-hour').listeners.click();await flush();
 assert.equal(digits().dataset.trend,'');
});

test('live banner coalesces intrasecond quotes and refreshes alongside the one-second clock',async()=>{
 const h=chartHarness();await flush();
 const digits=()=>h.element('btc-spot').children;
 const initial=digits(),clock=h.element('workspace-clock').textContent;
 h.tick(110.25);
 assert.equal(digits(),initial,'quotes within the same second retain the displayed price');
 h.step();
 assert.notEqual(h.element('workspace-clock').textContent,clock);
 assert.equal(digits()[0],'$110.');assert.equal(digits()[1].textContent,'25');
 h.tick(112.75);assert.equal(digits()[0],'$110.');
 h.step();assert.equal(digits()[0],'$112.');assert.equal(digits()[1].textContent,'75');
});

test('oil uses server simulated prices and history through the shared chart',async()=>{
 const h=chartHarness({oil:true});await flush();h.step();await flush();
 assert.equal(h.model.spot,110.25);
 assert.equal(h.model.historyStatus,'ready');
 assert.equal(h.model.pricingHistoryStatus,'ready');
 assert.equal(h.model.feedConnection,'connected');
 assert.equal(h.element('feed-status').textContent,'SIMULATED OIL');
 assert.match(h.element('price-context').textContent,/USD \/ BARREL/);
 assert(h.requests.some(url=>url.startsWith('/api/spot?coin=WTI')));
 assert(h.requests.some(url=>url.startsWith('/api/candles?coin=WTI')));
 assert(h.requests.every(url=>!url.includes('coinbase')));
 h.element('previous-hour').listeners.click();await flush();
 assert.equal(h.model.isHistorical,true);
 assert.equal(h.element('feed-status').textContent,'HISTORICAL');
 h.element('current-hour').listeners.click();await flush();h.step();await flush();
 assert.equal(h.model.feedConnection,'connected');
});

test('live oil uses provider timestamps and its minute quote freshness limit',async()=>{
 const h=chartHarness({oil:true,live:true});await flush();h.step();await flush();
 assert.equal(h.model.feedConnection,'connected');
 assert.equal(h.element('feed-status').textContent,'LIVE OIL');
 assert.equal(h.model.spot,110.25);
 assert.equal(h.element('feed-message').hidden,true);
 assert.match(h.element('settlement-source-detail').textContent,/Twelve Data live spot/);
});
test('missing oil credentials show an actionable error without simulated substitution',async()=>{
 const h=chartHarness({oil:true,live:true,spotError:true});await flush();h.step();await flush();
 assert.equal(h.model.feedConnection,'disconnected');
 assert.equal(h.element('feed-message').hidden,false);
 assert.match(h.element('feed-message').textContent,/API key/);
 assert(!Number.isFinite(h.model.spot));
});

test('completed quarters show a green direction arrow with an outcome-colored dot',async()=>{
 const h=chartHarness();await flush();
 const markers=h.element('segment-results').children;
 assert.equal(markers.length,1);assert.equal(markers[0].textContent,'↑');
 assert.equal(markers[0].dataset.direction,'up');assert.equal(markers[0].style.left,'12.5%');
 assert.match(markers[0]['aria-label'],/17:00–17:15 UTC · Up wins/);
});
test('falling quarter points down and ties resolve Up',async()=>{
 for(const [close,direction,arrow] of [[90,'down','↓'],[100,'up','↑']]){
  const h=chartHarness({transformCandles:rows=>rows.map(row=>row[0]*1000===Date.UTC(2026,9,12,17,14)?[...row.slice(0,4),close,1]:row)});await flush();
  const marker=h.element('segment-results').children[0];
  assert.equal(marker.dataset.direction,direction);assert.equal(marker.textContent,arrow);
 }
});
test('missing boundary candle leaves completed segment without an invented winner',async()=>{
 const h=chartHarness({transformCandles:rows=>rows.filter(row=>row[0]*1000!==Date.UTC(2026,9,12,17,14))});await flush();
 assert.equal(h.element('segment-results').children.length,0);
});

 test('minute plot refreshes each second while preserving candle wicks and the price tip',async()=>{
 const h=chartHarness();await flush();
 const initial=h.element('btc-line').d;
 assert.match(initial,/ L/);
 assert.doesNotMatch(initial,/ C/);
 h.tick(110);
 assert.equal(h.model.spot,110);
 assert.equal(h.element('btc-line').d,initial,'quotes within the same second are coalesced');
 h.step();
 const refreshed=h.element('btc-line').d;
 assert.notEqual(refreshed,initial);
 assert.equal(h.element('btc-area').d,undefined,'no shaded area bridges missing minute data');
 assert.match(h.element('minute-bars-up').d,/V/,'minute high and low wicks are visible');
 const end=refreshed.trim().split(' ').at(-1).slice(1).split(',').map(Number);
 assert.ok(Math.abs(end[0]-h.element('btc-tip').cx)<.001);
 assert.ok(Math.abs(end[1]-h.element('btc-tip').cy)<.001);
});

test('minute chart keeps straight closes and separates missing minutes',async()=>{
 const h=chartHarness({transformCandles:rows=>rows.filter(c=>c[0]*1000!==Date.UTC(2026,9,12,17,10))});await flush();
 const path=h.element('btc-line').d;
 assert.doesNotMatch(path,/ C/);
 assert.equal((path.match(/M/g)||[]).length,2,'a missing minute starts a new path');
 assert.match(h.element('chart-description').textContent,/one-minute OHLC/);
});

test('segment countdown shows Locked exactly in the final thirty seconds',async()=>{
 const h=chartHarness({startTime:Date.UTC(2026,9,12,17,59,29)});await flush();
 const market=h.model.markets.find(m=>m.id==='60-0');
 assert.equal(market.remaining,'0m 31s');
 h.step();assert.equal(market.remaining,'0m 30s - Locked');
 for(let i=0;i<29;i++)h.step();
 assert.equal(market.remaining,'0m 01s - Locked');
 h.step();assert.equal(market.remaining.includes('Locked'),false);
});

test('a newly opened five-minute market refreshes its benchmark just after the minute boundary',async()=>{
 const h=chartHarness({startTime:Date.UTC(2026,10,2,17,29,58)});await flush();
 h.pending[0]({ok:true,json:async()=>({candles:[]})});await flush();
 const next=h.model.markets.find(m=>m.id==='5-6');
 assert.equal(next.status,'queued');assert.equal(next.strike,null);
 for(let i=0;i<4;i++){h.step();await flush();}
 assert.equal(next.status,'open');assert(Number.isFinite(next.strike));
 const requests=h.requests.filter(url=>url.includes('/candles?'));
 assert.equal(requests.length,2,'history refresh follows the minute boundary instead of waiting another full minute');
 assert(requests.every(url=>new URL(url,'http://localhost').searchParams.get('granularity')==='60'));
});
