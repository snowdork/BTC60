const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCatalog}=require('../../src/frontend/coins.js');
const records=[{symbol:'TEST',name:'Test coin',product:'TEST-USD',precision:5,demoBase:.1,icon:'',enabled:1},{symbol:'OLD',name:'Old coin',product:'OLD-USD',precision:3,demoBase:100,icon:'',enabled:0}];
test('catalog uses supplied database records without a fixed coin list',()=>{const catalog=createCatalog(records);assert.deepEqual(catalog.available.map(c=>c.symbol),['TEST']);assert.equal(catalog.getCoin('OLD').name,'Old coin');assert.equal(catalog.getCoin('unknown').symbol,'TEST');assert(Object.isFrozen(catalog.coins));});
test('formatting uses each database precision',()=>{const catalog=createCatalog(records);assert.equal(catalog.formatPrice(.08531,'TEST'),'$0.08531');assert.equal(catalog.formatPrice(110.171,'OLD'),'$110.171');assert.equal(catalog.formatPrice(NaN,'TEST'),'—');});
test('empty and invalid catalogs are handled',()=>{assert.equal(createCatalog([]).available.length,0);assert.throws(()=>createCatalog(null));assert.throws(()=>createCatalog([{...records[0],precision:100}]));});

test('category selection isolates instruments without truncating another category',()=>{
 const oil=Array.from({length:5},(_,i)=>({...records[0],symbol:'OIL'+i,category:'oil',feed:'simulated',unit:'USD/barrel'}));
 const crypto=Array.from({length:10},(_,i)=>({...records[0],symbol:'CRYPTO'+i,category:'crypto'}));
 assert.equal(createCatalog([...oil,...crypto],'crypto').available.length,10);
 const catalog=createCatalog([...crypto,...oil],'oil');
 assert.equal(catalog.available.length,5);
 assert(catalog.available.every(c=>c.feed==='simulated'&&c.category==='oil'));
 assert.equal(createCatalog([...crypto,...oil],'missing').available.length,0);
});

test('default catalog contains ten tradable coins with local icons',()=>{
 const seed=require('../../src/seeds/coins.seed.json');
 const catalog=createCatalog(seed);
 assert.deepEqual(catalog.available.map(c=>c.symbol).sort(),['ADA','AVAX','BTC','DOGE','ETH','LINK','LTC','SOL','SUI','XRP']);
 const fs=require('node:fs'),path=require('node:path');
 assert(catalog.available.every(coin=>fs.existsSync(path.join(__dirname,'../../src/frontend',coin.icon))));
});

test('reused formatters preserve every supported precision and missing-price behavior',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 let created=0;
 class CountingFormatter extends Intl.NumberFormat{constructor(...args){super(...args);created++;}}
 const context={module:{exports:{}},Intl:{NumberFormat:CountingFormatter}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/frontend/coins.js'),'utf8'),context);
 const inputs=Array.from({length:13},(_,precision)=>({...records[0],symbol:'P'+precision,precision}));
 const catalog=context.module.exports.createCatalog(inputs);
 for(let repeat=0;repeat<3;repeat++)for(const coin of inputs){
  for(const value of [0,-0,.000000123456789,67450.125,-1245.555,1e12]){
   assert.equal(catalog.formatPrice(value,coin.symbol),value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:coin.precision,maximumFractionDigits:coin.precision}));
  }
 }
 assert.equal(created,13,'formatter construction is bounded by precision, not price ticks');
 for(const value of [NaN,Infinity,-Infinity,null,undefined,'1'])assert.equal(catalog.formatPrice(value,'P2'),'—');
 assert.equal(created,13);
 assert.equal(catalog.formatPrice(12.5,'unknown'),catalog.formatPrice(12.5,'P0'));
 assert.equal(context.module.exports.createCatalog([]).formatPrice(12.5,'unknown'),'$12.50');
});
