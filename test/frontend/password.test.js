const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(fields,reply={ok:true,json:async()=>({ok:true})}){
 const button={disabled:false},error={textContent:''},status={textContent:''},calls=[];
 const form={querySelector:()=>button,addEventListener:(name,fn)=>form.submit=fn,reset(){this.resetCalled=true;}};
 const nodes={'password-form':form,'password-error':error,'password-status':status};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/password.js'),'utf8'),{document:{getElementById:id=>nodes[id]},window:{Predict60Account:{loaded:Promise.resolve(),csrf:'secret'}},FormData:class{constructor(){return Object.entries(fields);}},location:{replace(){}},fetch:async(url,options)=>{calls.push({url,options});return reply;}});
 return {form,button,error,status,calls,submit:()=>form.submit({preventDefault(){}})};
}
const fields={currentPassword:'old-password',newPassword:'new-password',confirmPassword:'new-password'};
test('password change sends CSRF and clears secrets after success',async()=>{
 const s=setup(fields);await s.submit();
 assert.equal(s.calls[0].url,'/api/change-password');
 assert.equal(s.calls[0].options.headers['X-CSRF-Token'],'secret');
 assert.deepEqual(JSON.parse(s.calls[0].options.body),fields);
 assert.equal(s.form.resetCalled,true);assert.match(s.status.textContent,/Password changed/);assert.equal(s.button.disabled,false);
});
test('confirmation mismatch prevents submission',async()=>{
 const s=setup({...fields,confirmPassword:'different'});await s.submit();
 assert.equal(s.calls.length,0);assert.equal(s.error.textContent,'Passwords do not match.');
});
test('incorrect current password permits retry without clearing fields',async()=>{
 const s=setup(fields,{ok:false,status:403,json:async()=>({error:'Current password is incorrect.'})});await s.submit();
 assert.equal(s.error.textContent,'Current password is incorrect.');assert.equal(s.form.resetCalled,undefined);assert.equal(s.button.disabled,false);
});
