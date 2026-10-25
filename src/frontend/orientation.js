/** @module orientation
 * Offer phone landscape viewing with reversible rotation and manual guidance.
 */
(() => {
  'use strict';
  const button=document.getElementById('landscape-button');
  if(!button)return;
  const label=button.querySelector('[data-landscape-label]');
  const hint=document.getElementById('landscape-hint');
  const root=document.documentElement;
  const orientation=window.screen?.orientation;
  const landscape=window.matchMedia('(orientation: landscape)');
  let locked=false,ownsFullscreen=false,busy=false;

  /** Reflect actual device orientation and the view requested by this control. */ function render(){
    label.textContent=locked?'Auto rotate':ownsFullscreen?'Exit full screen':landscape.matches?'Landscape':'Rotate';
    button.disabled=busy||(landscape.matches&&!locked&&!ownsFullscreen);
    button.setAttribute('aria-pressed',String(locked||ownsFullscreen||landscape.matches));
    button.setAttribute('aria-busy',String(busy));
    if(landscape.matches)hint.hidden=true;
  }
  /** Explain physical rotation when the browser cannot change orientation. */ function showHint(){
    hint.textContent='Turn your phone sideways. If it stays upright, turn off your phone’s rotation lock.';
    hint.hidden=false;
  }
  /** Release only the orientation and full-screen view requested by this control. */ async function restore(){
    if(locked)orientation.unlock?.();
    locked=false;
    if(ownsFullscreen&&document.fullscreenElement===root)await document.exitFullscreen();
    ownsFullscreen=false;
  }
  /** Request landscape from a tap, or restore normal rotation on the next tap. */ async function toggleLandscape(){
    if(busy)return;
    busy=true;render();
    try{
      if(locked||ownsFullscreen){await restore();return;}
      if(landscape.matches)return;
      if(typeof orientation?.lock!=='function'){showHint();return;}
      if(!document.fullscreenElement&&typeof root.requestFullscreen==='function'&&typeof document.exitFullscreen==='function'){
        await root.requestFullscreen();
        ownsFullscreen=true;
      }
      await orientation.lock('landscape');
      locked=true;hint.hidden=true;
    }catch{
      showHint();
      try{await restore();}catch{
        hint.textContent='Use your browser’s full-screen exit control, then turn your phone sideways.';
        hint.hidden=false;
      }
    }finally{busy=false;render();}
  }
  button.addEventListener('click',toggleLandscape);
  document.addEventListener('fullscreenchange',()=>{
    if(ownsFullscreen&&document.fullscreenElement!==root){
      if(locked)orientation.unlock?.();
      locked=false;ownsFullscreen=false;
    }
    render();
  });
  window.addEventListener('resize',render);
  orientation?.addEventListener?.('change',render);
  window.addEventListener('pagehide',()=>{if(locked)orientation.unlock?.();locked=false;ownsFullscreen=false;render();});
  render();
})();
