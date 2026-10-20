/** @module account
 * Synchronize account state, session-aware navigation, CSRF requests, and signed-in controls.
 */
(() => {
  let generation=0,loggingOut=false;
  const account={user:null,csrf:null,predictions:[],ready:false,error:null};
  /** Recover a stale CSRF token once for the same account, without replaying other failures. */ async function request(path,body,retry=true){
    const started=generation,userId=account.user?.id;
    const response=await fetch('/api/'+path,{method:body?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf||''},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{throw Error('Start the local app with python3 server.py to use accounts.');}
    if(body&&retry&&response.status===403&&(data.code==='csrf_mismatch'||data.error==='Refresh the page and try again.')){
      const fresh=await request('account');
      if(started!==generation)throw Error('Your session changed. Please sign in again.');
      update(fresh);
      if(userId==null||fresh.user?.id!==userId)throw Error('Your signed-in account changed. Review your prediction before trying again.');
      return request(path,body,false);
    }
    if(!response.ok){if(response.status===401){Object.assign(account,{user:null,predictions:[],csrf:null,ready:true});window.dispatchEvent(new Event('account-update'));}throw Object.assign(Error(data.error||'Request failed.'),{status:response.status});}return data;
  }
  let snapshot='';
  /** Replace the account snapshot and emit account-update only when state or error status changes. */ function update(data){const next=JSON.stringify(data),changed=next!==snapshot||!account.ready||account.error;snapshot=next;Object.assign(account,data,{ready:true,error:null});if(changed)window.dispatchEvent(new Event('account-update'));}
  account.place=/** Submit a prediction and replace local state with the authoritative server snapshot. */ async prediction=>{const current=generation,data=await request('predictions',prediction);if(current===generation)update(data);};
  account.refresh=/** Fetch the authoritative signed-in account snapshot and emit state changes. */ async()=>{const current=generation,data=await request('account');if(current===generation)update(data);};
  account.logout=/** Invalidate the server session, clear account state, and return to the welcome screen. */ async()=>{
    if(loggingOut)return;
    loggingOut=true;
    try{
      try{await request('logout',{});}catch(error){if(error.status!==401)throw error;}
      // Discard account snapshots fetched before the server ended this session.
      generation++;update({user:null,csrf:null,predictions:[],contestWallet:null});location.href='welcome.html';
    }finally{loggingOut=false;}
  };
  let settling=false;
  account.settle=/** Retry due settlements for signed-in users under an in-flight request guard. */ async()=>{if(!account.user||settling||loggingOut)return;settling=true;const current=generation;try{const data=await request('settle',{});if(current===generation)update(data);}finally{settling=false;}};
  window.Predict60Account=account;
  /** Render account controls from the latest account, market, and interface state. */ function renderAccountControls(){
    document.querySelectorAll('[data-account-name]').forEach(label=>{
      label.hidden=!account.user;
      label.textContent=account.user?.name||'';
      label.title=account.user?.name||'';
    });
    document.querySelectorAll('[data-logout]').forEach(button=>{button.hidden=!account.user;});
    document.querySelectorAll('[data-login]').forEach(link=>{link.hidden=!!account.user;});
    document.querySelectorAll('[data-authenticated]').forEach(element=>{element.hidden=!account.user;});
    // Wait for the authoritative session check before choosing an entry screen.
    if(document.body.hasAttribute('data-redirect-authenticated')&&account.ready&&account.user)location.replace('categories.html');
    if(document.body.hasAttribute('data-requires-login')&&account.ready&&!account.user)location.replace('welcome.html');
    const status=document.getElementById('account-status');if(status)status.textContent=account.error||'';
  }
  window.addEventListener('account-update',renderAccountControls);
  document.querySelectorAll('[data-logout]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    try{await account.logout();}
    catch(error){account.error=error.message;window.dispatchEvent(new Event('account-update'));}
    finally{button.disabled=false;}
  }));
  renderAccountControls();
  account.loaded=account.refresh().then(()=>account.settle()).catch(error=>{account.ready=true;account.error=document.body.hasAttribute('data-redirect-authenticated')&&!account.user&&error.message==='Log in to save your predictions.'?null:error.message;window.dispatchEvent(new Event('account-update'));});
  const /** Skip hidden or signed-out tabs and retry pending settlements without overlapping requests. */ sync=()=>{if(document.hidden||!account.user)return;account.settle().catch(error=>{account.error=error.message;window.dispatchEvent(new Event('account-update'));});};
  setInterval(sync,15000);
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('focus',sync);
})();
