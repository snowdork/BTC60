/** @module contests
 * Display GMT leaderboards and private prize records without exposing delivery references.
 */
(() => {
  const /** Find a contest interface node. */ $=id=>document.getElementById(id);
  const /** Format GMT period boundaries. */ utc=seconds=>new Date(seconds*1000).toISOString().slice(0,16).replace('T',' ')+' GMT';
  const /** Format integer hundredths of a game credit. */ credits=cents=>(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const /** Describe a gift-card pool or award in USD. */ prizeLabel=p=>`$${(p.amount/100).toFixed(2)} gift card`;
  let snapshot=null,busy=false;
  /** Build period choices while retaining the current selection when possible. */ function periods(){
    if(!snapshot)return;
    const selected=$('contest-period').value;
    $('contest-period').replaceChildren();
    for(const period of snapshot.contests.filter(p=>p.kind===$('contest-kind').value)){
      const option=document.createElement('option');option.value=period.id;option.textContent=`${utc(period.starts_at)} · ${period.state.replaceAll('_',' ')}`;$('contest-period').append(option);
    }
    if([...$('contest-period').options].some(o=>o.value===selected))$('contest-period').value=selected;
    render();
  }
  /** Render rankings and awards using text nodes for all player and sponsor content. */ function render(){
    if(!snapshot)return;
    $('contest-wallet').textContent=credits(snapshot.wallet.remaining_cents)+' credits';
    $('contest-reset').textContent=utc(snapshot.wallet.resets_at);
    const period=snapshot.contests.find(p=>String(p.id)===$('contest-period').value);
    $('contest-leaders').replaceChildren();
    if(period){
      $('contest-title').textContent=`${utc(period.starts_at)} – ${utc(period.ends_at)}`;
      $('contest-state').textContent=period.state==='final'?'FINAL RESULTS':period.state==='open'?'LIVE · PROVISIONAL':period.state==='upcoming'?'UPCOMING · RESERVED PRIZES':'AWAITING SETTLEMENT';
      $('contest-participants').textContent=`${period.participants} players`;
      $('contest-prize-pool').textContent=period.prizes.length?`Reserved pools: ${period.prizes.map(p=>prizeLabel(p)+' · '+p.description).join(' / ')}`:'Recognition only · No prize pool scheduled.';
      $('contest-mine').textContent=period.mine?`Your rank: ${period.mine.rank} · ${credits(period.mine.score_cents)} net credits${period.state==='final'&&period.mine.rank===1?' · Winner':''}`:'You have no entries in this period.';
      for(const row of period.leaders){
        const tr=document.createElement('tr');
        for(const value of [row.rank,row.name,credits(row.score_cents),row.predictions,row.pending]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
        $('contest-leaders').append(tr);
      }
      $('contest-empty').hidden=period.leaders.length>0;
    }
    $('contest-awards').replaceChildren();
    for(const prize of snapshot.prizes){const li=document.createElement('li');li.textContent=`${prizeLabel(prize)} · ${prize.description} · ${prize.status} · Contest #${prize.contest_id}`;$('contest-awards').append(li);}
    if(!snapshot.prizes.length){const li=document.createElement('li');li.textContent='No prize awards yet.';$('contest-awards').append(li);}
  }
  /** Fetch the authenticated dashboard with an overlap guard and visible error state. */ async function refresh(){
    if(busy||document.hidden||!window.Predict60Account.user)return;
    busy=true;$('contest-refresh').disabled=true;
    try{
      const response=await fetch('/api/contests');
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Could not load contests.');
      snapshot=data;periods();$('contest-status').textContent='Updated '+new Date().toLocaleTimeString()+'. Rankings refresh every 30 seconds.';
    }catch(error){$('contest-status').textContent=error.message;}
    finally{busy=false;$('contest-refresh').disabled=false;}
  }
  $('contest-kind').addEventListener('change',periods);
  $('contest-period').addEventListener('change',render);
  $('contest-refresh').addEventListener('click',refresh);
  window.addEventListener('account-update',refresh);
  document.addEventListener('visibilitychange',refresh);
  setInterval(refresh,30000);refresh();
})();
