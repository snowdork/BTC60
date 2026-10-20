const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function chartHarness({oil=false,live=false,spotError=false,transformCandles=c=>c}={}){
 const elements=new Map(),now=Date.UTC(2026,9,12,17,25,30),hour=Math.floor(now/3600000)*3600000;
 function element(id){
  if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,dataset:{},style:{setProperty(){}},classList:{},listeners:{},
   addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},
   getBoundingClientRect(){return {left:0,width:1000};},replaceChildren(...children){this.children=children;}});
  return elements.get(id);
 }
 const coin={symbol:oil?'WTI':'BTC',name:oil?'West Texas Intermediate':'Bitcoin',product:oil?'SIM-WTI':'BTC-USD',icon:'btc.svg',demoBase:100,category:oil?'oil':'crypto',feed:oil?(live?'twelvedata':'simulated'):'coinbase',maxPriceAgeMs:live?90000:15000};
 const model={...require('./market-model.js'),markets:require('./market-model.js').markets.map(m=>({...m})),coin};
 const pending=[],timers=[],requests=[];let socket;
 let frameStamp=0;
 const fetch=async url=>{
  requests.push(url);
  if(url.startsWith('/api/spot'))return spotError?{ok:false,json:async()=>({error:'Oil feed needs a Twelve Data API key on the server.'})}:{ok:true,json:async()=>({price:110.25,time:live?now-30000:now,source:live?'Twelve Data':'oil-simulation-v1'})};
  if(oil&&url.startsWith('/api/pricing-history'))return {ok:true,json:async()=>({candles:Array.from({length:90},(_,i)=>[(hour/1000)-5400+i*60,99,102,100,100+i*.01,0])})};
  if(url.startsWith('/api/pricing-history'))return new Promise(resolve=>pending.push(resolve));
  const query=new URL(url,'http://localhost').searchParams;
  const start=oil?Number(query.get('start'))*1000:Date.parse(query.get('start'));
  const end=Math.min(now,start+3660000);
  const candles=[];
  for(let t=start;t<end;t+=60000) candles.push([t/1000,99,102,100,100+(t-start)/600000,1]);
  return {ok:true,json:async()=>transformCandles(candles)};
 };
 class FakeDate extends Date{static now(){return now;}}
 class Socket{constructor(){this.readyState=1;socket=this;}close(){}send(){}}
 const window={PredictModel:model,PredictCoins:{available:[coin],getCoin:()=>coin,formatPrice:v=>'$'+v.toFixed(2)},dispatchEvent(){},addEventListener(){}};
 const context={window,document:{getElementById:element,querySelector:s=>s.startsWith('[data-remaining')?null:element(s),querySelectorAll:()=>[],addEventListener(){},createElement:()=>({dataset:{},style:{setProperty(){}},setAttribute(k,v){this[k]=v;}})},Date:FakeDate,Intl,URLSearchParams,fetch,AbortController,WebSocket:Socket,Event:class{},localStorage:{getItem(){return null;},setItem(){}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},performance:{now:()=>frameStamp},console};
 vm.runInNewContext(fs.readFileSync('btc-chart.js','utf8'),context);
 return {element,pending,model,hour,requests,step(){frameStamp+=1000;timers.at(-1)();},tick(price){frameStamp+=1000;socket.onmessage({data:JSON.stringify({type:'ticker',product_id:'BTC-USD',price:String(price),time:new Date(now).toISOString()})});timers.at(-1)();}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

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

 test('banner fractional digits follow second-to-second moves and reset on navigation',async()=>{
 const h=chartHarness();await flush();
 const digits=()=>h.element('btc-spot').children[1];
 h.tick(108.00);assert.equal(digits().dataset.trend,'');
 h.tick(110.25);
 assert.equal(digits().textContent,'25');
 assert.equal(digits().dataset.trend,'up');
 assert.equal(h.element('btc-spot').children[0],'$110.');
 h.tick(109.75);assert.equal(digits().dataset.trend,'down');
 const unchangedDigits=digits();
 h.tick(109.75);assert.equal(digits().dataset.trend,'down');
 assert.equal(digits(),unchangedDigits,'unchanged price preserves the existing DOM node');
 h.element('previous-hour').listeners.click();await flush();
 assert.equal(digits().dataset.trend,'');
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
