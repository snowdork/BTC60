const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const signedIn={user:{name:'Taylor <admin>'},csrf:'token',predictions:[]};
const response=(data,ok=true,status=200)=>({ok,status,json:async()=>data});
function setup(fetch,attributes=[]){
 const events={},calls=[],redirects=[],intervals=[];
 const node=()=>({hidden:false,textContent:'',addEventListener(name,fn){this[name]=fn;}});
 const name=node(),logout=node(),login=node(),content=node(),status=node();
 const nodes={'[data-account-name]':[name],'[data-logout]':[logout],'[data-login]':[login],'[data-authenticated]':[content]};
 const window={addEventListener:(key,fn)=>(events[key]??=[]).push(fn),dispatchEvent:e=>(events[e.type]||[]).forEach(fn=>fn())};
 const document={hidden:false,body:{hasAttribute:key=>attributes.includes(key)},querySelectorAll:key=>nodes[key]||[],getElementById:()=>status,addEventListener(){}};
 const location={href:'',replace:url=>redirects.push(url)};
 vm.runInNewContext(fs.readFileSync('account.js','utf8'),{window,document,location,Event,setInterval:fn=>intervals.push(fn),fetch:async(url,options)=>{calls.push({url,options});return fetch(url,options);}});
 return {account:window.Predict60Account,name,logout,login,content,status,redirects,location,calls,document,intervals};
}
test('restored session renders a plain-text name and skips welcome',async()=>{
 const s=setup(()=>response(signedIn),['data-redirect-authenticated']);
 assert.deepEqual(s.redirects,[]);
 await s.account.loaded;
 assert.equal(s.name.textContent,'Taylor <admin>');assert.equal(s.name.title,'Taylor <admin>');
 assert.equal(s.name.hidden,false);assert.equal(s.login.hidden,true);assert.equal(s.content.hidden,false);
 assert(s.redirects.includes('categories.html'));
});
test('expired session hides protected controls and redirects to welcome',async()=>{
 const s=setup(()=>response({error:'Session expired'},false,401),['data-requires-login']);
 await s.account.loaded;
 assert.equal(s.account.user,null);assert.equal(s.account.csrf,null);assert.equal(s.name.hidden,true);
 assert.equal(s.logout.hidden,true);assert.equal(s.content.hidden,true);assert.equal(s.login.hidden,false);
 assert(s.redirects.includes('welcome.html'));
});
test('logout sends CSRF token and clears user, predictions, and name',async()=>{
 const s=setup(url=>response(url==='/api/logout'?{}:signedIn));await s.account.loaded;
 await s.logout.click();
 const request=s.calls.find(c=>c.url==='/api/logout');
 assert.equal(request.options.method,'POST');assert.equal(request.options.headers['X-CSRF-Token'],'token');
 assert.equal(s.account.user,null);assert.equal(s.account.csrf,null);assert.equal(s.account.predictions.length,0);
 assert.equal(s.name.textContent,'');assert.equal(s.name.hidden,true);assert.equal(s.location.href,'welcome.html');
});
test('failed logout preserves the session and permits retry',async()=>{
 const s=setup(url=>url==='/api/logout'?response({error:'Try again'},false,503):response(signedIn));await s.account.loaded;
 await s.logout.click();
 assert.equal(s.account.user.name,signedIn.user.name);assert.equal(s.location.href,'');
 assert.equal(s.logout.disabled,false);assert.equal(s.status.textContent,'Try again');
});
test('settlement ignores overlapping requests and resumes after failure',async()=>{
 let settleCalls=0,pending;
 const s=setup(url=>{
  if(url!='/api/settle')return response(signedIn);
  if(++settleCalls===1)return response(signedIn);
  return new Promise(resolve=>pending=resolve);
 });await s.account.loaded;
 const first=s.account.settle();await s.account.settle();assert.equal(settleCalls,2);
 pending(response({error:'Offline'},false,503));await assert.rejects(first,/Offline/);
 const retry=s.account.settle();assert.equal(settleCalls,3);pending(response(signedIn));await retry;
});
test('background sync does not settle while the document is hidden',async()=>{
 const s=setup(()=>response(signedIn));await s.account.loaded;
 const count=s.calls.length;s.document.hidden=true;s.intervals[0]();
 assert.equal(s.calls.length,count);
});

test('a settlement response arriving after logout cannot restore the account',async()=>{
 let settleCalls=0,finish;
 const s=setup(url=>{
  if(url==='/api/logout')return response({ok:true});
  if(url==='/api/settle'&&++settleCalls>1)return new Promise(resolve=>finish=resolve);
  return response(signedIn);
 });await s.account.loaded;
 const pending=s.account.settle();await s.logout.click();
 finish(response(signedIn));await pending;
 assert.equal(s.account.user,null);assert.equal(s.account.csrf,null);
 assert.equal(s.name.hidden,true);assert.equal(s.logout.hidden,true);
});

test('logout succeeds locally when another tab has already ended the session',async()=>{
 const s=setup(url=>url==='/api/logout'?response({error:'Session expired'},false,401):response(signedIn));
 await s.account.loaded;await s.logout.click();
 assert.equal(s.account.user,null);assert.equal(s.account.error,null);
 assert.equal(s.location.href,'welcome.html');
});
