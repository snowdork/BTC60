/** @module community
 * Refresh anonymous aggregate user counts and signed-in activity heartbeats.
 */
(() => {
  const users=document.querySelector('[data-user-count]');
  const active=document.querySelector('[data-active-count]');
  if(!users||!active)return;
  let loading=false;
  /** Refresh community counts once per request; pause hidden tabs and show unknown counts on failure. */ async function refresh(){
    // Pause hidden tabs and share a single in-flight refresh across timer/focus events.
    if(document.hidden||loading)return;
    loading=true;
    try{
      const response=await fetch('/api/community',{cache:'no-store'});
      if(!response.ok)throw Error('Community unavailable');
      const data=await response.json();
      if(!Number.isInteger(data.users)||!Number.isInteger(data.activeUsers)||data.users<0||data.activeUsers<0)throw Error('Invalid counts');
      users.textContent=data.users.toLocaleString();
      active.textContent=data.activeUsers.toLocaleString();
    }catch{
      users.textContent='—';active.textContent='—';
    }finally{loading=false;}
  }
  refresh();
  setInterval(refresh,30000);
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('focus',refresh);
})();
