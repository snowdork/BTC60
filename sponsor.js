/** @module sponsor
 * Render a configured direct-sponsor strip without ad tracking or game incentives.
 */
(async()=>{
  try{
    const response=await fetch('/api/sponsor');
    if(!response.ok)return;
    const sponsor=await response.json();
    if(!sponsor.enabled)return;
    const url=new URL(sponsor.url);
    if(url.protocol!=='https:'||url.username||url.password)return;
    const strip=document.createElement('aside');strip.className='sponsor-strip';strip.setAttribute('aria-label','Advertisement');
    const label=document.createElement('small');label.textContent='ADVERTISEMENT';
    const message=document.createElement('span');message.textContent=sponsor.message;
    const link=document.createElement('a');link.href=url.href;link.textContent=sponsor.name;link.target='_blank';link.rel='sponsored noopener noreferrer';
    strip.append(label,message,link);document.querySelector('header').after(strip);
  }catch{/* Ad availability never blocks gameplay. */}
})();
