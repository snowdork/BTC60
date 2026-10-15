/** @module portfolio
 * Render authenticated portfolio statistics, category filters, and prediction history.
 */
(() => {
  const account=window.BTC60Account,model=window.BTC60Portfolio,/** Find an interface element by its stable DOM identifier. */ $=id=>document.getElementById(id);
  let filter='all',category='all',coins=[],lastRender='',sortColumn='window',sortDirection='desc';
  const currency=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  const shareFormatter=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
  const /** Format a monetary display value using the module currency formatter. */ money=cents=>currency.format(cents/100);
  const /** Format a cent-denominated monetary change with its sign. */ signed=cents=>(cents>=0?'+':'−')+money(Math.abs(cents));
  const /** Format epoch seconds as a UTC calendar date. */ date=seconds=>new Date(seconds*1000).toISOString().slice(0,10);
  const /** Format the current time value as UTC hour and minute. */ time=seconds=>new Date(seconds*1000).toISOString().slice(11,16);
  /** Format an instrument price with the active or supplied instrument precision. */ function price(value,symbol){const precision=coins.find(c=>c.symbol===symbol)?.precision??2;return value==null?'—':value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:precision,maximumFractionDigits:precision});}
  /** Render  from the latest account, market, and interface state. */ function render(){
    if(!account.ready)return;
    $('portfolio-message').textContent=account.user?account.error||'Account history synced. Demo settlements update automatically.':account.error||'';
    $('portfolio-content').hidden=!account.user;$('portfolio-login').hidden=!!account.user;$('portfolio-refresh').disabled=!account.user;
    if(!account.user){$('portfolio-message').textContent=account.error||'';return;}
    const signature=JSON.stringify([account.user,account.predictions,filter,category,sortColumn,sortDirection,coins,account.predictions.filter(p=>p.settled_at==null).map(p=>model.result(p))]);
    if(signature===lastRender)return;lastRender=signature;
    const categoryPredictions=account.predictions.filter(p=>category==='all'||p.category===category);
    const stats=model.summary(categoryPredictions);
    $('portfolio-balance').textContent=money(account.user.balance_cents);$('portfolio-profit').textContent=signed(stats.profitCents);$('portfolio-profit').style.color=stats.profitCents>=0?'var(--green)':'var(--red)';
    $('portfolio-record').textContent=`${stats.wins} / ${stats.losses}`;$('portfolio-rate').textContent=stats.winRate==null?'No settled predictions':`${stats.winRate}% win rate`;
    $('portfolio-pending').textContent=stats.pending;$('portfolio-exposure').textContent=money(stats.pendingCostCents)+' committed';
    const predictions=model.sortPredictions(categoryPredictions.filter(p=>filter==='all'||(filter==='pending'?p.settled_at==null:model.result(p)===filter)),sortColumn,sortDirection);
    document.querySelectorAll('[data-sort]').forEach(button=>{const active=button.dataset.sort===sortColumn;button.closest('th').setAttribute('aria-sort',active?(sortDirection==='asc'?'ascending':'descending'):'none');button.querySelector('.sort-indicator').textContent=active?(sortDirection==='asc'?'↑':'↓'):'↕';});
    $('history-count').textContent=`(${predictions.length})`;$('history-empty').hidden=predictions.length>0;
    $('history-empty').firstChild.textContent=account.predictions.length?'No predictions match this filter. ':'No predictions yet. ';
    $('history-rows').replaceChildren(...predictions.map(p=>{
      const row=document.createElement('tr'),state=model.result(p),settled=p.settled_at!=null;
      const /** Append a text-only history cell with an optional secondary label. */ add=(text,small)=>{const cell=document.createElement('td');cell.textContent=text;if(small){const label=document.createElement('small');label.textContent=small;cell.append(label);}row.append(cell);return cell;};
      const coin=coins.find(c=>c.symbol===p.coin),cell=add(`${p.coin} · ${p.market_id.split('-')[0]} MIN · ${p.category||'crypto'}`, `${shareFormatter.format(p.contracts)} shares at ${p.cents}¢`);
      if(coin?.icon){const image=document.createElement('img');image.src=coin.icon;image.alt='';image.width=24;image.height=24;image.style.marginRight='7px';image.style.verticalAlign='middle';image.onerror=/** Handle the error event for the current transport or resource. */ ()=>image.remove();cell.prepend(image);}
      add(p.side==='up'?'↗ Up':'↘ Down').style.color=p.side==='up'?'var(--green)':'#ff6a84';
      add(`${time(p.starts_at)}–${time(p.ends_at)}`,date(p.starts_at));
      const status=add(''),badge=document.createElement('span');badge.className='badge '+(state==='won'?'green':state==='lost'?'red':'amber');badge.textContent=state==='settling'?'AWAITING SETTLEMENT':state.toUpperCase();status.append(badge);
      add(`${price(p.strike,p.coin)} → ${price(p.close_price,p.coin)}`,settled?`${p.source} · ${time(p.settled_at)} UTC`:`Closing benchmark pending · ${p.pricing_source==='twelvedata'?'Twelve Data live oil':coin?.category==='oil'?'Simulated oil':'Coinbase'}`);
      add(money(p.cost_cents));add(settled?money(p.payout_cents):'—');const profit=add(settled?signed(p.payout_cents-p.cost_cents):'—');if(settled)profit.style.color=p.payout_cents-p.cost_cents>=0?'var(--green)':'var(--red)';
      return row;
    }));
  }
  window.addEventListener('account-update',()=>{render();$('portfolio-message').textContent=account.user?account.error||'Account history synced. Demo settlements update automatically.':account.error||'';});
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();}));
  document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{const column=button.dataset.sort;sortDirection=column===sortColumn?(sortDirection==='asc'?'desc':'asc'):(['window','cost','return','profit','benchmark'].includes(column)?'desc':'asc');sortColumn=column;render();}));
  $('portfolio-refresh').addEventListener('click',async()=>{const button=$('portfolio-refresh');button.disabled=true;$('portfolio-message').textContent='Checking closed predictions…';try{await account.settle();}catch(error){$('portfolio-message').textContent=error.message;}finally{button.disabled=false;}});
  $('portfolio-category').addEventListener('change',event=>{category=event.target.value;render();});
  Promise.all(['/api/coins','/api/categories'].map(async url=>{const response=await fetch(url);if(!response.ok)throw Error('Market catalog unavailable');return response.json();})).then(([catalog,data])=>{
    coins=catalog.coins;
    for(const category of data.categories){const option=document.createElement('option');option.value=category.id;option.textContent=category.name;$('portfolio-category').append(option);}
    render();
  }).catch(()=>{$('portfolio-message').textContent='Market details unavailable. Refresh to retry.';});
  render();setInterval(()=>{if(!document.hidden)render();},10000);
})();
