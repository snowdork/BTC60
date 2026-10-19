const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(mode,fetch){
 const button={},error={},location={href:''};let submit;
 const form={dataset:{mode},querySelector:()=>button,addEventListener:(name,fn)=>submit=fn};
 const fields={email:'test@example.com',password:'test-password',...(mode==='signup'?{name:'Taylor'}:{})};
 const context={document:{getElementById:id=>id==='auth-form'?form:error},location,fetch,SyntaxError,FormData:class{[Symbol.iterator](){return Object.entries(fields)[Symbol.iterator]();}}};
 vm.runInNewContext(fs.readFileSync('auth.js','utf8'),context);
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
 assert.match(s.error.textContent,/python3 server.py/);assert.equal(s.location.href,'');assert.equal(s.button.disabled,false);
});
