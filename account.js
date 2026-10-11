(() => {
  const account={user:null,csrf:null,predictions:[],ready:false,error:null};
  async function request(path,body){
    const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf||''},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{throw Error('Start the local app with python3 server.py to use accounts.');}
    if(!response.ok){if(response.status===401){Object.assign(account,{user:null,predictions:[],csrf:null,ready:true});window.dispatchEvent(new Event('account-update'));}throw Error(data.error||'Request failed.');}return data;
  }
  function update(data){Object.assign(account,data,{ready:true,error:null});window.dispatchEvent(new Event('account-update'));}
  account.place=async prediction=>{update(await request('predictions',prediction));};
  account.refresh=async()=>{update(await request('account'));};
  account.logout=async()=>{await request('logout',{});location.href='welcome.html';};
  let settling=false;
  account.settle=async()=>{if(!account.user||settling)return;settling=true;try{update(await request('settle',{}));}finally{settling=false;}};
  window.BTC60Account=account;
  account.refresh().then(()=>account.settle()).catch(error=>{account.ready=true;account.error=error.message;window.dispatchEvent(new Event('account-update'));});
  const sync=()=>{if(document.hidden||!account.user)return;account.settle().catch(error=>{account.error=error.message;window.dispatchEvent(new Event('account-update'));});};
  setInterval(sync,15000);
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('focus',sync);
})();
