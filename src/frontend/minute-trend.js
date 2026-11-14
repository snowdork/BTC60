/** @module minute-trend
 * Render one candle-aligned summary arrow per completed minute.
 */
(function(root){
  'use strict';
  const MINUTE_MS=60000;
  const rendered=new WeakMap();
  const /** Format a minute boundary in UTC. */ clock=t=>new Date(t).toISOString().slice(11,16);
  /** Reuse the summary until its minute, interval, or candle history changes. */
  function render(container,{candles,startsAt,endsAt,now,historical=false,label='this interval'}){
    const minute=Math.floor(now/MINUTE_MS),previous=rendered.get(container);
    if(previous?.candles===candles&&previous.startsAt===startsAt
        &&previous.endsAt===endsAt&&previous.minute===minute
        &&previous.historical===historical)return;
    const count=Math.round((endsAt-startsAt)/MINUTE_MS),byTime=new Map();
    for(const candle of candles){
      // Match the chart's OHLC validation so arrows never describe rejected candles.
      if(!Array.isArray(candle)||candle.length<5
          ||!candle.slice(0,5).every(Number.isFinite)
          ||!candle.slice(1,5).every(value=>value>0)
          ||candle[1]>Math.min(candle[3],candle[4])
          ||candle[2]<Math.max(candle[3],candle[4]))continue;
      const t=candle[0]*1000;
      if(t>=startsAt&&t<endsAt&&(t-startsAt)%MINUTE_MS===0)byTime.set(t,candle);
    }
    const moves=[...byTime.entries()].filter(([t])=>t+MINUTE_MS<=now).map(([,c])=>Math.abs((c[4]-c[3])/c[3]));
    const scale=Math.max(...moves,0.000001);
    let up=0,down=0;
    const markers=Array.from({length:count},(_,index)=>{
      const marker=container.ownerDocument.createElement('span'),start=startsAt+index*MINUTE_MS,candle=byTime.get(start);
      marker.className='minute-arrow';marker.style.left=`${(index+.5)/count*100}%`;
      if(candle&&start+MINUTE_MS<=now){
        const move=(candle[4]-candle[3])/candle[3],direction=move>=0?'up':'down';
        const heat=Math.max(.15,Math.min(1,Math.abs(move)/scale));
        if(direction==='up')up++;else down++;
        marker.className+=` ${direction}`;
        marker.style.setProperty('--heat-opacity',String(.45+heat*.55));
        marker.title=`${clock(start)}–${clock(start+MINUTE_MS)} UTC · ${direction==='up'?'Up':'Down'} ${Math.abs(move*100).toFixed(3)}%`;
      }else if(!historical&&start<=now&&now<start+MINUTE_MS){
        marker.className+=' current';marker.title=`${clock(start)} UTC · Current minute`;
      }else{
        marker.title=`${clock(start)} UTC · ${start>=now?'Upcoming':'No minute data'}`;
      }
      marker.setAttribute('aria-label',marker.title);
      return marker;
    });
    container.style.setProperty('--minute-count',String(count));
    container.replaceChildren(...markers);
    container.setAttribute('aria-label',`Minute-by-minute direction for ${label}: ${up} up, ${down} down, ${count-up-down} pending or unavailable`);
    rendered.set(container,{candles,startsAt,endsAt,minute,historical});
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={render};
  else root.PredictMinuteTrend={render};
})(typeof window!=='undefined'?window:globalThis);
