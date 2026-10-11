const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {createCatalog}=require('./coins.js');
async function run(protocol,fetch){
 const elements=new Map(),loaded=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'Connecting…',hidden:true,addEventListener(){},append(){},replaceChildren(){},setAttribute(){},dataset:{}});return elements.get(id);};
 const document={getElementById:element,querySelector:()=>element('picker'),createElement:()=>({dataset:{},setAttribute(){},addEventListener(){},append(){}}),head:{append(script){loaded.push(script.src);script.onload();}}};
 const context={document,location:{protocol,reload(){}},window:{RolrCoinCatalog:{createCatalog}},fetch,AbortController,setTimeout,clearTimeout,Error,TypeError,SyntaxError};
 await vm.runInNewContext(fs.readFileSync('bootstrap.js','utf8'),context);
 return {elements,loaded};
}
test('file preview shows actionable offline state instead of Connecting',async()=>{const {elements,loaded}=await run('file:',()=>assert.fail('Must not fetch from file URLs'));assert.equal(elements.get('startup-help').hidden,false);assert.equal(elements.get('workspace-clock').textContent,'Terminal offline');assert.equal(elements.get('submit-prediction').disabled,true);assert.equal(loaded.length,0);});
test('network errors and static-server HTML stop startup clearly',async()=>{for(const fetch of [async()=>{throw new TypeError('NetworkError');},async()=>({ok:true,headers:{get:()=> 'text/html'}})]){const {elements,loaded}=await run('http:',fetch);assert.match(elements.get('chart-empty').textContent,/server.py/);assert.equal(elements.get('feed-status').textContent,'UNAVAILABLE');assert.equal(loaded.length,0);}});
test('database catalog loads before terminal scripts',async()=>{const {elements,loaded}=await run('http:',async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({coins:[{symbol:'TEST',name:'Test',product:'TEST-USD',precision:2,demoBase:100,enabled:1,icon:''}]})}));assert.deepEqual(loaded,['market-model.js','app.js','btc-chart.js']);assert.equal(elements.has('startup-help'),false);});
