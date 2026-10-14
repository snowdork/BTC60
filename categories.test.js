const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

async function selection(feedState='setup_required',tick={price:72.25,time:Date.now()}){
 const nodes=new Map(),calls=[];
 const node=()=>({children:[],dataset:{},style:{setProperty(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(){},removeAttribute(name){delete this[name];}});
 const element=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const category={id:'oil',name:'Oil',description:'Five crudes',provider:'Twelve Data',quoteCadence:'Minute updates',unit:'USD/barrel',feedState,instrumentCount:2,instruments:[{symbol:'WTI',name:'West Texas Intermediate',liveSupported:true},{symbol:'DUBAI',name:'Dubai',liveSupported:false}]};
 const fetch=async url=>{calls.push(url);return {ok:true,json:async()=>url==='/api/categories'?{categories:[category]}:tick};};
 await vm.runInNewContext(fs.readFileSync('categories.js','utf8'),{document:{hidden:false,getElementById:element,createElement:node,addEventListener(){}},fetch,AbortSignal,Intl,Date,Map,Promise,Number,Error,encodeURIComponent,setInterval(){},location:{reload(){}}});
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
