/** @module bootstrap
 * Load authenticated category and instrument configuration before starting the prediction terminal.
 */
(async()=>{
  const picker=document.querySelector('.coin-picker');
  try{
    await window.Predict60Account.loaded;
    // Do not request market configuration until the restored account is authenticated.
    if(!window.Predict60Account.user){location.replace('welcome.html');return;}
    if(location.protocol==='file:')throw Error('Open the terminal through python3 server.py, not a file preview.');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
    let response;try{response=await fetch('/api/coins',{signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timeout);}
    if(!response.ok||!response.headers.get('Content-Type')?.includes('application/json'))throw Error('Coin API unavailable. Run or restart python3 server.py and open http://127.0.0.1:8000/index.html.');
    const data=await response.json();
    const categoryId=new URLSearchParams(location.search||'').get('category')||'crypto';
    const categoryResponse=await fetch('/api/categories',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!categoryResponse.ok)throw Error('Market categories unavailable. Restart python3 server.py.');
    const category=(await categoryResponse.json()).categories.find(item=>item.id===categoryId);
    if(!category)throw Error('This category is unavailable. Choose another market from the category screen.');
    // Coming-soon categories never initialize a prediction terminal.
    if(category.availability==='coming_soon'){location.replace('categories.html');return;}
    window.Predict60Category=category;
    document.body.dataset.category=category.id;
    document.body.style.setProperty('--category-accent',category.accent);
    document.body.style.setProperty('--category-background',category.background);
    const categoryLink=document.getElementById('category-switch');
    categoryLink.textContent=`← ${category.name} / Categories`;
    picker.setAttribute('aria-label',`Choose ${category.name} instrument`);
    document.querySelector('.market-workspace').setAttribute('aria-label',`${category.name} markets`);
    window.Predict60MarketConfig=data.marketConfig;
    window.PredictCoins=window.PredictCoinCatalog.createCatalog(data.coins,category.id);
    if(!window.PredictCoins.available.length)throw Error('No instruments are currently available for predictions.');
    picker.replaceChildren(...window.PredictCoins.available.map(coin=>{
      const button=document.createElement('button');button.type='button';button.className='coin-button';button.dataset.coin=coin.symbol;button.setAttribute('aria-label',`Select ${coin.name}`);button.setAttribute('aria-pressed','false');button.title=`${coin.name} (${coin.symbol})`;
      if(coin.icon){const icon=document.createElement('img');icon.src=coin.icon;icon.alt='';icon.width=24;icon.height=24;icon.addEventListener('error',()=>{icon.hidden=true;});button.append(icon);}
      const label=document.createElement('span');label.textContent=coin.symbol;button.append(label);return button;
    }));
    const coinButtons=[...picker.querySelectorAll('[data-coin]')];
    const hourlyPredictions=new Map();
    /** Index contest directions by hour when account data changes, including settled orders. */ function updateCoinPredictions(){
      hourlyPredictions.clear();
      const account=window.Predict60Account;
      for(const prediction of account.user?account.predictions||[]:[]){
        if(prediction.mode!=='contest'||!Number.isFinite(prediction.starts_at))continue;
        if(prediction.side!=='up'&&prediction.side!=='down')continue;
        const hour=Math.floor(prediction.starts_at/3600)*3600;
        if(!hourlyPredictions.has(hour))hourlyPredictions.set(hour,new Map());
        const states=hourlyPredictions.get(hour);
        states.set(prediction.coin,(states.get(prediction.coin)||0)|(prediction.side==='up'?1:2));
      }
      renderCoinPredictions();
    }
    /** Show predictions for the displayed hour independently of the selected coin's inner highlight. */ function renderCoinPredictions(){
      const model=window.PredictModel;
      const displayedStart=model?.markets?.find(m=>m.minutes===60)?.startsAt;
      const hour=Number.isFinite(displayedStart)?displayedStart/1000:Math.floor(Date.now()/3600000)*3600;
      const states=model?.feedMode==='demo'?null:hourlyPredictions.get(hour);
      for(const button of coinButtons){
        const state=states?.get(button.dataset.coin)||0;
        const direction=state===3?'Up and Down':state===1?'Up':state===2?'Down':'';
        const coin=window.PredictCoins.getCoin(button.dataset.coin);
        const marker=state===3?'mixed':state===1?'up':state===2?'down':'none';
        if(button.dataset.prediction===marker)continue;
        button.dataset.prediction=marker;
        const detail=direction?` · ${direction} prediction${state===3?'s':''} in this hour`:'';
        button.title=`${coin.name} (${coin.symbol})${detail}`;
        button.setAttribute('aria-label',`Select ${coin.name}${detail}`);
      }
    }
    window.addEventListener('account-update',updateCoinPredictions);
    window.addEventListener('btc-market-update',renderCoinPredictions);
    window.addEventListener('coin-change',renderCoinPredictions);
    updateCoinPredictions();
    const coinPredictionTimer=setInterval(renderCoinPredictions,1000);
    window.addEventListener('pagehide',()=>clearInterval(coinPredictionTimer),{once:true});
    for(const src of ['market-model.js','app.js','btc-chart.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=/** Handle the load event for the current transport or resource. */ ()=>{try{if(src==='market-model.js')window.PredictModel.configure(window.Predict60MarketConfig);resolve();}catch(error){reject(error);}};script.onerror=/** Handle the error event for the current transport or resource. */ ()=>reject(Error('Unable to load the terminal.'));document.head.append(script);});
  }catch(error){
    picker.textContent='Markets unavailable';
    const connectionError=error instanceof TypeError||error.name==='AbortError'||error instanceof SyntaxError;
    document.getElementById('chart-empty').textContent=connectionError?'Cannot reach the coin database. Run python3 server.py, then open http://127.0.0.1:8000/index.html.':error.message;
    document.getElementById('btc-change').textContent='Database connection unavailable';
    document.getElementById('workspace-clock').textContent='Terminal offline';
    document.getElementById('hour-remaining').textContent='Start the local app server';
    document.getElementById('selected-state').textContent='OFFLINE';
    document.getElementById('selected-state').className='badge amber';
    document.getElementById('selected-countdown').textContent='Coin catalog unavailable';
    document.getElementById('chart-source').textContent='Database API required';
    document.getElementById('submit-prediction').textContent='Terminal unavailable';
    document.getElementById('startup-help').hidden=false;
    document.getElementById('startup-retry').addEventListener('click',()=>location.reload());
    ['feed-retry','demo-preview','chart-pause'].forEach(id=>document.getElementById(id).disabled=true);
    document.getElementById('submit-prediction').disabled=true;document.getElementById('feed-status').textContent='UNAVAILABLE';
  }
})();
