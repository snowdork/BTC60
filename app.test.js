const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');

test('segments expose prediction, result, and upcoming details actions without nested buttons',()=>{
  const markets=[{id:'60-0',minutes:60,status:'open'},{id:'30-0',minutes:30,status:'settled'},{id:'15-0',minutes:15,status:'queued'}].map(m=>({...m,start:'12:00',end:'13:00',strike:100,close:101}));
  const grid={innerHTML:'',querySelectorAll:()=>[]};
  const start=source.indexOf('function renderMarkets()');
  const end=source.indexOf('  /** Estimate the selected interval',start);
  vm.runInNewContext(source.slice(start,end)+';renderMarkets();',{
    markets,market:markets[0],$:()=>grid,marketElements:new Map(),window:{PredictModel:{coin:{feed:'coinbase'}}},
    outcome:()=> 'up',price:String,renderSegmentPredictions(){},renderChances(){}
  });
  assert.match(grid.innerHTML,/data-segment-action="60-0"[^>]*>[\s\S]*?<span class="segment-action-label">Predict<\/span><\/button>/);
  assert.match(grid.innerHTML,/data-segment-action="30-0"[^>]*>[\s\S]*?<span class="segment-action-label">Result<\/span><\/button>/);
  assert.match(grid.innerHTML,/data-segment-action="15-0"[^>]*>[\s\S]*?<span class="segment-action-label">Details<\/span><\/button>/);
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
