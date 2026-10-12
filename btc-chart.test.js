const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function chartHarness(){
 const elements=new Map(),now=Date.UTC(2026,9,12,17,25,30),hour=Math.floor(now/3600000)*3600000;
 function element(id){
  if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,dataset:{},style:{setProperty(){}},classList:{},listeners:{},
   addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},
   getBoundingClientRect(){return {left:0,width:1000};},replaceChildren(...children){this.children=children;}});
  return elements.get(id);
 }
 const coin={symbol:'BTC',name:'Bitcoin',product:'BTC-USD',icon:'btc.svg',demoBase:100};
 const model={...require('./market-model.js'),markets:require('./market-model.js').markets.map(m=>({...m})),coin};
 const pending=[],timers=[];let socket;
 let frameStamp=0;
 const fetch=async url=>{
  if(url.startsWith('/api/pricing-history'))return new Promise(resolve=>pending.push(resolve));
  const start=Date.parse(new URL(url).searchParams.get('start'));
  const end=Math.min(now,start+3660000);
  const candles=[];
  for(let t=start;t<end;t+=60000) candles.push([t/1000,99,102,100,100+(t-start)/600000,1]);
  return {ok:true,json:async()=>candles};
 };
 class FakeDate extends Date{static now(){return now;}}
 class Socket{constructor(){this.readyState=1;socket=this;}close(){}send(){}}
 const window={RolrModel:model,RolrCoins:{available:[coin],getCoin:()=>coin,formatPrice:v=>'$'+v.toFixed(2)},dispatchEvent(){},addEventListener(){}};
 const context={window,document:{getElementById:element,querySelector:s=>s.startsWith('[data-remaining')?null:element(s),querySelectorAll:()=>[],addEventListener(){},createElement:()=>{const node={dataset:{}};return node;}},Date:FakeDate,Intl,URLSearchParams,fetch,AbortController,WebSocket:Socket,Event:class{},localStorage:{getItem(){return null;},setItem(){}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},performance:{now:()=>frameStamp},console};
 vm.runInNewContext(fs.readFileSync('btc-chart.js','utf8'),context);
 return {element,pending,model,hour,tick(price){frameStamp+=1000;socket.onmessage({data:JSON.stringify({type:'ticker',product_id:'BTC-USD',price:String(price),time:new Date(now).toISOString()})});timers.at(-1)();}};
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
