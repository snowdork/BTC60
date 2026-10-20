/** @module theme
 * Apply and persist the light/dark theme and synchronize theme changes across tabs.
 */
(() => {
  const key='p60_theme';
  let theme='dark';try{if(localStorage.getItem(key)==='light')theme='light';}catch{}
  const sun='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>';
  const moon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/></svg>';
  /** Apply the active theme and update accessible toggle labels without changing account state. */ function apply(){
    document.documentElement.dataset.theme=theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button=>{const label=`Switch to ${theme==='dark'?'light':'dark'} mode`;button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(theme==='light'));button.innerHTML=theme==='dark'?sun:moon;});
  }
  apply();
  document.addEventListener('DOMContentLoaded',()=>{apply();document.querySelectorAll('[data-theme-toggle]').forEach(button=>button.addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';try{localStorage.setItem(key,theme);}catch{}apply();}));});
  window.addEventListener('storage',event=>{if(event.key===key){theme=event.newValue==='light'?'light':'dark';apply();}});
})();
