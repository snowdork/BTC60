(async()=>{
  const container=document.getElementById('floating-coins');
  try{
    const response=await fetch('/api/coins',{cache:'no-store'});if(!response.ok)return;
    const {coins}=await response.json();
    container.replaceChildren(...coins.filter(coin=>coin.enabled&&coin.icon).slice(0,5).map(coin=>{
      const bubble=document.createElement('span');bubble.className='floating-coin';bubble.hidden=true;
      const image=document.createElement('img');image.src=coin.icon;image.alt='';image.addEventListener('load',()=>{bubble.hidden=false;});image.addEventListener('error',()=>bubble.remove());bubble.append(image);return bubble;
    }));
  }catch{/* The splash remains usable if the database is temporarily offline. */}
})();
