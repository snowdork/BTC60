const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(fetch,hidden=false){
 const users={},active={},events={},calls=[];
 const document={hidden,querySelector:s=>s==='[data-user-count]'?users:active,addEventListener:(n,f)=>events[n]=f};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/community.js'),'utf8'),{document,window:{addEventListener:(n,f)=>events[n]=f},setInterval:f=>events.tick=f,fetch:(...args)=>{calls.push(args);return fetch(...args);}});
 return {users,active,events,calls,document};
}
const response=data=>({ok:true,json:async()=>data});
test('shows actual counts including zero without caching',async()=>{
 const s=setup(()=>response({users:0,activeUsers:0}));await flush();
 assert.equal(s.users.textContent,'0');assert.equal(s.active.textContent,'0');assert.equal(s.calls[0][0],'/api/community');assert.equal(s.calls[0][1].cache,'no-store');
});
test('malformed and unavailable responses show unknown instead of invented counts',async()=>{
 for(const fetch of [()=>response({users:-1,activeUsers:2}),()=>response({users:2,activeUsers:1.5}),()=>response({users:'2',activeUsers:1}),()=>({ok:false}),()=>{throw Error('offline');},()=>({ok:true,json:async()=>{throw SyntaxError();}})]){
  const s=setup(fetch);await flush();assert.equal(s.users.textContent,'—');assert.equal(s.active.textContent,'—');
 }
});
test('hidden tabs pause polling and visibility resumes it',async()=>{
 const s=setup(()=>response({users:3,activeUsers:1}),true);assert.equal(s.calls.length,0);
 s.events.tick();assert.equal(s.calls.length,0);s.document.hidden=false;await s.events.visibilitychange();assert.equal(s.active.textContent,'1');
});
test('concurrent refresh events share one in-flight request',async()=>{
 let finish;const s=setup(()=>new Promise(resolve=>finish=resolve));
 s.events.tick();s.events.focus();assert.equal(s.calls.length,1);
 finish(response({users:3,activeUsers:2}));await flush();
 const next=s.events.focus();assert.equal(s.calls.length,2);finish(response({users:3,activeUsers:2}));await next;
});
test('recovers on the next refresh after a network error',async()=>{
 let attempt=0;const s=setup(()=>++attempt===1?Promise.reject(Error('offline')):response({users:4,activeUsers:1}));
 await flush();assert.equal(s.users.textContent,'—');await s.events.tick();assert.equal(s.users.textContent,'4');
});
