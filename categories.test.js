const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

async function selection(feedState='setup_required',tick={price:72.25,time:Date.now()},override={}){
 const nodes=new Map(),calls=[];
 const node=()=>({children:[],dataset:{},style:{setProperty(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(){},setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];}});
 const element=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const category={id:'oil',name:'Oil',description:'Five crudes',provider:'Twelve Data',quoteCadence:'Minute updates',unit:'USD/barrel',feedState,instrumentCount:2,instruments:[{symbol:'WTI',name:'West Texas Intermediate',liveSupported:true},{symbol:'DUBAI',name:'Dubai',liveSupported:false}]};
 Object.assign(category,override);
 const fetch=async url=>{calls.push(url);return {ok:true,json:async()=>url==='/api/categories'?{categories:[category]}:tick};};
 await vm.runInNewContext(fs.readFileSync('categories.js','utf8'),{window:{Predict60Account:{loaded:Promise.resolve(),user:{}}},document:{hidden:false,getElementById:element,createElement:node,addEventListener(){}},fetch,AbortSignal,Intl,Date,Map,Promise,Number,Error,encodeURIComponent,setInterval(){},location:{reload(){}}});
 await new Promise(resolve=>setImmediate(resolve));
 return {nodes,calls,card:element('category-options').children[0]};
}
test('category screen shows pending connection and unavailable grades without fake quotes',async()=>{
 const {card,calls}=await selection();
 assert.equal(card.href,'index.html?category=oil');
 assert.equal(card.children[4].textContent,'Live feed awaiting connection');
 assert.equal(card.children[5].children[0].children[1].textContent,'Awaiting connection');
 assert.equal(card.children[5].children[1].children[1].textContent,'No live feed');
 assert.deepEqual(calls,['/api/categories']);
});
test('configured category shows a real quote and preserves its source timestamp',async()=>{
 const {card,calls}=await selection('configured');
 const price=card.children[5].children[0].children[1];
 assert.equal(price.textContent,'$72.25');
 assert.equal(price.dataset.state,'live');
 assert.match(price.title,/Source update/);
 assert.deepEqual(calls,['/api/categories','/api/spot?coin=WTI']);
});
test('stale category quote is displayed as unavailable',async()=>{
 const {card}=await selection('configured',{price:72,time:Date.now()-100000});
 assert.equal(card.children[5].children[0].children[1].textContent,'Unavailable');
});

test('dated spot assessments remain visible without being labeled live ticks',async()=>{
 const {card}=await selection('configured',{price:72,time:Date.now()-7*86400000,quoteKind:'assessment',tradable:false});
 const price=card.children[5].children[0].children[1];
 assert.match(price.textContent,/\$72\.00 · \d{4}-\d{2}-\d{2}/);
 assert.equal(price.dataset.state,'assessment');
});

test('guests cannot load market choices or quotes',async()=>{
 await vm.runInNewContext(fs.readFileSync('categories.js','utf8'),{
  window:{Predict60Account:{loaded:Promise.resolve(),user:null}},
  fetch(){assert.fail('Guest must not request markets');},
  document:{getElementById(){assert.fail('Guest must not render markets');}}
 });
});

test('weather coming soon card has no market link or quote requests',async()=>{
 const {card,calls}=await selection('coming_soon',{}, {id:'weather',name:'Weather',availability:'coming_soon',cities:[{name:'New York'}],instruments:[]});
 assert.equal(card.href,undefined);
 assert.equal(card.dataset.availability,'coming_soon');
 assert.equal(card.children.at(-1).textContent,'Coming soon');
 assert.match(card.children[6].textContent,/Temperature/);
 assert.deepEqual(calls,['/api/categories']);
});

test('oil coming soon card has no market link or quote requests',async()=>{
 const {card,calls}=await selection('configured',{}, {availability:'coming_soon',tradable:false});
 assert.equal(card.href,undefined);
 assert.equal(card.dataset.availability,'coming_soon');
 assert.equal(card.children.at(-1).textContent,'Coming soon');
 assert.match(card.children[4].textContent,/paused until the data feed is ready/);
 assert.match(card.children[6].textContent,/data feed integration in progress/);
 assert.deepEqual(calls,['/api/categories']);
});
