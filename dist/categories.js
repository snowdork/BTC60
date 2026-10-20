/** @module categories
 * Render market category cards while keeping coming-soon markets disabled.
 */
(async()=>{
  'use strict';
  await window.Predict60Account.loaded;
  if(!window.Predict60Account.user)return;
  const icons={
    weather:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle cx="23" cy="22" r="10"/><path d="M23 4v4M5 22h4M10 9l4 4M36 9l-4 4M20 46h29a10 10 0 0 0 0-20 15 15 0 0 0-29 5 8 8 0 0 0 0 15ZM18 54h25M29 60h22"/></svg>',
    oil:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M18 12h28v40H18zM14 20h36M14 44h36M18 32h8m12 0h8"/><path d="M32 23s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12Z" fill="currentColor" stroke="none"/></svg>',
    crypto:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="32" cy="32" r="25"/><path d="M25 19v27m-5-26h16c12 0 12 12 0 12H25m0 0h12c12 0 12 13 0 13H20m9-30v5m7-5v5m-7 25v5m7-5v5"/></svg>'
  };
  const status=document.getElementById('category-status'),retry=document.getElementById('category-retry');
  const quoteRows=new Map();let quotesLoading=false;
  /** Refresh configured oil observations with freshness checks and no overlapping polling. */ async function refreshQuotes(){
    if(quotesLoading||document.hidden||!quoteRows.size)return;
    quotesLoading=true;
    try{await Promise.all([...quoteRows].map(async([symbol,node])=>{
      try{
        const response=await fetch(`/api/spot?coin=${encodeURIComponent(symbol)}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});
        const tick=await response.json();
        if(!response.ok||!Number.isFinite(tick.price)||!Number.isFinite(tick.time)||(tick.quoteKind!=='assessment'&&Date.now()-tick.time>90000)||tick.time>Date.now()+5000)throw Error();
        node.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(tick.price);
        if(tick.quoteKind==='assessment')node.textContent+=` · ${new Date(tick.time).toISOString().slice(0,10)}`;
        node.title=`Source update ${new Date(tick.time).toISOString()} · USD/barrel`;node.dataset.state=tick.quoteKind==='assessment'?'assessment':'live';
      }catch{node.textContent='Unavailable';node.dataset.state='unavailable';node.removeAttribute('title');}
    }));}finally{quotesLoading=false;}
  }
  retry.addEventListener('click',()=>location.reload());
  try{
    const response=await fetch('/api/categories',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('Categories unavailable');
    const {categories}=await response.json();
    if(!Array.isArray(categories)||!categories.length)throw Error('No categories available');
    const marketOrder={crypto:0,oil:1,weather:2};
    categories.sort((a,b)=>(marketOrder[a.id]??3)-(marketOrder[b.id]??3));
    document.getElementById('category-options').replaceChildren(...categories.map(category=>{
      const comingSoon=category.availability==='coming_soon';
      const link=document.createElement(comingSoon?'article':'a');link.className='category-card';link.dataset.category=category.id;
      // Render a non-navigable article for dormant categories rather than a market link.
      if(comingSoon){link.dataset.availability='coming_soon';link.setAttribute('aria-label',`${category.name} — Coming soon`);}else link.href=`index.html?category=${encodeURIComponent(category.id)}`;
      link.style.setProperty('--category-accent',category.accent);link.style.setProperty('--category-background',category.background);
      const icon=document.createElement('span');icon.className='category-icon';icon.innerHTML=icons[category.icon]||'<span aria-hidden="true">↗</span>';
      const planned=category.id==='weather'?(category.cities||[]).map(city=>({symbol:city.name,name:city.name})):(category.instruments||[]);
      const count=document.createElement('span');count.className='category-count';count.textContent=comingSoon&&category.id==='weather'?`${planned.length} CITIES · 60 MINUTES`:`${category.instrumentCount} INSTRUMENTS`;
      const title=document.createElement('h2');title.textContent=category.name;
      const description=document.createElement('p');description.textContent=category.description;
      const action=document.createElement('span');action.className='category-action';action.textContent=comingSoon?'Coming soon':`Enter ${category.name} →`;
      const source=document.createElement('small');source.textContent=comingSoon?(category.id==='oil'?'Oil market data feed integration in progress':'Temperature · °C / Wind speed · m/s'):`${category.provider} · ${category.quoteCadence} · ${category.unit==='USD/barrel'?'USD / barrel':'USD'}`;
      const state=document.createElement('span');state.className='category-feed-state';state.dataset.state=category.feedState;
      state.textContent=comingSoon?(category.id==='oil'?'Predictions paused until the data feed is ready':'60-minute temperature & wind predictions'):category.feedState==='setup_required'?'Live feed awaiting connection':category.feedState==='configured'?(category.provider==='OilPriceAPI'?'Spot assessments connected':'Live feed configured'):'Live feed available';
      const instruments=document.createElement('div');instruments.className='category-instruments';
      // Show planned instruments without fetching observations or enabling orders.
      for(const instrument of planned){
        const row=document.createElement('span');row.className='category-instrument';
        const label=document.createElement('span');label.textContent=instrument.symbol;label.title=instrument.name;row.append(label);
        if(category.id==='oil'&&!comingSoon){
          const value=document.createElement('strong');value.textContent=!instrument.liveSupported?'No live feed':category.feedState==='setup_required'?'Awaiting connection':'Loading…';
          value.className='category-quote';row.append(value);
          if(instrument.liveSupported&&category.feedState==='configured')quoteRows.set(instrument.symbol,value);
        }
        instruments.append(row);
      }
      link.append(count,icon,title,description,state,instruments,source,action);return link;
    }));
    status.textContent='';
    refreshQuotes();setInterval(refreshQuotes,5000);
    document.addEventListener('visibilitychange',refreshQuotes);
  }catch{
    status.textContent='Markets unavailable. Start or restart the local app with python3 server.py, then try again.';
    retry.hidden=false;
  }
})();
