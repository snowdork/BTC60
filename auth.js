/** @module auth
 * Submit login and signup forms and route successful authentication to categories.
 */
(() => {
  const form=document.getElementById('auth-form'),error=document.getElementById('auth-error');
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button');button.disabled=true;error.textContent='';
    try {
      const response=await fetch('/api/'+form.dataset.mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to sign in.');location.href='categories.html';
    } catch(err){error.textContent=err instanceof SyntaxError?'Start the local app with python3 server.py to use accounts.':err.message;}
    finally{button.disabled=false;}
  });
})();
