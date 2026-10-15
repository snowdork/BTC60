(async()=>{
  const picker=document.querySelector('.coin-picker');
  try{
    await window.BTC60Account.loaded;
    if(!window.BTC60Account.user){location.replace('welcome.html');return;}
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
    if(category.availability==='coming_soon'){location.replace('categories.html');return;}
    window.BTC60Category=category;
    document.body.dataset.category=category.id;
    document.body.style.setProperty('--category-accent',category.accent);
    document.body.style.setProperty('--category-background',category.background);
    const categoryLink=document.getElementById('category-switch');
    categoryLink.textContent=`← ${category.name} / Categories`;
    picker.setAttribute('aria-label',`Choose ${category.name} instrument`);
    document.querySelector('.market-workspace').setAttribute('aria-label',`${category.name} markets`);
    window.BTC60MarketConfig=data.marketConfig;
    window.PredictCoins=window.PredictCoinCatalog.createCatalog(data.coins,category.id);
    if(!window.PredictCoins.available.length)throw Error('No instruments are currently available for predictions.');
    picker.replaceChildren(...window.PredictCoins.available.map(coin=>{
      const button=document.createElement('button');button.type='button';button.className='coin-button';button.dataset.coin=coin.symbol;button.setAttribute('aria-label',`Select ${coin.name}`);button.setAttribute('aria-pressed','false');button.title=`${coin.name} (${coin.symbol})`;
      if(coin.icon){const icon=document.createElement('img');icon.src=coin.icon;icon.alt='';icon.width=24;icon.height=24;icon.addEventListener('error',()=>{icon.hidden=true;});button.append(icon);}
      const label=document.createElement('span');label.textContent=coin.symbol;button.append(label);return button;
    }));
    for(const src of ['market-model.js','app.js','btc-chart.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=()=>{try{if(src==='market-model.js')window.PredictModel.configure(window.BTC60MarketConfig);resolve();}catch(error){reject(error);}};script.onerror=()=>reject(Error('Unable to load the terminal.'));document.head.append(script);});
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
