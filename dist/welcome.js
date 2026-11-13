/** @module welcome
 * Open the static gameplay preview until the motion demo is ready.
 */
(function(){
  'use strict';
  const dialog=document.getElementById('welcome-demo');
  const trigger=document.getElementById('welcome-demo-open');
  trigger.addEventListener('click',()=>dialog.showModal());
  document.getElementById('welcome-demo-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const bounds=dialog.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
  });
})();
