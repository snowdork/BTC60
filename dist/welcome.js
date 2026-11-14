/** @module welcome
 * Open current playfield snapshots and switch between Interval and Hour previews.
 */
(function(){
  'use strict';
  const dialog=document.getElementById('welcome-demo');
  const trigger=document.getElementById('welcome-demo-open');
  const views=[...dialog.querySelectorAll('[data-demo-view]')];
  const panels=[...dialog.querySelectorAll('[data-demo-panel]')];
  views.forEach(button=>button.addEventListener('click',()=>{
    views.forEach(view=>view.setAttribute('aria-pressed',String(view===button)));
    panels.forEach(panel=>panel.hidden=panel.dataset.demoPanel!==button.dataset.demoView);
  }));
  trigger.addEventListener('click',()=>dialog.showModal());
  document.getElementById('welcome-demo-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const bounds=dialog.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
  });
})();
