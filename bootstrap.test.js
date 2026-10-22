const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {createCatalog}=require('./coins.js');
const pageIds=new Set([...fs.readFileSync('index.html','utf8').matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
async function run(protocol,fetch,category='crypto',accountOptions={}){
 const elements=new Map(),loaded=[],buttons=[],listeners=new Map(),timers=[];
 let now=1800000300000;
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'Connecting…',hidden:true,addEventListener(){},append(){},replaceChildren(...children){buttons.push(...children);},querySelectorAll(){return buttons;},setAttribute(){},dataset:{}});return elements.get(id);};
 const document={body:{dataset:{},style:{setProperty(){}}},getElementById:id=>pageIds.has(id)?element(id):null,querySelector:()=>element('picker'),createElement:()=>({dataset:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;},addEventListener(){},append(){}}),head:{append(script){loaded.push(script.src);script.onload();}}};
 const context={document,location:{protocol,search:'?category='+category,reload(){}},window:{addEventListener(name,handler){listeners.set(name,handler);},Predict60Account:{loaded:Promise.resolve(),user:{},predictions:[],...accountOptions},PredictCoinCatalog:{createCatalog},PredictModel:{configure(){}}},fetch:async(url,...args)=>url==='/api/categories'?{ok:true,json:async()=>({categories:[{id:'crypto',name:'Crypto'},{id:'oil',name:'Oil'}]})}:fetch(url,...args),URLSearchParams,AbortSignal,AbortController,setTimeout,clearTimeout,setInterval(handler){timers.push(handler);return timers.length;},clearInterval(){},Date:{now:()=>now},Error,TypeError,SyntaxError};
 await vm.runInNewContext(fs.readFileSync('bootstrap.js','utf8'),context);
 return {elements,loaded,window:context.window,document,buttons,listeners,tick(value){now=value;timers.forEach(handler=>handler());}};
}
test('file preview shows actionable offline state instead of Connecting',async()=>{const {elements,loaded}=await run('file:',()=>assert.fail('Must not fetch from file URLs'));assert.equal(elements.get('startup-help').hidden,false);assert.equal(elements.get('workspace-clock').textContent,'Terminal offline');assert.equal(elements.get('submit-prediction').disabled,true);assert.equal(loaded.length,0);});
test('network errors and static-server HTML stop startup clearly',async()=>{for(const fetch of [async()=>{throw new TypeError('NetworkError');},async()=>({ok:true,headers:{get:()=> 'text/html'}})]){const {elements,loaded}=await run('http:',fetch);assert.match(elements.get('chart-empty').textContent,/server.py/);assert.equal(elements.get('feed-status').textContent,'UNAVAILABLE');assert.equal(loaded.length,0);}});
test('database catalog loads before terminal scripts',async()=>{const {elements,loaded}=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:[{symbol:'TEST',name:'Test',product:'TEST-USD',precision:2,demoBase:100,enabled:1,icon:''}]})}));assert.deepEqual(loaded,['market-model.js','app.js','btc-chart.js']);assert.equal(elements.has('startup-help'),false);});

test('oil category configures the same framework with only oil instruments',async()=>{
 const {window,document,loaded}=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:[{symbol:'BTC',name:'Bitcoin',product:'BTC-USD',precision:2,demoBase:100,enabled:1},{symbol:'WTI',name:'WTI',product:'SIM-WTI',precision:2,demoBase:72,enabled:1,category:'oil',feed:'simulated'}]})}),'oil');
 assert.equal(document.body.dataset.category,'oil');
 assert.equal(window.PredictCoins.available.length,1);
 assert.equal(window.PredictCoins.available[0].symbol,'WTI');
 assert.deepEqual(loaded,['market-model.js','app.js','btc-chart.js']);
});

test('hourly coin rings retain settled directions and reset with the displayed hour',async()=>{
 const now=1800000300,hour=Math.floor(now/3600)*3600;
 const order=(coin,side,extra={})=>({coin,side,mode:'contest',starts_at:hour,ends_at:hour+3600,settled_at:null,...extra});
 const records=['BTC','ETH','SOL','XRP','ADA','LTC'].map(symbol=>({symbol,name:symbol,product:symbol+'-USD',precision:2,demoBase:100,enabled:1}));
 const account={predictions:[order('BTC','up'),order('ETH','down'),order('SOL','up'),order('SOL','down'),
  order('XRP','up',{settled_at:now-1}),order('ADA','up',{mode:'practice'}),
  order('LTC','up',{starts_at:hour-3600,ends_at:hour}),order('LTC','down',{starts_at:now+100})]};
 const result=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:records})}),'crypto',account);
 const state=symbol=>result.buttons.find(button=>button.dataset.coin===symbol);
 assert.equal(state('BTC').dataset.prediction,'up');
 assert.equal(state('ETH').dataset.prediction,'down');
 assert.equal(state('SOL').dataset.prediction,'mixed');
 assert.equal(state('XRP').dataset.prediction,'up');
 assert.equal(state('ADA').dataset.prediction,'none');
 assert.equal(state('LTC').dataset.prediction,'down');
 assert.match(state('SOL').attributes['aria-label'],/Up and Down predictions in this hour/);
 result.tick((now+100)*1000);
 assert.equal(state('LTC').dataset.prediction,'down');
 result.tick((hour+3600)*1000);
 for(const button of result.buttons)assert.equal(button.dataset.prediction,'none');
 assert.doesNotMatch(state('BTC').attributes['aria-label'],/prediction/);
 const model=result.window.PredictModel;
 model.markets=[{minutes:60,startsAt:hour*1000}];
 result.listeners.get('btc-market-update')();
 assert.equal(state('BTC').dataset.prediction,'up');
 assert.equal(state('XRP').dataset.prediction,'up');
 model.markets[0].startsAt=(hour-3600)*1000;
 result.listeners.get('btc-market-update')();
 assert.equal(state('BTC').dataset.prediction,'none');
 assert.equal(state('LTC').dataset.prediction,'up');
 model.feedMode='demo';result.listeners.get('btc-market-update')();
 assert.equal(state('LTC').dataset.prediction,'none');
 model.feedMode='live';result.listeners.get('coin-change')();
 assert.equal(state('LTC').dataset.prediction,'up');
});

test('coin position markers refresh after an order, settlement, and logout',async()=>{
 const hour=Math.floor(1800000300/3600)*3600;
 const result=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:[{symbol:'BTC',name:'Bitcoin',product:'BTC-USD',precision:2,demoBase:100,enabled:1}]})}));
 const account=result.window.Predict60Account,button=result.buttons[0],refresh=result.listeners.get('account-update');
 assert.equal(button.dataset.prediction,'none');
 account.predictions=[{coin:'BTC',side:'down',mode:'contest',starts_at:hour,ends_at:hour+3600,settled_at:null}];
 refresh();assert.equal(button.dataset.prediction,'down');
 account.predictions[0].settled_at=1800000300;
 refresh();assert.equal(button.dataset.prediction,'down');
 account.predictions[0].settled_at=null;
 refresh();assert.equal(button.dataset.prediction,'down');
 account.user=null;refresh();assert.equal(button.dataset.prediction,'none');
});
