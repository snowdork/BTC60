const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(mode,fetch){
 const button={},error={},location={href:''};let submit;
 const form={dataset:{mode},querySelector:()=>button,addEventListener:(name,fn)=>submit=fn};
 const fields={email:'test@example.com',password:'test-password',...(mode==='signup'?{name:'Taylor',signupCode:'777',confirmPassword:'test-password'}:{})};
 const context={document:{querySelectorAll:()=>[],getElementById:id=>id==='auth-form'?form:error},location,fetch,SyntaxError,FormData:class{[Symbol.iterator](){return Object.entries(fields)[Symbol.iterator]();}}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/auth.js'),'utf8'),context);
 return {button,error,location,submit:()=>submit({preventDefault(){}}),fields};
}
test('login and signup post form fields and navigate to categories',async()=>{
 for(const mode of ['login','signup']){
  let request;const s=setup(mode,async(url,options)=>{request={url,options};return {ok:true,json:async()=>({ok:true})};});
  await s.submit();assert.equal(request.url,'/api/'+mode);assert.deepEqual(JSON.parse(request.options.body),s.fields);
  assert.equal(request.options.method,'POST');assert.equal(s.location.href,'categories.html');assert.equal(s.button.disabled,false);
 }
});
test('rejected credentials remain on the form with a retryable error',async()=>{
 const s=setup('login',async()=>({ok:false,json:async()=>({error:'Invalid credentials'})}));
 await s.submit();assert.equal(s.error.textContent,'Invalid credentials');assert.equal(s.location.href,'');assert.equal(s.button.disabled,false);
});
test('submission is disabled while pending and recovers from non-JSON responses',async()=>{
 let finish;const s=setup('signup',()=>new Promise(resolve=>finish=resolve));
 const pending=s.submit();assert.equal(s.button.disabled,true);
 finish({ok:true,json:async()=>{throw new SyntaxError('HTML response');}});await pending;
 assert.match(s.error.textContent,/python3 src\/backend\/server.py/);assert.equal(s.location.href,'');assert.equal(s.button.disabled,false);
});

test('invalid signup code stays on signup with a retryable error',async()=>{
 const s=setup('signup',async()=>({ok:false,json:async()=>({error:'Invalid signup code.'})}));
 s.fields.signupCode='wrong';await s.submit();
 assert.equal(s.error.textContent,'Invalid signup code.');
 assert.equal(s.location.href,'');assert.equal(s.button.disabled,false);
});

test('signup confirmation mismatch prevents the request',async()=>{
 let calls=0;const s=setup('signup',async()=>{calls++;});s.fields.confirmPassword='different';
 await s.submit();assert.equal(calls,0);assert.equal(s.error.textContent,'Passwords do not match.');assert.equal(s.button.disabled,false);
});
test('show controls toggle password and signup-code visibility without submitting',()=>{
 for(const id of ['password','confirm-password','signup-code']){
  const field={type:'password'},attrs={'aria-label':'Show secret'};let click;
  const toggle={dataset:{togglePassword:id},getAttribute:name=>attrs[name],setAttribute:(name,value)=>attrs[name]=value,addEventListener:(name,fn)=>click=fn};
  const form={dataset:{mode:'signup'},addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/auth.js'),'utf8'),{document:{querySelectorAll:()=>[toggle],getElementById:key=>key===id?field:key==='auth-form'?form:{}}});
  click();assert.equal(field.type,'text');assert.equal(toggle.textContent,'Hide');assert.equal(attrs['aria-pressed'],'true');
  click();assert.equal(field.type,'password');assert.equal(toggle.textContent,'Show');assert.equal(attrs['aria-pressed'],'false');
 }
});

test('login change-password action authenticates before opening the protected form',async()=>{
 let submit;
 const form={dataset:{mode:'login'},querySelector:()=>({}),addEventListener:(event,fn)=>submit=fn};
 const location={href:''};let endpoint;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/auth.js'),'utf8'),{
  document:{getElementById:id=>id==='auth-form'?form:{},querySelectorAll:()=>[]},location,
  FormData:class{[Symbol.iterator](){return Object.entries({email:'test@example.com',password:'current-password'})[Symbol.iterator]();}},
  fetch:async url=>{endpoint=url;return {ok:true,json:async()=>({ok:true})};},SyntaxError
 });
 await submit({preventDefault(){},submitter:{dataset:{next:'password.html'}}});
 assert.equal(endpoint,'/api/login');assert.equal(location.href,'password.html');
});

test('password login in Google linking flow opens explicit account-link screen',async()=>{
 const form={dataset:{mode:'login'},querySelector:()=>({}),addEventListener:(_,fn)=>{form.submit=fn;}};
 const location={search:'?google=link',href:''};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/auth.js'),'utf8'),{
  document:{getElementById:id=>id==='auth-form'?form:{},querySelectorAll:()=>[]},location,
  FormData:class{[Symbol.iterator](){return Object.entries({email:'test@example.com',password:'test-password'})[Symbol.iterator]();}},
  fetch:async()=>({ok:true,json:async()=>({ok:true})}),SyntaxError
 });
 await form.submit({preventDefault(){}});
 assert.equal(location.href,'google-link.html');
});
