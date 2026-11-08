const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function detailHarness(){
 const now=Date.UTC(2026,10,2,17,25,30),hour=Math.floor(now/3600000)*3600000;
 const base=require('../../src/frontend/market-model.js');
 const model={...base,coin:{symbol:'BTC',name:'Bitcoin',feed:'coinbase'},feedMode:'live',displayHour:hour,now,
  spot:101,spotStatus:'ready',feedConnection:'connected',priceUpdatedAt:now,quoteReady:true,volatility:.001,
  candles:Array.from({length:87},(_,i)=>[(hour/1000)-3660+i*60,98,103,100,100,1])};
 model.markets=base.adjacentMarkets(5,now,now,model.candles);
 const elements=new Map(),events=new Map(),dispatched=[];
 const node=()=>({hidden:false,dataset:{},style:{},listeners:{},attrs:{},textContent:'',
  addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(k,v){this.attrs[k]=v;}});
 const cards=Array.from({length:3},()=>{
  const nodes=new Map(),card=node();
  card.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};return card;
 });
 const get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
 const durations=[5,15,30,60,1].map(minutes=>{const button=node();button.dataset.detailDuration=String(minutes);return button;});
 get('detail-cards').querySelectorAll=()=>cards;
 class FakeDate extends Date{static now(){return model.now;}}
 const window={PredictModel:model,PredictCoins:{formatPrice:v=>'$'+v.toFixed(2)},
  addEventListener(name,fn){events.set(name,fn);},dispatchEvent(event){dispatched.push(event);events.get(event.type)?.(event);}};
 const document={getElementById:get,querySelectorAll:()=>durations};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/market-detail.js'),'utf8'),
  {window,document,Date:FakeDate,Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,args){this.type=type;Object.assign(this,args);}}});
 return {model,get,cards,events,dispatched,durations,click:id=>get(id).listeners.click(),field:(index,name)=>cards[index].querySelector(`[data-detail-${name}]`)};
}

test('detail opens three minute charts and uses the existing prediction ticket',()=>{
 const h=detailHarness();h.click('show-detail');
 assert.equal(h.get('hour-overview').hidden,true);assert.equal(h.get('market-detail').hidden,false);
 assert.equal(h.get('detail-title').textContent,'5-minute detail');
 assert.match(h.get('detail-cards').innerHTML,/>Last</);assert.match(h.get('detail-cards').innerHTML,/>Current</);assert.match(h.get('detail-cards').innerHTML,/>Next</);
 assert.equal(h.field(0,'status').textContent,'COMPLETED');assert.equal(h.field(1,'status').textContent,'OPEN');assert.equal(h.field(2,'status').textContent,'UPCOMING');
 assert.match(h.field(0,'result').textContent,/Up wins/);assert.match(h.field(1,'line').attrs.d,/^M/);
 assert.equal(h.field(1,'predict').disabled,false);
 h.get('detail-cards').listeners.click({target:{closest:()=>({dataset:{detailPredict:'1'}})}});
 const event=h.dispatched.find(event=>event.type==='detail-predict');
 assert.equal(event.detail.id,'5-5');assert.equal(event.detail.startsAt,h.model.displayHour+1500000);
 h.click('show-overview');assert.equal(h.get('hour-overview').hidden,false);assert.equal(h.get('market-detail').hidden,true);
});

test('detail clears stale live prices and respects betting lock and historical views',()=>{
 const h=detailHarness();h.click('show-detail');
 assert.equal(h.field(1,'price').textContent,'$101.00');
 h.model.feedConnection='disconnected';h.events.get('btc-chances-update')();
 assert.equal(h.field(1,'price').textContent,'—');assert.equal(h.field(1,'predict').disabled,true);
 assert.equal(h.field(1,'tip').attrs.visibility,'hidden');
 h.model.feedConnection='connected';h.model.now=h.model.displayHour+1770000;h.model.priceUpdatedAt=h.model.now;
 h.events.get('btc-chances-update')();assert.equal(h.field(1,'predict').disabled,true);
 assert.match(h.field(1,'countdown').textContent,/Betting closed/);
 h.model.isHistorical=true;h.events.get('btc-market-update')();
 assert.match(h.get('detail-context').textContent,/Selected hour/);
 assert(h.cards.every((_,index)=>h.field(index,'predict').hidden||h.field(index,'predict').disabled));
});

test('detail duration and UTC hour rollover refresh all three interval windows',()=>{
 const h=detailHarness();h.click('show-detail');
 h.durations[3].listeners.click();assert.equal(h.get('detail-title').textContent,'60-minute detail');
 assert.match(h.get('detail-cards').innerHTML,/17:00 – 18:00 UTC/);
 assert.equal(h.durations[3].attrs['aria-pressed'],'true');
 h.durations[0].listeners.click();
 h.model.now=h.model.displayHour+3601000;h.model.displayHour+=3600000;
 h.events.get('btc-market-update')();
 assert.match(h.get('detail-cards').innerHTML,/17:55 – 18:00 UTC/);
 assert.match(h.get('detail-cards').innerHTML,/18:00 – 18:05 UTC/);
 assert.match(h.get('detail-cards').innerHTML,/18:05 – 18:10 UTC/);
 assert.equal(h.field(1,'strike').textContent,'—','an absent opening minute never reuses the prior interval benchmark');
});

test('one-minute row opens its detail and follows the minute boundary with the betting cutoff',()=>{
 const h=detailHarness();
 h.model.now=h.model.displayHour+25*60000+10000;h.model.priceUpdatedAt=h.model.now;
 h.model.markets=h.model.adjacentMarkets(1,h.model.now,h.model.now,h.model.candles);
 h.events.get('market-detail-open')({detail:{minutes:1}});
 assert.equal(h.get('detail-title').textContent,'1-minute detail');
 assert.equal(h.durations[4].attrs['aria-pressed'],'true');
 assert.equal(h.field(1,'predict').disabled,false);
 assert.match(h.get('detail-cards').innerHTML,/17:25 – 17:26 UTC/);
 h.model.now+=20000;h.model.priceUpdatedAt=h.model.now;h.events.get('btc-chances-update')();
 assert.equal(h.field(1,'predict').disabled,true);assert.match(h.field(1,'countdown').textContent,/Betting closed/);
 h.model.now+=30000;h.model.priceUpdatedAt=h.model.now;
 h.model.markets=h.model.adjacentMarkets(1,h.model.now,h.model.now,h.model.candles);
 h.events.get('btc-market-update')();
 assert.match(h.get('detail-cards').innerHTML,/17:26 – 17:27 UTC/);
 assert.equal(h.field(1,'predict').disabled,false);
 h.get('detail-cards').listeners.click({target:{closest:()=>({dataset:{detailPredict:'1'}})}});
 assert.equal(h.dispatched.at(-1).detail.id,'1-26');
});
