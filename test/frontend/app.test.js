const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/app.js'),'utf8');

test('segments expose prediction, result, and upcoming details actions without nested buttons',()=>{
  const markets=[{id:'60-0',minutes:60,status:'open'},{id:'30-0',minutes:30,status:'settled'},{id:'15-0',minutes:15,status:'queued'}].map(m=>({...m,start:'12:00',end:'13:00',strike:100,close:101}));
  const icons=[{},{},{}];
  const grid={innerHTML:'',querySelectorAll:selector=>selector==='.tier-coin-icon'?icons:[]};
  const start=source.indexOf('function renderMarkets()');
  const end=source.indexOf('  /** Estimate the selected interval',start);
  vm.runInNewContext(source.slice(start,end)+';renderMarkets();',{
    markets,market:markets[0],$:()=>grid,marketElements:new Map(),window:{PredictModel:{coin:{feed:'coinbase',icon:'assets/coins/eth.svg',symbol:'ETH'}}},
    outcome:()=> 'up',price:String,renderSegmentPredictions(){},renderChances(){}
  });
  assert.match(grid.innerHTML,/data-segment-action="60-0"[^>]*>[\s\S]*?<span class="segment-action-label">Predict<\/span><\/button>/);
  assert.match(grid.innerHTML,/data-segment-action="30-0"[^>]*>[\s\S]*?<span class="segment-action-label">Result<\/span><\/button>/);
  assert.match(grid.innerHTML,/data-segment-action="15-0"[^>]*>[\s\S]*?<span class="segment-action-label">Details<\/span><\/button>/);
  for(const minutes of [60,30,15])assert.ok(grid.innerHTML.includes(`<span>${minutes}m</span>`));
  assert.ok(icons.every(icon=>icon.src==='assets/coins/eth.svg'&&icon.alt==='ETH'));
  assert.equal((grid.innerHTML.match(/<button/g)||[]).length,3);
  assert.equal((grid.innerHTML.match(/aria-controls="prediction-dialog"/g)||[]).length,3);
});

test('segment action selects its market and opens the popup',()=>{
  const start=source.indexOf("$('market-grid').addEventListener('click'");
  const end=source.indexOf('  let directionHintTimer;',start);
  let click,rendered=0,opened=0;
  const dialog={open:false,showModal(){this.open=true;opened++;}};
  const selected={id:'30-0'};
  const context={markets:[selected],market:null,side:'up',review:{},marketElements:new Map(),renderTicket(){rendered++;},
    $:id=>id==='market-grid'?{addEventListener(_,fn){click=fn;}}:id==='prediction-dialog'?dialog:{close(){}}};
  vm.runInNewContext(source.slice(start,end),context);
  click({target:{closest:selector=>selector==='[data-market]'?{dataset:{market:'30-0'}}:{}}});
  assert.equal(context.market,selected);
  assert.equal(context.side,null);
  assert.equal(rendered,1);
  assert.equal(opened,1);
});

test('last-hour winner badge requires a finalized first-place result and clears on other states',()=>{
  const start=source.indexOf('function renderLastHourScore()');
  const end=source.indexOf('  /** Render account from',start);
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{style:{},hidden:true});return nodes.get(id);};
  const account={user:{id:1},lastHourContest:{starts_at:1800000000,ends_at:1800003600,state:'final',rank:1,score_cents:27073}};
  const context={account,$:get};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  const render=()=>vm.runInContext('renderLastHourScore()',context);
  render();assert.equal(get('last-hour-winner').hidden,false);
  assert.match(get('last-hour-score').textContent,/270.73 credits/);
  account.lastHourContest.state='awaiting_settlement';render();assert.equal(get('last-hour-winner').hidden,true);
  account.lastHourContest.state='final';account.lastHourContest.rank=2;render();assert.equal(get('last-hour-winner').hidden,true);
  account.lastHourContest=null;render();assert.equal(get('last-hour-winner').hidden,true);
});

test('reused hourly winnings allow further orders in an interval up to the per-prediction cap',()=>{
  const start=source.indexOf('function budgetAvailable(');
  const end=source.indexOf('  /** Show a transient',start);
  const market={startsAt:1800000000000,endsAt:1800003600000};
  const context={available:1500,market,maxPredictionCredits:1000,
    account:{predictions:[{coin:'BTC',mode:'contest',starts_at:1800000000,ends_at:1800003600,cost_cents:100000}]},
    window:{PredictModel:{coin:{symbol:'BTC'}}}};
  context.balance=()=>context.available;
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  assert.equal(vm.runInContext('budgetAvailable()',context),1000);
  context.available=275.25;
  assert.equal(vm.runInContext('budgetAvailable()',context),275.25);
  context.available=0;
  assert.equal(vm.runInContext('budgetAvailable()',context),0);
});

test('countdown updates visit pending predictions without scanning settled history',()=>{
  const start=source.indexOf('function renderPendingTimes()');
  const end=source.indexOf('  /** Render positions',start);
  const label={textContent:''},lookups=[];
  const pending={id:'pending',start:'12:00',end:'13:00',starts_at:1800000000,ends_at:1800003600};
  const history=Array.from({length:10000},()=>({get settled_at(){throw Error('Countdown scanned settled history');}}));
  const context={positions:history,pendingPositions:[pending],document:{hidden:false,getElementById:id=>{lookups.push(id);return label;}}};
  vm.runInNewContext(source.slice(start,end)+';renderPendingTimes();',context);
  assert.deepEqual(lookups,['pending-time-pending']);
  assert.match(label.textContent,/12:00–13:00 UTC/);
  assert.match(label.textContent,/left|Awaiting settlement/);
});

test('account updates refresh pending countdowns and remove settled or signed-out predictions',()=>{
  const start=source.indexOf('function renderAccount()');
  const end=source.indexOf("  window.addEventListener('account-update'",start);
  const prediction={id:'one',coin:'BTC',market_id:'60-0',mode:'contest',starts_at:1800000000,ends_at:1800003600,cost_cents:100,settled_at:null};
  const context={account:{user:{id:1},predictions:[prediction]},pendingPositions:[],predictionIndex:new Map(),
    predictionKey:(...parts)=>parts.join(':'),$:()=>({}),renderLastHourScore(){},renderSegmentPredictions(){},renderPositions(){},renderTicket(){}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  context.renderAccount();assert.equal(context.pendingPositions.length,1);
  assert.equal(context.pendingPositions[0].id,'one');
  prediction.settled_at=1800003601;
  context.renderAccount();assert.equal(context.pendingPositions.length,0);
  assert.equal(context.predictionIndex.size,1,'settled results remain available in the segment index');
  context.account.user=null;
  context.renderAccount();assert.equal(context.pendingPositions.length,0);
  assert.equal(context.predictionIndex.size,0);
});

test('pending and upcoming cards omit unavailable prices, movement, odds and countdowns',()=>{
  const markets=['queued','settled'].map((status,i)=>({id:`15-${i}`,minutes:15,status,start:'12:00',end:'12:15',strike:100,close:null}));
  const grid={innerHTML:'',querySelectorAll:()=>[]};
  const start=source.indexOf('function renderMarkets()'),end=source.indexOf('  /** Estimate the selected interval',start);
  vm.runInNewContext(source.slice(start,end)+';renderMarkets();',{
    markets,market:markets[0],$:()=>grid,marketElements:new Map(),outcome(){throw Error('No result without close');},
    price:String,renderSegmentPredictions(){},renderChances(){}
  });
  for(const content of ['segment-price-row','segment-odds','data-direction-indicator','segment-countdown'])assert.equal(grid.innerHTML.includes(content),false,content);
  assert.match(grid.innerHTML,/UPCOMING/);assert.match(grid.innerHTML,/PENDING/);
  assert.equal((grid.innerHTML.match(/class="card-time"/g)||[]).length,2);
  assert.equal((grid.innerHTML.match(/class="segment-action"/g)||[]).length,2);
});

test('segment refresh preserves stable DOM values and clears stale live movement',()=>{
  let writes=0;
  const node=()=>{
    const values={textContent:'',className:'',hidden:true},attrs=new Map();
    const element={dataset:new Proxy({},{set(target,key,value){writes++;target[key]=value;return true;}}),
      getAttribute:key=>attrs.get(key),setAttribute(key,value){writes++;attrs.set(key,value);}};
    for(const key of Object.keys(values))Object.defineProperty(element,key,{get:()=>values[key],set:value=>{writes++;values[key]=value;}});
    return element;
  };
  const nodes=()=>Object.fromEntries(['price','up','down','direction','change','arrow','reference'].map(key=>[key,node()]));
  const open={id:'open',status:'open',strike:100},settled={id:'settled',status:'settled',strike:100,close:99};
  const live=nodes(),closed=nodes(),marketElements=new Map([['open',live],['settled',closed]]);
  const model={coin:{feed:'coinbase'},feedMode:'live',feedConnection:'connected',priceUpdatedAt:100000,spot:101,
    dataStatus:()=>({ready:true}),estimateChances:m=>m.status==='settled'?{up:0,down:100}:{up:60,down:40}};
  const start=source.indexOf('function renderChances()'),end=source.indexOf('  /** Render segment predictions',start);
  const context={window:{PredictModel:model},markets:[open,settled,{id:'queued'}],marketElements,Date:{now:()=>100000},
    renderStatusLine(){},renderExecutionState(){},renderReviewChance(){},price:String,
    setText(element,value){if(element.textContent!==value)element.textContent=value;}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const render=()=>vm.runInContext('renderChances()',context);
  render();assert.equal(live.price.textContent,'101');assert.equal(live.price.dataset.direction,'up');
  assert.equal(live.change.textContent,'Up +1.00%');assert.equal(closed.price.dataset.direction,'down');
  const initialWrites=writes;render();assert.equal(writes,initialWrites,'Unchanged ticks must not rewrite DOM attributes');
  model.feedConnection='disconnected';render();assert.equal(live.price.textContent,'—');assert.equal(live.direction.hidden,true);
  assert.equal(live.price.dataset.direction,'');assert.equal(closed.price.textContent,'99');assert.equal(closed.direction.hidden,false);
});

test('mixed completed results style win and loss separately and clear on pending state',()=>{
  const element=()=>({children:[],classList:{toggle(){}},removeAttribute(){},setAttribute(){},
    replaceChildren(...children){this.children=children;},set textContent(value){this.children=[value];},
    get textContent(){return this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}});
  const stamp=element(),container=element();
  const saved=[{settled_at:1,outcome:'up',side:'up',cost_cents:10000,payout_cents:15152,cents:50},
    {settled_at:1,outcome:'up',side:'down',cost_cents:25000,payout_cents:0,cents:50}];
  const start=source.indexOf('function renderSegmentPredictions()'),end=source.indexOf('  /** Render markets',start);
  const context={markets:[{id:'15-0',status:'settled'}],marketElements:new Map([['15-0',{predictions:container,card:{querySelector:()=>stamp}}]]),
    segmentPredictions:()=>saved,document:{createElement:element},currency:{format:value=>value.toFixed(2)},money:value=>value.toFixed(2)+' credits'};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const render=()=>vm.runInContext('renderSegmentPredictions()',context);
  render();assert.deepEqual(Array.from(stamp.children,child=>child.textContent),['Win +51.52','Loss −250.00']);
  assert.equal(stamp.children[0].className,'segment-win');assert.equal(stamp.children[1].className,'segment-loss');
  saved[0].settled_at=null;render();assert.equal(stamp.textContent,'Awaiting settlement');assert.equal(stamp.children.length,1);
  saved.length=0;render();assert.equal(stamp.textContent,'No wager');
});

test('NO CREDITS banner follows the signed-in balance and hides on read-only intervals',()=>{
  const banner={hidden:true},account={ready:true,user:{id:1}};
  let credits=0;
  const context={account,market:{status:'open'},balance:()=>credits,$:()=>banner};
  const start=source.indexOf('function renderCreditState()'),end=source.indexOf('  /** Render execution state',start);
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const render=()=>vm.runInContext('renderCreditState()',context);
  assert.equal(render(),true);assert.equal(banner.hidden,false);
  credits=1000;assert.equal(render(),false);assert.equal(banner.hidden,true);
  credits=0;account.ready=false;assert.equal(render(),false);
  account.ready=true;account.user=null;assert.equal(render(),false);
  account.user={id:1};context.market.status='settled';assert.equal(render(),false);
  context.market.status='queued';assert.equal(render(),false);
});
