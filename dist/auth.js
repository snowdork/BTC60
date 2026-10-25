/** @module auth
 * Submit login and signup forms and route successful authentication to categories.
 */
(() => {
  const form=document.getElementById('auth-form'),error=document.getElementById('auth-error');
  document.querySelectorAll('[data-toggle-password]').forEach(toggle=>{
    const field=document.getElementById(toggle.dataset.togglePassword),label=toggle.getAttribute('aria-label');
    toggle.addEventListener('click',()=>{
      const visible=field.type==='password';field.type=visible?'text':'password';
      toggle.textContent=visible?'Hide':'Show';toggle.setAttribute('aria-pressed',String(visible));
      toggle.setAttribute('aria-label',visible?label.replace('Show','Hide'):label);
    });
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const next=form.dataset.mode==='login'&&event.submitter?.dataset?.next==='password.html'?'password.html':'categories.html';const button=form.querySelector('[type="submit"]');button.disabled=true;error.textContent='';
    try {
      const fields=Object.fromEntries(new FormData(form));
      if(form.dataset.mode==='signup'&&fields.password!==fields.confirmPassword)throw Error('Passwords do not match.');
      const response=await fetch('/api/'+form.dataset.mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to sign in.');location.href=next;
    } catch(err){error.textContent=err instanceof SyntaxError?'Start the local app with python3 src/backend/server.py to use accounts.':err.message;}
    finally{button.disabled=false;}
  });
})();
