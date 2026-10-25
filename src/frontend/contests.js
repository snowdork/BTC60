/** @module contests
 * Display hourly credit tallies, final winners, and paginated GMT history.
 */
(() => {
  const /** Find a contest interface node. */ $=id=>document.getElementById(id);
  const /** Format GMT period boundaries. */ utc=seconds=>new Date(seconds*1000).toISOString().slice(0,16).replace('T',' ')+' GMT';
  const /** Format integer hundredths of a credit. */ credits=cents=>(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const /** Format an hourly gain or loss. */ signed=cents=>(cents>0?'+':'')+credits(cents);
  const /** Describe a gift-card pool or award in USD. */ prizeLabel=p=>`$${(p.amount/100).toFixed(2)} gift card`;
  let snapshot=null,busy=false,before=null,chooseHour=null,followCurrent=true,recent=[],selectedHour=null;
  /** Build period choices while retaining the selection within the loaded history page. */ function periods(){
    const selected=$('contest-period').value;
    $('contest-period').replaceChildren();
    for(const period of snapshot.contests){
      const option=document.createElement('option');option.value=String(period.id);option.textContent=`${utc(period.starts_at)} · ${period.state.replaceAll('_',' ')}`;$('contest-period').append(option);
    }
    if(followCurrent)chooseHour=snapshot.wallet.starts_at;
    const target=chooseHour===null?(snapshot.contests.find(p=>String(p.id)===selected)||snapshot.contests[0]):snapshot.contests.find(p=>p.starts_at===chooseHour);
    if(target)$('contest-period').value=String(target.id);
    else if(chooseHour!==null)$('contest-period').value='';
    selectedHour=target?.starts_at??chooseHour??selectedHour;
    chooseHour=null;
    render();
  }
  /** Render safe text content for the selected hour, personal history, and winners. */ function render(){
    if(!snapshot)return;
    const wallet=snapshot.wallet;
    $('contest-wallet').textContent=credits(wallet.remaining_cents)+' credits';
    $('contest-reset').textContent=utc(wallet.resets_at);
    $('contest-tally').textContent=signed(wallet.net_cents)+' credits';
    $('contest-reset-note').textContent='Settled winnings can be used again this hour. Final score is ending credits minus 1,000. Every player starts each new GMT hour with 1,000 credits, even while earlier results await settlement.';
    const period=snapshot.contests.find(p=>String(p.id)===$('contest-period').value);
    const current=snapshot.wallet.starts_at;
    const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localFormat=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:localZone,timeZoneName:'short'});
    $('contest-local-hour').textContent=selectedHour===null?`Local timezone: ${localZone}`:`Local time: ${localFormat.format(new Date(selectedHour*1000))} – ${localFormat.format(new Date((selectedHour+3600)*1000))} · ${localZone}`;
    $('contest-prev').disabled=busy||selectedHour===null;
    $('contest-next').disabled=busy||selectedHour===null||selectedHour>=current;
    $('contest-leaders').replaceChildren();
    $('contest-title').textContent=period?`${utc(period.starts_at)} – ${utc(period.ends_at)}`:'No recorded contest for this hour';
    $('contest-state').textContent=period?({final:'FINAL RESULTS',open:'LIVE · PROVISIONAL',upcoming:'UPCOMING',awaiting_settlement:'AWAITING SETTLEMENT'}[period.state]):'NO ENTRIES';
    $('contest-participants').textContent=period?`${period.participants} players`:'';
    $('contest-prize-pool').textContent=period?.prizes.length?`Reserved pools: ${period.prizes.map(p=>prizeLabel(p)+' · '+p.description).join(' / ')}`:'Recognition only · No prize pool scheduled.';
    $('contest-mine').textContent=period?.mine?`Your rank: ${period.mine.rank} · ${signed(period.mine.score_cents)} credits won / lost · ${period.mine.pending} pending`:'You have no entries in this hour.';
    $('contest-winner').textContent=period?.state==='final'?(period.winners.length?`Winner${period.winners.length>1?'s':''}: ${period.winners.map(row=>row.name).join(', ')} · ${signed(period.winners[0].score_cents)} net credits`:'No winner — no entries.'):'Winner declared after all hourly predictions settle.';
    for(const row of period?.leaders||[]){
      const tr=document.createElement('tr');
      for(const value of [row.rank,row.name,signed(row.score_cents),row.predictions,row.pending]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
      $('contest-leaders').append(tr);
    }
    $('contest-empty').hidden=!!period?.leaders.length;
    $('contest-history').replaceChildren();
    for(const hour of recent.filter(p=>p.state!=='upcoming'&&p.starts_at>snapshot.wallet.starts_at-86400&&p.starts_at<=snapshot.wallet.starts_at)){
      const tr=document.createElement('tr'),cell=document.createElement('td'),button=document.createElement('button');
      button.type='button';button.textContent=utc(hour.starts_at);button.addEventListener('click',()=>{jump(hour.starts_at);});cell.append(button);tr.append(cell);
      const winner=hour.state==='final'?(hour.winners.map(row=>row.name).join(', ')||'No entries'):'Pending';
      for(const value of [hour.mine?signed(hour.mine.score_cents):'—',hour.mine?.pending||0,hour.state.replaceAll('_',' '),winner]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
      $('contest-history').append(tr);
    }
    $('contest-older').disabled=busy||snapshot.next_before===null;
    $('contest-awards').replaceChildren();
    for(const prize of snapshot.prizes){const li=document.createElement('li');li.textContent=`${prizeLabel(prize)} · ${prize.description} · ${prize.status} · Contest #${prize.contest_id}`;$('contest-awards').append(li);}
    if(!snapshot.prizes.length){const li=document.createElement('li');li.textContent='No prize awards yet.';$('contest-awards').append(li);}
  }
  /** Fetch a bounded history page while retaining the current view on failure. */ async function refresh(){
    if(busy||document.hidden||!window.Predict60Account.user)return;
    busy=true;
    for(const id of ['contest-refresh','contest-current','contest-older','contest-prev','contest-next'])$(id).disabled=true;
    try{
      if(before!==null){
        const latest=await fetch('/api/contests');
        const latestData=await latest.json();
        if(!latest.ok)throw Error(latestData.error||'Could not load recent contests.');
        recent=latestData.contests;
      }
      const response=await fetch('/api/contests'+(before===null?'':`?before=${before}`));
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Could not load contests.');
      snapshot=data;if(before===null)recent=data.contests;periods();$('contest-status').textContent='Updated '+new Date().toLocaleTimeString()+'. Results refresh every 15 seconds.';
    }catch(error){$('contest-status').textContent=error.message;}
    finally{busy=false;for(const id of ['contest-refresh','contest-current'])$(id).disabled=false;$('contest-older').disabled=!snapshot||snapshot.next_before===null;
      $('contest-prev').disabled=selectedHour===null;
      $('contest-next').disabled=selectedHour===null||selectedHour>=snapshot?.wallet.starts_at;}
  }
  /** Load a particular GMT hour, including older records outside the current page. */ function jump(hour){
    if(busy)return;
    followCurrent=false;chooseHour=hour;before=hour+1;refresh();
  }
  $('contest-period').addEventListener('change',()=>{followCurrent=false;selectedHour=snapshot.contests.find(p=>String(p.id)===$('contest-period').value)?.starts_at??null;render();});
  $('contest-refresh').addEventListener('click',refresh);
  $('contest-current').addEventListener('click',()=>{if(busy)return;followCurrent=true;before=null;refresh();});
  $('contest-older').addEventListener('click',()=>{if(busy||snapshot?.next_before==null)return;followCurrent=false;before=snapshot.next_before;refresh();});
  $('contest-prev').addEventListener('click',()=>{if(selectedHour!==null)jump(selectedHour-3600);});
  $('contest-next').addEventListener('click',()=>{if(selectedHour!==null&&selectedHour<snapshot.wallet.starts_at)jump(selectedHour+3600);});
  /** Open the date-time lookup only when requested. */
  $('contest-find').addEventListener('click',()=>{
    const panel=$('contest-find-panel');
    panel.hidden=!panel.hidden;
    $('contest-find').setAttribute('aria-expanded',String(!panel.hidden));
    if(!panel.hidden){
      const current=snapshot?.wallet.starts_at??Math.floor(Date.now()/3600000)*3600;
      $('contest-date').max=new Date(current*1000).toISOString().slice(0,16);
      $('contest-date').value=new Date((selectedHour??current)*1000).toISOString().slice(0,16);
      $('contest-find-error').textContent='';
      $('contest-date').focus();
    }
  });
  /** Close lookup and return keyboard focus to its icon. */
  function closeLookup(){
    $('contest-find-panel').hidden=true;
    $('contest-find').setAttribute('aria-expanded','false');
    $('contest-find').focus();
  }
  $('contest-find-close').addEventListener('click',closeLookup);
  $('contest-find-panel').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeLookup();}});
  $('contest-find-panel').addEventListener('submit',event=>{
    event.preventDefault();
    if(busy)return;
    const value=$('contest-date').value,hour=value?Date.parse(value+'Z')/1000:NaN;
    if(!Number.isFinite(hour)||hour>Date.now()/1000){$('contest-find-error').textContent='Choose a current or previous GMT hour.';return;}
    jump(Math.floor(hour/3600)*3600);
    closeLookup();
  });
  window.addEventListener('account-update',refresh);
  document.addEventListener('visibilitychange',refresh);
  setInterval(refresh,15000);refresh();
})();
