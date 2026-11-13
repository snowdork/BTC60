/** @module segment-card
 * Share the same interval card structure between the full-hour and selected-play views.
 */
(function(root){
  'use strict';
  const changeFormatter=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
  /** Describe actual price movement from a positive starting benchmark, independently of forecast odds. */
  function priceMovement(start,current){
    if(!Number.isFinite(start)||start<=0||!Number.isFinite(current)||current<=0)return null;
    const percent=(current-start)/start*100,direction=percent>=0?'up':'down';
    return {direction,percent,label:`${direction==='up'?'↑ Up +':'↓ Down −'}${changeFormatter.format(Math.abs(percent))}% from start`};
  }
  const oddsStates=new WeakMap();
  /** Animate a displayed percentage change once; unchanged odds stay still. */
  function updateOdds(node,value,side){
    if(!node)return;
    const next=Number.isFinite(value)?value:null,previous=oddsStates.get(node);
    if(previous&&previous.value===next)return;
    previous?.animation?.cancel();
    node.textContent=next===null?'—':String(next);
    node.setAttribute('aria-label',next===null?`${side} chance unavailable`:`${side} ${next}% estimated chance`);
    const state={value:next};oddsStates.set(node,state);
    if(next===null||previous?.value==null||root.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    state.animation=node.animate?.([
      {transform:'translateY(0) scale(1)',filter:'brightness(1)',textShadow:'0 0 0 currentColor'},
      {transform:'translateY(-3px) scale(1.1)',filter:'brightness(1.6)',textShadow:'0 0 18px currentColor',offset:.3},
      {transform:'translateY(0) scale(1)',filter:'brightness(1)',textShadow:'0 0 0 currentColor'}
    ],{duration:650,easing:'ease-out',iterations:1});
  }
  /** Escape template text while leaving instrument names and prices to DOM text updates. */
  function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  /** Build one interval card with identical layout and view-specific control identifiers. */
  function markup(m,{index=null,selected=false}={}){
    const detail=index!==null,closed=m.status==='settled',queued=m.status==='queued';
    const result=closed&&Number.isFinite(m.strike)&&Number.isFinite(m.close)?(m.close>=m.strike?'up':'down'):null;
    const state=queued?'upcoming':closed?(result?'completed':'pending'):'live';
    const heading=queued?'Upcoming play':closed?(result?'Completed play':'Settlement pending'):'Current play';
    const status=queued?'UPCOMING':closed?(result?'COMPLETED':'PENDING'):'OPEN';
    const date=Number.isFinite(m.startsAt)?new Date(m.startsAt).toISOString().slice(0,10):'';
    return `<article role="group" class="panel play-segment detail-card ${detail?'':'market-card'} ${m.status} ${state==='pending'?'pending':''} ${selected?'selected':''}" data-state="${state}" ${detail?`data-detail-index="${index}" aria-current="true"`:`data-market="${escape(m.id)}"`} aria-label="${m.minutes} minute play ${escape(m.start)} to ${escape(m.end)} UTC">
      <div class="detail-card-heading"><div class="segment-heading-labels"><h3>${heading}</h3><span data-detail-status class="badge ${queued||state==='pending'?'neutral':result==='down'?'red':'green'}">${status}</span></div>${result?`<span class="play-settlement-arrow ${result}" role="img" aria-label="${result==='up'?'Up':'Down'} wins"><span aria-hidden="true">${result==='up'?'↑':'↓'}</span></span>`:''}<div class="play-prediction-tags" ${detail?'data-detail-predictions':`data-predictions="${escape(m.id)}"`} hidden></div></div>
      <div class="segment-identity"><img data-detail-coin width="48" height="48" alt=""><div><strong data-detail-coin-name></strong><strong class="detail-range">${escape(m.start)} – ${escape(m.end)} UTC</strong><span class="detail-date">${date}</span></div></div>
      <p data-detail-countdown ${detail?'':`data-remaining="${escape(m.id)}"`} class="detail-countdown">${escape(m.remaining)}</p>
      <div class="detail-prices"><div><span>Starting price</span><strong data-detail-strike class="segment-benchmark-price">—</strong></div><div><span data-detail-price-label>${closed?'Closing price':'Live price'}</span><strong data-detail-price class="segment-current-price">—</strong></div><span data-reference-price="${escape(m.id)}" hidden></span></div>
      <p data-detail-result class="detail-result"><span data-detail-movement class="segment-movement" hidden></span><span data-detail-chances class="segment-chances"><span data-detail-up-chance class="segment-odds-up" aria-label="Up chance unavailable">—</span><span class="segment-odds-vs" aria-hidden="true">vs.</span><span data-detail-down-chance class="segment-odds-down" aria-label="Down chance unavailable">—</span></span><span data-detail-summary class="segment-summary" hidden></span></p>
      <button type="button" class="segment-action" ${detail?`data-detail-predict="${index}"`:`data-segment-action="${escape(m.id)}" aria-haspopup="dialog" aria-controls="prediction-dialog"`}><span class="segment-action-label">${closed?'Result':queued?'Details':'Predict...'}</span></button>
      ${detail?'':'<span class="segment-direction" data-direction-indicator hidden role="img"><span class="segment-direction-change" hidden></span><span class="segment-direction-arrow" aria-hidden="true"></span></span>'}
      ${detail?'':`<span class="segment-time-markers" aria-hidden="true"><span class="prediction-cutoff-marker" style="left:${100-5/(m.minutes*60)*100}%"></span><span class="segment-now-line" data-segment-now hidden></span></span>`}
    </article>`;
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={markup,priceMovement,updateOdds};
  else root.PredictSegmentCard={markup,priceMovement,updateOdds};
})(typeof window!=='undefined'?window:globalThis);
