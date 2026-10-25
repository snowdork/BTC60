const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const hour=1800000000;
function setup(){
 const nodes=new Map(),requests=[];
 function node(){return {value:'',children:[],handlers:{},disabled:false,append(...items){this.children.push(...items);if(!this.value&&items[0]?.value)this.value=items[0].value;},replaceChildren(...items){this.children=[];this.value='';this.append(...items);},addEventListener(event,fn){this.handlers[event]=fn;}};}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const period=(start,id,state='final')=>({id,starts_at:start,ends_at:start+3600,state,participants:1,prizes:[],mine:{rank:1,score_cents:-5000,pending:0},winners:state==='final'?[{name:'<Player>',score_cents:-5000}]:[],leaders:[{rank:1,name:'<Player>',score_cents:-5000,predictions:1,pending:0}]});
 const data={wallet:{remaining_cents:100000,net_cents:0,resets_at:hour+3600,starts_at:hour,reset_pending:false},contests:[period(hour,3,'open'),period(hour-3600,2),period(hour-7200,1)],prizes:[],next_before:hour-7200};
 const context={document:{hidden:false,getElementById:get,createElement:node,addEventListener(){}},window:{Predict60Account:{user:{}},addEventListener(){}},setInterval(){},Date:class extends Date{static now(){return hour*1000+60000;}},fetch:async url=>{requests.push(url);return {ok:true,json:async()=>data};}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/contests.js'),'utf8'),context);
 return {get,data,requests,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('last hour shows signed loss and final winner as text',async()=>{
 const s=setup();await s.flush();s.get('contest-last').handlers.click();await s.flush();
 assert.equal(s.requests.at(-1),`/api/contests?before=${hour-3599}`);
 assert.match(s.get('contest-mine').textContent,/-50.00 credits won \/ lost/);
 assert.equal(s.get('contest-winner').textContent,'Winner: <Player> · -50.00 net credits');
});
test('older history uses the server cursor and GMT lookup selects an exact hour',async()=>{
 const s=setup();await s.flush();s.get('contest-older').handlers.click();await s.flush();
 assert.equal(s.requests.at(-1),`/api/contests?before=${hour-7200}`);
 s.get('contest-date').value=new Date((hour-3600)*1000).toISOString().slice(0,16);
 s.get('contest-lookup').handlers.click();await s.flush();
 assert.equal(s.get('contest-period').value,'2');
});
test('new hour credits remain available while the previous winner awaits settlement',async()=>{
 const s=setup();s.data.contests[1].state='awaiting_settlement';await s.flush();
 assert.equal(s.get('contest-wallet').textContent,'1,000.00 credits');
 assert.match(s.get('contest-reset-note').textContent,/Every player starts each new GMT hour with 1,000 credits/);
 assert.equal(s.get('contest-winner').textContent,'Winner declared after all hourly predictions settle.');
});
test('lookup with no recorded hour clears stale results',async()=>{
 const s=setup();await s.flush();s.data.contests=[];s.data.next_before=null;
 s.get('contest-last').handlers.click();await s.flush();
 assert.equal(s.get('contest-title').textContent,'No recorded contest for this hour');
 assert.equal(s.get('contest-leaders').children.length,0);
 assert.equal(s.get('contest-older').disabled,true);
});
