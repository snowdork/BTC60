const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/google-onboarding.js'),'utf8');
function setup(mode,respond){
 const nodes=new Map(),calls=[],destinations=[];
 function get(id){if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',value:'',handlers:{},focus(){this.focused=true;},addEventListener(event,fn){this.handlers[event]=fn;},querySelector(){return get('submit-button');}});return nodes.get(id);}
 const context={document:{querySelector:()=>({dataset:{googleOnboarding:mode}}),getElementById:get},window:{location:{assign:value=>destinations.push(value)}},fetch:async(path,options)=>{
  calls.push({path,options});
  if(path==='/api/auth/google/csrf')return {ok:true,json:async()=>({csrf:'login-csrf'})};
  if(path==='/api/account')return {ok:true,json:async()=>({user:{email:'player@example.com'},csrf:'account-csrf'})};
  const {ok=true,...data}=respond(path,options);return {ok,json:async()=>data};
 }};
 vm.runInNewContext(source,context);
 return {get,calls,destinations,select:()=>context.window.handleGoogleOnboarding({credential:'verified-token'}),submit:()=>get('google-signup-form').handlers.submit({preventDefault(){},currentTarget:get('google-signup-form')}),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('new Google signup collects organizer code before creating an account',async()=>{
 const s=setup('signup',path=>path.endsWith('/signup')?{redirect:'/categories.html'}:{ok:false,code:'SIGNUP_REQUIRED'});
 await s.select();
 assert.equal(s.get('google-signup-form').hidden,false);
 assert.equal(s.get('auth-form').hidden,true);
 assert.equal(s.calls.some(call=>call.path.endsWith('/signup')),false);
 s.get('google-name').value='New player';s.get('google-signup-code').value='777';await s.submit();
 const signup=s.calls.find(call=>call.path.endsWith('/signup'));
 assert.deepEqual(JSON.parse(signup.options.body),{credential:'verified-token',name:'New player',signupCode:'777'});
 assert.equal(signup.options.headers['X-CSRF-Token'],'login-csrf');
 assert.deepEqual(s.destinations,['/categories.html']);
});
test('rejected signup code stays on the form for correction',async()=>{
 const s=setup('signup',path=>path.endsWith('/signup')?{ok:false,error:'Invalid signup code.'}:{ok:false,code:'SIGNUP_REQUIRED'});
 await s.select();await s.submit();
 assert.equal(s.get('google-onboarding-error').textContent,'Invalid signup code.');
 assert.equal(s.destinations.length,0);
 assert.equal(s.get('submit-button').disabled,false);
});
test('existing password account routes to normal login without creating or merging',async()=>{
 const s=setup('signup',()=>({ok:false,code:'LINK_REQUIRED',error:'Link your existing account.'}));
 await s.select();
 assert.equal(s.get('google-link-login').hidden,false);
 assert.equal(s.get('google-signup-form').hidden,true);
 assert.equal(s.calls.some(call=>call.path.endsWith('/signup')),false);
});
test('returning Google user skips signup code and returns to their account',async()=>{
 const s=setup('signup',()=>({redirect:'/categories.html'}));await s.select();
 assert.deepEqual(s.destinations,['/categories.html']);
});
test('linking requires an explicit Google selection and existing account CSRF',async()=>{
 const s=setup('link',()=>({ok:true}));await s.flush();
 assert.equal(s.get('google-account-email').textContent,'Signed in as player@example.com');
 assert.equal(s.calls.some(call=>call.path.endsWith('/link')),false);
 await s.select();
 const link=s.calls.find(call=>call.path.endsWith('/link'));
 assert.equal(link.options.headers['X-CSRF-Token'],'account-csrf');
 assert.deepEqual(JSON.parse(link.options.body),{credential:'verified-token'});
 assert.match(s.get('google-onboarding-status').textContent,/linked/);
 assert.equal(s.destinations.length,0);
});

test('login shares credential submission and routes signup and linking responses',async()=>{
 for(const [result,destination] of [
  [{redirect:'/categories.html'},'/categories.html'],
  [{ok:false,code:'SIGNUP_REQUIRED'},'/signup.html?google=1'],
  [{ok:false,code:'LINK_REQUIRED'},'/login.html?google=link']
 ]){
  const s=setup('login',()=>result);await s.select();
  assert.deepEqual(s.destinations,[destination]);
  const login=s.calls.find(call=>call.path==='/api/auth/google');
  assert.equal(login.options.headers['X-CSRF-Token'],'login-csrf');
  assert.deepEqual(JSON.parse(login.options.body),{credential:'verified-token'});
 }
});
test('login shows a readable message for connection failures and permits retry',async()=>{
 const s=setup('login',()=>{throw TypeError('Failed to fetch');});
 await s.select();
 assert.match(s.get('auth-error').textContent,/Unable to connect/);
 assert.equal(s.destinations.length,0);
 await s.select();
 assert.equal(s.calls.filter(call=>call.path==='/api/auth/google').length,2);
});
