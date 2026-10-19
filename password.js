/** Change the signed-in user's password using the current session and CSRF token. */
(() => {
  const form=document.getElementById('password-form'),error=document.getElementById('password-error'),status=document.getElementById('password-status');
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('[type="submit"]');
    if(button.disabled)return;
    button.disabled=true;error.textContent='';status.textContent='';
    try{
      await window.Predict60Account.loaded;
      const fields=Object.fromEntries(new FormData(form));
      if(fields.newPassword!==fields.confirmPassword)throw Error('Passwords do not match.');
      const response=await fetch('/api/change-password',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':window.Predict60Account.csrf||''},body:JSON.stringify(fields)});
      const data=await response.json();
      if(!response.ok){if(response.status===401)location.replace('login.html');throw Error(data.error||'Unable to change password.');}
      form.reset();status.textContent='Password changed. Other devices have been signed out.';
    }catch(err){error.textContent=err.message;}
    finally{button.disabled=false;}
  });
})();
