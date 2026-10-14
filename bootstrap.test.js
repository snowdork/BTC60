const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {createCatalog}=require('./coins.js');
async function run(protocol,fetch,category='crypto'){
 const elements=new Map(),loaded=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'Connecting…',hidden:true,addEventListener(){},append(){},replaceChildren(){},setAttribute(){},dataset:{}});return elements.get(id);};
 const document={body:{dataset:{},style:{setProperty(){}}},getElementById:element,querySelector:()=>element('picker'),createElement:()=>({dataset:{},setAttribute(){},addEventListener(){},append(){}}),head:{append(script){loaded.push(script.src);script.onload();}}};
 const context={document,location:{protocol,search:'?category='+category,reload(){}},window:{PredictCoinCatalog:{createCatalog},PredictModel:{configure(){}}},fetch:async(url,...args)=>url==='/api/categories'?{ok:true,json:async()=>({categories:[{id:'crypto',name:'Crypto'},{id:'oil',name:'Oil'}]})}:fetch(url,...args),URLSearchParams,AbortSignal,AbortController,setTimeout,clearTimeout,Error,TypeError,SyntaxError};
 await vm.runInNewContext(fs.readFileSync('bootstrap.js','utf8'),context);
 return {elements,loaded,window:context.window,document};
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
