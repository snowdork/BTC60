(() => {
  const account={user:null,csrf:null,predictions:[],ready:false,error:null};
  async function request(path,body){
    const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf||''},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{throw Error('Start the local app with python3 server.py to use accounts.');}
    if(!response.ok){if(response.status===401){Object.assign(account,{user:null,predictions:[],csrf:null,ready:true});window.dispatchEvent(new Event('account-update'));}throw Error(data.error||'Request failed.');}return data;
  }
  let snapshot='';
  function update(data){const next=JSON.stringify(data),changed=next!==snapshot||!account.ready||account.error;snapshot=next;Object.assign(account,data,{ready:true,error:null});if(changed)window.dispatchEvent(new Event('account-update'));}
  account.place=async prediction=>{update(await request('predictions',prediction));};
  account.refresh=async()=>{update(await request('account'));};
  account.logout=async()=>{await request('logout',{});update({user:null,csrf:null,predictions:[]});location.href='welcome.html';};
  let settling=false;
  account.settle=async()=>{if(!account.user||settling)return;settling=true;try{update(await request('settle',{}));}finally{settling=false;}};
  window.BTC60Account=account;
  function renderAccountControls(){
    document.querySelectorAll('[data-logout]').forEach(button=>{button.hidden=!account.user;});
    document.querySelectorAll('[data-login]').forEach(link=>{link.hidden=!!account.user;});
    document.querySelectorAll('[data-authenticated]').forEach(element=>{element.hidden=!account.user;});
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
  account.loaded=account.refresh().then(()=>account.settle()).catch(error=>{account.ready=true;account.error=error.message;window.dispatchEvent(new Event('account-update'));});
  const sync=()=>{if(document.hidden||!account.user)return;account.settle().catch(error=>{account.error=error.message;window.dispatchEvent(new Event('account-update'));});};
  setInterval(sync,15000);
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('focus',sync);
})();
