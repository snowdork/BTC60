const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {createCatalog}=require('../../src/frontend/coins.js');
const pageIds=new Set([...fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/index.html'),'utf8').matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
async function run(protocol,fetch,category='crypto',accountOptions={}){
 const elements=new Map(),loaded=[],buttons=[],listeners=new Map(),timers=[];
 let now=1800000300000;
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'Connecting…',hidden:true,addEventListener(){},append(){},replaceChildren(...children){buttons.push(...children);},querySelectorAll(){return buttons;},setAttribute(){},dataset:{}});return elements.get(id);};
 const durationButtons=[60,30,15,5].map(minutes=>({dataset:{detailDuration:String(minutes)},attributes:{},setAttribute(name,value){this.attributes[name]=value;}}));
 const document={querySelectorAll:selector=>selector==='[data-detail-duration]'?durationButtons:[],body:{dataset:{},style:{setProperty(){}}},getElementById:id=>pageIds.has(id)?element(id):null,querySelector:()=>element('picker'),createElement:()=>({dataset:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;},addEventListener(){},append(){}}),head:{append(script){loaded.push(script.src);script.onload();}}};
 const context={document,location:{protocol,search:'?category='+category,reload(){}},window:{addEventListener(name,handler){listeners.set(name,handler);},Predict60Account:{loaded:Promise.resolve(),user:{},predictions:[],...accountOptions},PredictCoinCatalog:{createCatalog},PredictModel:{configure(){}}},fetch:async(url,...args)=>url==='/api/categories'?{ok:true,json:async()=>({categories:[{id:'crypto',name:'Crypto'},{id:'oil',name:'Oil'}]})}:fetch(url,...args),URLSearchParams,AbortSignal,AbortController,setTimeout,clearTimeout,setInterval(handler){timers.push(handler);return timers.length;},clearInterval(){},Date:{now:()=>now},Error,TypeError,SyntaxError};
 await vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/bootstrap.js'),'utf8'),context);
 return {elements,loaded,window:context.window,document,buttons,durationButtons,listeners,tick(value){now=value;timers.forEach(handler=>handler());}};
}
test('file preview shows actionable offline state instead of Connecting',async()=>{const {elements,loaded}=await run('file:',()=>assert.fail('Must not fetch from file URLs'));assert.equal(elements.get('startup-help').hidden,false);assert.equal(elements.get('workspace-clock').textContent,'Terminal offline');assert.equal(elements.get('submit-prediction').disabled,true);assert.equal(loaded.length,0);});
test('network errors and static-server HTML stop startup clearly',async()=>{for(const fetch of [async()=>{throw new TypeError('NetworkError');},async()=>({ok:true,headers:{get:()=> 'text/html'}})]){const {elements,loaded}=await run('http:',fetch);assert.match(elements.get('chart-empty').textContent,/server.py/);assert.equal(elements.get('feed-status').textContent,'UNAVAILABLE');assert.equal(loaded.length,0);}});
test('database catalog loads before terminal scripts',async()=>{const {elements,loaded}=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:[{symbol:'TEST',name:'Test',product:'TEST-USD',precision:2,demoBase:100,enabled:1,icon:''}]})}));assert.deepEqual(loaded,['market-model.js','minute-trend.js','segment-card.js','app.js','market-detail.js','btc-chart.js']);assert.equal(elements.has('startup-help'),false);});

test('oil category configures the same framework with only oil instruments',async()=>{
 const {window,document,loaded}=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:[{symbol:'BTC',name:'Bitcoin',product:'BTC-USD',precision:2,demoBase:100,enabled:1},{symbol:'WTI',name:'WTI',product:'SIM-WTI',precision:2,demoBase:72,enabled:1,category:'oil',feed:'simulated'}]})}),'oil');
 assert.equal(document.body.dataset.category,'oil');
 assert.equal(window.PredictCoins.available.length,1);
 assert.equal(window.PredictCoins.available[0].symbol,'WTI');
 assert.deepEqual(loaded,['market-model.js','minute-trend.js','segment-card.js','app.js','market-detail.js','btc-chart.js']);
});

test('hourly coin rings show only active pending directions and expire with time',async()=>{
 const now=1800000300,hour=Math.floor(now/3600)*3600;
 const order=(coin,side,extra={})=>({coin,side,mode:'contest',starts_at:hour,ends_at:hour+3600,settled_at:null,...extra});
 const records=['BTC','ETH','SOL','XRP','ADA','LTC'].map(symbol=>({symbol,name:symbol,product:symbol+'-USD',precision:2,demoBase:100,enabled:1}));
 const account={predictions:[order('BTC','up'),order('ETH','down'),order('SOL','up'),order('SOL','down'),
  order('XRP','up',{settled_at:now-1}),order('ADA','up',{mode:'practice'}),
  order('LTC','up',{starts_at:hour-3600,ends_at:hour}),order('LTC','down',{starts_at:now+100})]};
 const result=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:records})}),'crypto',account);
 const state=symbol=>result.buttons.find(button=>button.dataset.coin===symbol);
 assert.equal(state('BTC').dataset.prediction,'pending');
 assert.equal(state('ETH').dataset.prediction,'pending');
 assert.equal(state('SOL').dataset.prediction,'pending');
 assert.equal(state('XRP').dataset.prediction,'none');
 assert.equal(state('ADA').dataset.prediction,'none');
 assert.equal(state('LTC').dataset.prediction,'none');
 assert.match(state('SOL').attributes['aria-label'],/Active pending predictions in this hour/);
 result.tick((now+100)*1000);
 assert.equal(state('LTC').dataset.prediction,'pending');
 result.tick((hour+3600)*1000);
 for(const button of result.buttons)assert.equal(button.dataset.prediction,'none');
 assert.doesNotMatch(state('BTC').attributes['aria-label'],/prediction/);
 const model=result.window.PredictModel;
 model.markets=[{minutes:60,startsAt:hour*1000}];
 result.listeners.get('btc-market-update')();
 assert.equal(state('BTC').dataset.prediction,'none');
 assert.equal(state('XRP').dataset.prediction,'none');
 model.markets[0].startsAt=(hour-3600)*1000;
 result.listeners.get('btc-market-update')();
 assert.equal(state('BTC').dataset.prediction,'none');
 assert.equal(state('LTC').dataset.prediction,'none');
 model.feedMode='demo';result.listeners.get('btc-market-update')();
 assert.equal(state('LTC').dataset.prediction,'none');
 model.feedMode='live';result.listeners.get('coin-change')();
 assert.equal(state('LTC').dataset.prediction,'none');
});

test('coin position markers refresh after an order, settlement, and logout',async()=>{
 const hour=Math.floor(1800000300/3600)*3600;
 const result=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:[{symbol:'BTC',name:'Bitcoin',product:'BTC-USD',precision:2,demoBase:100,enabled:1}]})}));
 const account=result.window.Predict60Account,button=result.buttons[0],refresh=result.listeners.get('account-update');
 assert.equal(button.dataset.prediction,'none');
 account.predictions=[{coin:'BTC',side:'down',mode:'contest',starts_at:hour,ends_at:hour+3600,settled_at:null}];
 refresh();assert.equal(button.dataset.prediction,'pending');
 account.predictions[0].settled_at=1800000300;
 refresh();assert.equal(button.dataset.prediction,'none');
 account.predictions[0].settled_at=null;
 refresh();assert.equal(button.dataset.prediction,'pending');
 account.user=null;refresh();assert.equal(button.dataset.prediction,'none');
});


test('duration prediction outlines follow the selected coin, saved directions and displayed hour',async()=>{
 const hour=Math.floor(1800000300/3600)*3600;
 const prediction=(coin,minutes,side,extra={})=>({coin,market_id:minutes+'-0',side,mode:'contest',starts_at:hour+(minutes===5?300:0),ends_at:hour+(minutes===5?600:minutes*60),settled_at:null,...extra});
 const records=['BTC','ETH'].map(symbol=>({symbol,name:symbol,product:symbol+'-USD',precision:2,demoBase:100,enabled:1}));
 const result=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:records})}),'crypto',{
  predictions:[prediction('BTC',15,'up'),prediction('BTC',5,'down'),prediction('BTC',30,'up'),prediction('BTC',30,'down'),
   prediction('ETH',60,'down'),prediction('BTC',60,'up',{mode:'practice'})]});
 const model=result.window.PredictModel,account=result.window.Predict60Account;
 const state=minutes=>result.durationButtons.find(button=>Number(button.dataset.detailDuration)===minutes);
 model.coin={symbol:'BTC'};result.listeners.get('coin-change')();
 assert.equal(state(15).dataset.prediction,'up');assert.equal(state(5).dataset.prediction,'down');
 assert.equal(state(30).dataset.prediction,'mixed');assert.equal(state(60).dataset.prediction,'none');
 assert.match(state(30).attributes['aria-label'],/BTC.*Up and Down predictions/);
 model.coin={symbol:'ETH'};result.listeners.get('coin-change')();
 assert.equal(state(60).dataset.prediction,'down');
 for(const minutes of [30,15,5])assert.equal(state(minutes).dataset.prediction,'none');
 account.predictions.push(prediction('ETH',5,'up'));result.listeners.get('account-update')();
 assert.equal(state(5).dataset.prediction,'up');
 account.predictions.at(-1).settled_at=hour+301;result.listeners.get('account-update')();
 assert.equal(state(5).dataset.prediction,'none','settled directions lose their outline');
 model.coin={symbol:'BTC'};result.tick((hour+900)*1000);
 assert.equal(state(15).dataset.prediction,'none','expired pending predictions lose their outline');
 assert.equal(state(30).dataset.prediction,'mixed');
 model.markets=[{minutes:60,startsAt:(hour+3600)*1000}];result.listeners.get('btc-market-update')();
 for(const button of result.durationButtons)assert.equal(button.dataset.prediction,'none');
 model.markets[0].startsAt=hour*1000;model.feedMode='demo';result.listeners.get('btc-market-update')();
 for(const button of result.durationButtons)assert.equal(button.dataset.prediction,'none');
 model.feedMode='live';account.user=null;result.listeners.get('account-update')();
 for(const button of result.durationButtons)assert.equal(button.dataset.prediction,'none');
});
