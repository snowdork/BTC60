(async()=>{
  const picker=document.querySelector('.coin-picker');
  try{
    if(location.protocol==='file:')throw Error('Open the terminal through python3 server.py, not a file preview.');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
    let response;try{response=await fetch('/api/coins',{signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timeout);}
    if(!response.ok||!response.headers.get('Content-Type')?.includes('application/json'))throw Error('Coin API unavailable. Run or restart python3 server.py and open http://127.0.0.1:8000/index.html.');
    const data=await response.json();window.BTC60MarketConfig=data.marketConfig;window.RolrCoins=window.RolrCoinCatalog.createCatalog(data.coins);
    if(!window.RolrCoins.available.length)throw Error('No coins are currently available for predictions.');
    picker.replaceChildren(...window.RolrCoins.available.map(coin=>{
      const button=document.createElement('button');button.type='button';button.className='coin-button';button.dataset.coin=coin.symbol;button.setAttribute('aria-label',`Select ${coin.name}`);button.setAttribute('aria-pressed','false');button.title=`${coin.name} (${coin.symbol})`;
      if(coin.icon){const icon=document.createElement('img');icon.src=coin.icon;icon.alt='';icon.width=24;icon.height=24;icon.addEventListener('error',()=>{icon.hidden=true;});button.append(icon);}
      const label=document.createElement('span');label.textContent=coin.symbol;button.append(label);return button;
    }));
    for(const src of ['market-model.js','app.js','btc-chart.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=()=>{try{if(src==='market-model.js')window.RolrModel.configure(window.BTC60MarketConfig);resolve();}catch(error){reject(error);}};script.onerror=()=>reject(Error('Unable to load the terminal.'));document.head.append(script);});
  }catch(error){
    picker.textContent='Coins unavailable';
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
