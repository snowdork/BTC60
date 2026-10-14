const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCatalog}=require('./coins.js');
const records=[{symbol:'TEST',name:'Test coin',product:'TEST-USD',precision:5,demoBase:.1,icon:'',enabled:1},{symbol:'OLD',name:'Old coin',product:'OLD-USD',precision:3,demoBase:100,icon:'',enabled:0}];
test('catalog uses supplied database records without a fixed coin list',()=>{const catalog=createCatalog(records);assert.deepEqual(catalog.available.map(c=>c.symbol),['TEST']);assert.equal(catalog.getCoin('OLD').name,'Old coin');assert.equal(catalog.getCoin('unknown').symbol,'TEST');assert(Object.isFrozen(catalog.coins));});
test('formatting uses each database precision',()=>{const catalog=createCatalog(records);assert.equal(catalog.formatPrice(.08531,'TEST'),'$0.08531');assert.equal(catalog.formatPrice(110.171,'OLD'),'$110.171');assert.equal(catalog.formatPrice(NaN,'TEST'),'—');});
test('empty and invalid catalogs are handled',()=>{assert.equal(createCatalog([]).available.length,0);assert.throws(()=>createCatalog(null));assert.throws(()=>createCatalog([{...records[0],precision:100}]));});

test('category selection isolates instruments without truncating another category',()=>{
 const oil=Array.from({length:5},(_,i)=>({...records[0],symbol:'OIL'+i,category:'oil',feed:'simulated',unit:'USD/barrel'}));
 const crypto=Array.from({length:8},(_,i)=>({...records[0],symbol:'CRYPTO'+i,category:'crypto'}));
 assert.equal(createCatalog([...oil,...crypto],'crypto').available.length,8);
 const catalog=createCatalog([...crypto,...oil],'oil');
 assert.equal(catalog.available.length,5);
 assert(catalog.available.every(c=>c.feed==='simulated'&&c.category==='oil'));
 assert.equal(createCatalog([...crypto,...oil],'missing').available.length,0);
});
