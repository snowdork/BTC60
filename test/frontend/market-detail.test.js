const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function detailHarness({predictions=[],user={id:1}}={}){
 const now=Date.UTC(2026,10,2,17,25,30),hour=Math.floor(now/3600000)*3600000;
 const base=require('../../src/frontend/market-model.js');
 const model={...base,coin:{symbol:'BTC',name:'Bitcoin',feed:'coinbase'},feedMode:'live',displayHour:hour,now,
  spot:101,spotStatus:'ready',feedConnection:'connected',priceUpdatedAt:now,quoteReady:true,volatility:.001,
  candles:Array.from({length:87},(_,i)=>[(hour/1000)-3660+i*60,98,103,100,100,1])};
 model.markets=base.adjacentMarkets(15,now,now,model.candles);
 const elements=new Map(),events=new Map(),dispatched=[];
 const node=()=>({hidden:false,dataset:{},style:{setProperty(key,value){this[key]=value;}},listeners:{},attrs:{},textContent:'',children:[],get ownerDocument(){return document;},
  replaceChildren(...children){this.children=children;},
  addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(k,v){this.attrs[k]=v;}});
 const cards=Array.from({length:1},()=>{
  const nodes=new Map(),card=node();
  card.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};return card;
 });
 const get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
 const durations=[5,15,30,60].map(minutes=>{const button=node();button.dataset.detailDuration=String(minutes);return button;});
 get('detail-cards').querySelectorAll=()=>cards;
 let wallTime=null;
 class FakeDate extends Date{static now(){return wallTime??model.now;}}
 const account={user,predictions};
 const window={PredictMinuteTrend:require('../../src/frontend/minute-trend.js'),PredictSegmentCard:require('../../src/frontend/segment-card.js'),PredictModel:model,Predict60Account:account,PredictCoins:{formatPrice:v=>'$'+v.toFixed(2)},
  addEventListener(name,fn){events.set(name,fn);},dispatchEvent(event){dispatched.push(event);events.get(event.type)?.(event);}};
 const document={getElementById:get,querySelectorAll:()=>durations,createElement:node};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/market-detail.js'),'utf8'),
  {window,document,Date:FakeDate,AbortController,setTimeout,clearTimeout,Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,args){this.type=type;Object.assign(this,args);}}});
 return {model,account,get,cards,events,dispatched,durations,setWallTime(value){wallTime=value;},click:id=>get(id).listeners.click(),field:(index,name)=>cards[index].querySelector(`[data-detail-${name}]`)};
}

test('single play aligns chart, coin and red timer to the selected interval',()=>{
 const h=detailHarness();
 assert.equal(h.get('hour-overview').hidden,true);
 assert.equal(h.get('detail-title').textContent,'Bitcoin price chart');
 assert.equal(h.get('market-detail').dataset.state,'live');
 assert.equal((h.get('detail-cards').innerHTML.match(/data-detail-index=/g)||[]).length,1);
 assert.equal(h.field(0,'coin-name').textContent,'BTC · 15 MIN');
 assert.match(h.get('play-line').attrs.d,/^M/);
 assert.equal(h.get('play-timeframe').textContent,'BTC · 17:15 – 17:30 UTC · 15 MIN');
 assert.equal(h.get('play-cursor').hidden,false);
 assert.equal(h.get('play-cursor').style.left,'70%');
 h.get('detail-cards').listeners.click({target:{closest:()=>({dataset:{detailPredict:'0'}})}});
 assert.equal(h.dispatched.at(-1).detail.id,'15-1');
});

test('segment odds follow estimates and hide when data becomes unavailable',()=>{
 const h=detailHarness();
 h.model.estimateChances=()=>({up:61,down:39});h.events.get('btc-chances-update')();
 assert.equal(h.field(0,'up-chance').textContent,'61');
 assert.equal(h.field(0,'down-chance').textContent,'39');
 h.model.estimateChances=()=>({up:34,down:66});h.events.get('btc-price-update')();
 assert.equal(h.field(0,'up-chance').textContent,'34');
 assert.equal(h.field(0,'down-chance').textContent,'66');
 h.model.feedConnection='disconnected';h.events.get('btc-chances-update')();
 assert.equal(h.field(0,'chances').hidden,true);
});

test('single-click interval selections keep the chosen view; Hour clears selection until the user chooses again',()=>{
 const h=detailHarness();
 h.click('show-overview');
 assert.equal(h.get('hour-overview').hidden,false);
 assert(h.durations.every(button=>button.attrs['aria-pressed']==='false'));
 assert.equal(h.get('hour-overview').dataset.duration,'60');
 h.durations[2].listeners.click();
 assert.equal(h.get('hour-overview').hidden,false,'a duration choice must keep Hour active');
 assert.equal(h.durations[2].attrs['aria-pressed'],'true');
 const startsAt=h.model.displayHour+5*60000;
 h.events.get('market-interval-select')({detail:{minutes:5,startsAt}});
 assert.equal(h.get('hour-overview').hidden,false,'a segment selection must keep Hour active');
 assert.equal(h.durations[0].attrs['aria-pressed'],'true');
 h.click('show-detail');
 assert.equal(h.get('hour-overview').hidden,true);
 assert.equal(h.get('play-timeframe').textContent,'BTC · 17:05 – 17:10 UTC · 5 MIN');
 h.click('show-overview');
 assert(h.durations.every(button=>button.attrs['aria-pressed']==='false'));
 h.click('show-detail');
 assert.equal(h.get('play-timeframe').textContent,'BTC · 17:25 – 17:30 UTC · 5 MIN','clearing a selection returns Interval to the current play');
});

test('double-clicking a card moves between Hour and its exact interval',()=>{
 const h=detailHarness();
 h.click('show-overview');
 const target={closest:selector=>selector==='[data-market]'?{dataset:{market:'15-0'}}:null};
 h.get('market-grid').listeners.dblclick({target});
 assert.equal(h.get('hour-overview').hidden,true);
 assert.equal(h.get('show-detail').attrs['aria-pressed'],'true');
 assert.equal(h.get('play-timeframe').textContent,'BTC · 17:00 – 17:15 UTC · 15 MIN');
 h.get('detail-cards').listeners.dblclick({target:{closest:selector=>selector==='[data-detail-index]'?{dataset:{detailIndex:'0'}}:null}});
 assert.equal(h.get('hour-overview').hidden,false);
 assert.equal(h.get('show-overview').attrs['aria-pressed'],'true');
 assert(h.durations.every(button=>button.attrs['aria-pressed']==='false'));
});

test('double-click shortcuts ignore card action buttons and non-card areas',()=>{
 const h=detailHarness();
 const action={target:{closest:()=>({})}};
 h.get('detail-cards').listeners.dblclick(action);
 assert.equal(h.get('hour-overview').hidden,true);
 h.get('detail-cards').listeners.dblclick({target:{closest:()=>null}});
 assert.equal(h.get('hour-overview').hidden,true);
 h.click('show-overview');
 h.get('market-grid').listeners.dblclick(action);
 assert.equal(h.get('hour-overview').hidden,false);
 h.get('market-grid').listeners.dblclick({target:{closest:()=>null}});
 assert.equal(h.get('hour-overview').hidden,false);
});

test('double-clicking a browsed past interval requests its containing UTC hour',()=>{
 const h=detailHarness();
 h.click('play-previous');h.click('play-previous');
 h.get('detail-cards').listeners.dblclick({target:{closest:selector=>selector==='[data-detail-index]'?{dataset:{detailIndex:'0'}}:null}});
 assert.equal(h.get('hour-overview').hidden,false);
 const navigation=h.dispatched.find(event=>event.type==='market-hour-select');
 assert.equal(navigation.detail.hour,h.model.displayHour-3600000);
});

test('minute summary arrows follow the selected interval and wait for completed, valid candles',()=>{
 const h=detailHarness(),start=h.model.displayHour+15*60000;
 const markers=()=>h.get('play-minute-heatmap').children;
 assert.equal(markers().length,15);
 assert.equal(markers().filter(marker=>marker.className==='minute-arrow up').length,10);
 assert.equal(markers()[10].className,'minute-arrow current');
 h.model.candles=h.model.candles.filter(c=>c[0]*1000!==start+5*60000).map(c=>{
  if(c[0]*1000===start+60000)return [...c.slice(0,4),99,1];
  if(c[0]*1000===start+3*60000)return [c[0],c[1],c[2],0,c[4],1];
  return c;
 });
 h.events.get('btc-market-update')();
 assert.equal(markers()[1].className,'minute-arrow down');
 assert.equal(markers()[3].className,'minute-arrow');
 assert.equal(markers()[5].className,'minute-arrow');
 assert.equal(markers()[12].className,'minute-arrow');
 const previous=markers();h.events.get('btc-price-update')();
 assert.equal(markers(),previous,'price ticks preserve the summary');
 h.model.now+=60000;h.model.priceUpdatedAt=h.model.now;h.events.get('btc-market-update')();
 assert.equal(markers()[10].className,'minute-arrow up');
 assert.equal(markers()[11].className,'minute-arrow current');
 for(const button of h.durations){
  button.listeners.click();
  assert.equal(markers().length,Number(button.dataset.detailDuration));
  assert.equal(parseFloat(markers().at(-1).style.left),(markers().length-.5)/markers().length*100);
 }
 h.click('play-next');
 assert(markers().every(marker=>marker.className==='minute-arrow'),'upcoming intervals clear previous trend colors');
 assert(markers().every(marker=>marker.title.includes('Upcoming')));
});

test('the selected segment separates colored odds from the actual percentage move since its start',()=>{
 const h=detailHarness();
 h.model.estimateChances=()=>({up:61,down:39});h.events.get('btc-chances-update')();
 assert.equal(h.field(0,'up-chance').textContent,'61');
 assert.equal(h.field(0,'down-chance').textContent,'39');
 assert.equal(h.field(0,'movement').textContent,'↑ Up +1.00% from start');
 assert.equal(h.field(0,'movement').dataset.direction,'up');
 h.model.spot=99;h.events.get('btc-price-update')();
 assert.equal(h.field(0,'movement').textContent,'↓ Down −1.00% from start');
 assert.equal(h.field(0,'movement').dataset.direction,'down');
 h.model.feedConnection='disconnected';h.events.get('btc-chances-update')();
 assert.equal(h.field(0,'movement').hidden,true);
 h.click('play-previous');
 assert.equal(h.field(0,'movement').textContent,'↑ Up +0.00% from start','completed plays use their closing price');
 h.click('play-next');h.click('play-next');
 assert.equal(h.field(0,'movement').hidden,true,'future plays have no price movement yet');
});

test('saved execution tags match the coin and exact interval, retain their percentage, and survive navigation',()=>{
 const h=detailHarness(),start=Date.UTC(2026,10,2,17,15)/1000;
 const prediction={id:'saved-up',mode:'contest',coin:'BTC',market_id:'15-1',starts_at:start,ends_at:start+900,side:'up',cost_cents:1250,cents:63,settled_at:null};
 assert.equal(h.field(0,'predictions').hidden,true);
 h.account.predictions=[prediction,{...prediction,id:'other-hour',starts_at:start-3600,ends_at:start-2700},
  {...prediction,id:'other-coin',coin:'ETH'},{...prediction,id:'other-duration',market_id:'5-3',ends_at:start+300},
  {...prediction,id:'saved-down',side:'down',cost_cents:850,cents:27}];
 h.events.get('account-update')();
 const labels=()=>h.field(0,'predictions').children.map(tag=>tag.textContent);
 assert.deepEqual(labels(),['↑ Up · 12.50 credits @ 63%','↓ Down · 8.50 credits @ 27%']);
 assert.equal(h.field(0,'predictions').hidden,false);
 h.model.estimateChances=()=>({up:71,down:29});h.events.get('btc-price-update')();
 assert.deepEqual(labels(),['↑ Up · 12.50 credits @ 63%','↓ Down · 8.50 credits @ 27%']);
 h.click('play-previous');assert.equal(h.field(0,'predictions').hidden,true);
 h.click('play-next');assert.equal(h.field(0,'predictions').hidden,false);
 assert.equal(labels()[0],'↑ Up · 12.50 credits @ 63%');
 h.account.user=null;h.events.get('account-update')();
 assert.equal(h.field(0,'predictions').hidden,true);
});

test('initial account data restores prediction tags after a reload',()=>{
 const start=Date.UTC(2026,10,2,17,15)/1000;
 const prediction={id:'restored',mode:'contest',coin:'BTC',market_id:'15-1',starts_at:start,ends_at:start+900,side:'down',cost_cents:100000,cents:42,settled_at:null};
 const h=detailHarness({predictions:[prediction]});
 assert.equal(h.field(0,'predictions').children[0].textContent,'↓ Down · 1,000.00 credits @ 42%');
 prediction.settled_at=start+901;prediction.outcome='down';h.events.get('account-update')();
 assert.equal(h.field(0,'predictions').children[0].textContent,'↓ Down · 1,000.00 credits @ 42% · Won');
});

test('the graph never retracts when quotes arrive between timer ticks or the connection briefly reconnects',()=>{
 const h=detailHarness(),baseTime=h.model.now;
 let previousX=Number(h.get('play-tip').attrs.cx);
 for(const elapsed of [250,1000,1250,2000]){
  h.setWallTime(baseTime+elapsed);
  if(elapsed%1000){h.model.priceUpdatedAt=baseTime+elapsed;h.model.spot+=.1;}
  else h.model.now=baseTime+elapsed;
  h.events.get('btc-price-update')();
  const tip=Number(h.get('play-tip').attrs.cx),cursor=parseFloat(h.get('play-cursor').style.left)*10;
  assert(tip>=previousX,'the endpoint must move forward across quote and timer updates');
  assert(Math.abs(tip-cursor)<1e-9,'live endpoint and timer must use the same time');
  previousX=tip;
 }
 h.model.feedConnection='disconnected';h.events.get('btc-chances-update')();
 assert.equal(Number(h.get('play-tip').attrs.cx),previousX,'a transport reconnect must retain the fresh provisional endpoint');
 assert.equal(h.field(0,'predict').disabled,true,'connection readiness still gates orders');
});

test('arrows move one duration and live restores automatic following',()=>{
 const h=detailHarness();
 h.click('play-previous');
 assert.match(h.get('detail-cards').innerHTML,/17:00 – 17:15 UTC/);
 assert.equal(h.get('market-detail').dataset.state,'completed');
 assert.equal(h.field(0,'predict').hidden,false);
 assert.equal(h.field(0,'predict').disabled,false);
 assert.equal(h.get('play-cursor').hidden,true);
 h.click('play-next');h.click('play-next');
 assert.match(h.get('detail-cards').innerHTML,/17:30 – 17:45 UTC/);
 assert.equal(h.get('play-next').disabled,true);
 assert.equal(h.get('market-detail').dataset.state,'upcoming');
 assert.equal(h.field(0,'predict').hidden,false);
 assert.equal(h.field(0,'predict').disabled,false);
 h.click('play-live');
 assert.match(h.get('detail-cards').innerHTML,/17:15 – 17:30 UTC/);
 assert.equal(h.field(0,'predict').disabled,false);
 assert.equal(h.get('market-detail').dataset.state,'live');
 h.model.now=h.model.displayHour+3601000;h.model.priceUpdatedAt=h.model.now;
 h.events.get('btc-market-update')();
 assert.match(h.get('detail-cards').innerHTML,/18:00 – 18:15 UTC/);
});

test('completed arrows appear only with confirmed closes and follow corrected results',()=>{
 const h=detailHarness(),closingTime=h.model.displayHour/1000+14*60;
 const closing=h.model.candles.find(c=>c[0]===closingTime);
 h.model.candles=h.model.candles.filter(c=>c!==closing);
 h.click('play-previous');
 assert.equal(h.get('market-detail').dataset.state,'pending');
 assert(!h.get('detail-cards').innerHTML.includes('play-settlement-arrow'));
 h.model.candles.push(closing);h.events.get('btc-market-update')();
 assert.match(h.get('detail-cards').innerHTML,/play-settlement-arrow up/);
 closing[4]=99;h.events.get('btc-market-update')();
 assert.match(h.get('detail-cards').innerHTML,/play-settlement-arrow down/);
});

test('missing interval history loads on navigation and late responses cannot replace the selected graph',async()=>{
 const h=detailHarness(),requests=[];
 h.model.candles=[];
 h.model.loadMinuteHistory=(start,end,{signal})=>new Promise(resolve=>requests.push({start,end,signal,resolve}));
 h.click('play-previous');
 assert.equal(requests.length,1);
 assert.match(h.get('play-chart-empty').textContent,/Loading selected interval/);
 h.click('play-previous');
 assert.equal(requests.length,2);
 assert.equal(requests[0].signal.aborted,true);
 const rows=request=>Array.from({length:(request.end-request.start)/60000},(_,i)=>[request.start/1000+i*60,98,103,100,101,1]);
 requests[0].resolve(rows(requests[0]));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.get('play-line').attrs.d,'');
 requests[1].resolve(rows(requests[1]));
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.get('play-line').attrs.d,/^M/);
 assert.equal(h.get('play-chart-empty').hidden,true);
 assert.equal(h.get('market-detail').dataset.state,'completed');
 assert.equal(h.get('play-timeframe').textContent,'BTC · 16:45 – 17:00 UTC · 15 MIN');
 h.click('play-next');
 await new Promise(resolve=>setImmediate(resolve));
 // A cancelled earlier request is fetched again rather than reused for a different interval.
 assert.equal(requests.length,3);
 requests[2].resolve(rows(requests[2]));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.get('play-timeframe').textContent,'BTC · 17:00 – 17:15 UTC · 15 MIN');
 assert.match(h.get('play-line').attrs.d,/^M/);
});

test('stale prices and cutoff cannot place predictions',()=>{
 const h=detailHarness();
 h.model.feedConnection='disconnected';h.events.get('btc-chances-update')();
 assert.equal(h.field(0,'price').textContent,'—');
 assert.equal(h.field(0,'predict').disabled,true);
 h.model.feedConnection='connected';h.model.now=h.model.displayHour+1795000;h.model.priceUpdatedAt=h.model.now;
 h.events.get('btc-chances-update')();
 assert.equal(h.field(0,'predict').disabled,true);
 assert.match(h.field(0,'countdown').textContent,/Betting closed/);
});

test('duration changes return to the current play and coin switches refresh identity',()=>{
 const h=detailHarness();h.click('play-previous');
 h.durations[3].listeners.click();
 assert.match(h.get('detail-cards').innerHTML,/17:00 – 18:00 UTC/);
 assert.equal(h.get('market-detail').dataset.duration,'60');
 h.model.coin={...h.model.coin,symbol:'ETH',name:'Ethereum',icon:'eth.svg'};
 h.events.get('coin-change')();
 assert.equal(h.field(0,'coin').src,'eth.svg');
 assert.equal(h.get('play-coin-icon').src,'eth.svg');
 assert.equal(h.get('play-coin-icon').alt,'Ethereum');
 assert.equal(h.get('play-coin-fallback').hidden,true);
 assert.equal(h.field(0,'coin-name').textContent,'ETH · 60 MIN');
});

test('play reuses history across price ticks and refreshes replaced candles',()=>{
 const h=detailHarness(),inputs=[];
 const plot=h.model.minutePlot;
 h.model.minutePlot=(candles,...args)=>{inputs.push(candles);return plot(candles,...args);};
 h.events.get('btc-price-update')();
 const line=h.get('play-line').attrs.d;
 h.events.get('btc-chances-update')();
 assert.equal(inputs[0],inputs[1]);
 assert.equal(h.get('play-line').attrs.d,line);
 h.model.candles=h.model.candles.map(c=>[...c.slice(0,4),c[4]+1,...c.slice(5)]);
 h.events.get('btc-market-update')();
 assert.notEqual(inputs[2],inputs[0]);
 assert.equal(h.field(0,'strike').textContent,'$101.00');
});

test('detail direction shortcuts carry the chosen side and disable at the cutoff',()=>{
 const h=detailHarness();
 for(const side of ['up','down']){
  const button=h.field(0,side+'-chance');
  assert.equal(button.disabled,false);
  h.get('detail-cards').listeners.click({target:{closest:()=>({dataset:{detailPredict:'0',predictSide:side},disabled:button.disabled})}});
  assert.equal(h.dispatched.at(-1).detail.side,side);
  assert.equal(h.dispatched.at(-1).detail.id,'15-1');
 }
 h.model.now=h.model.displayHour+1795000;h.model.priceUpdatedAt=h.model.now;
 h.events.get('btc-chances-update')();
 assert.equal(h.field(0,'up-chance').disabled,true);
 assert.equal(h.field(0,'down-chance').disabled,true);
 const count=h.dispatched.length;
 h.get('detail-cards').listeners.click({target:{closest:()=>({dataset:{detailPredict:'0',predictSide:'up'},disabled:true})}});
 assert.equal(h.dispatched.length,count);
});
