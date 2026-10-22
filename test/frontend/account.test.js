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
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/account.js'),'utf8'),{window,document,location,Event,setInterval:fn=>intervals.push(fn),fetch:async(url,options)=>{calls.push({url,options});return fetch(url,options);}});
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

test('stale prediction token refreshes the same account and retries the identical order once',async()=>{
 let stale=false,attempts=0;
 const current={...signedIn,user:{id:1,name:'Taylor'}};
 const fresh={...current,csrf:'fresh-token'};
 const s=setup((url,options)=>{
  if(url==='/api/predictions'){
   attempts++;
   return attempts===1?response({code:'csrf_mismatch',error:'Refresh the page and try again.'},false,403):response(fresh);
  }
  return response(stale?fresh:current);
 });await s.account.loaded;stale=true;
 const order={requestId:'same-prediction-id',budget:100};
 await s.account.place(order);
 const posts=s.calls.filter(c=>c.url==='/api/predictions');
 assert.equal(posts.length,2);
 assert.equal(posts[0].options.body,posts[1].options.body);
 assert.equal(posts[1].options.headers['X-CSRF-Token'],'fresh-token');
 assert.equal(s.account.csrf,'fresh-token');
});

test('background settlement recovers a stale token without reloading the page',async()=>{
 let stale=false,attempts=0;
 const current={...signedIn,user:{id:1,name:'Taylor'}};
 const s=setup((url,options)=>{
  if(stale&&url==='/api/settle'){
   attempts++;
   if(options.headers['X-CSRF-Token']==='token')return response({error:'Refresh the page and try again.'},false,403);
  }
  return response({...current,csrf:stale?'renewed':'token'});
 });await s.account.loaded;stale=true;await s.account.settle();
 assert.equal(attempts,2);assert.equal(s.account.csrf,'renewed');
});

test('CSRF recovery never retries an order for a different account',async()=>{
 let changed=false;
 const s=setup(url=>url==='/api/predictions'?response({code:'csrf_mismatch'},false,403):response({...signedIn,user:{id:changed?2:1,name:'Player'}}));
 await s.account.loaded;changed=true;
 await assert.rejects(s.account.place({requestId:'do-not-replay'}),/account changed/);
 assert.equal(s.calls.filter(c=>c.url==='/api/predictions').length,1);
 assert.equal(s.account.user.id,2);
});

test('CSRF retries are bounded and other errors never replay predictions',async()=>{
 for(const [status,error,expected] of [[403,{code:'csrf_mismatch'},2],[403,{error:'Invalid request origin.'},1],[503,{error:'Unavailable'},1]]){
  const s=setup(url=>url==='/api/predictions'?response(error,false,status):response({...signedIn,user:{id:1,name:'Player'}}));
  await s.account.loaded;await assert.rejects(s.account.place({requestId:'bounded-retry'}));
  assert.equal(s.calls.filter(c=>c.url==='/api/predictions').length,expected);
 }
});
