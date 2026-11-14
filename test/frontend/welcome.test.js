const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function harness(){
 const node=()=>({listeners:{},attrs:{},addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this.attrs[name]=value;}});
 const views=['interval','hour'].map(name=>Object.assign(node(),{dataset:{demoView:name}}));
 const panels=['interval','hour'].map(name=>({dataset:{demoPanel:name},hidden:name==='hour'}));
 const dialog=Object.assign(node(),{open:false,showModal(){this.open=true;},close(){this.open=false;},
  querySelectorAll:selector=>selector==='[data-demo-view]'?views:panels,
  getBoundingClientRect:()=>({left:10,right:110,top:10,bottom:110})});
 const elements={'welcome-demo':dialog,'welcome-demo-open':node(),'welcome-demo-close':node()};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/frontend/welcome.js'),'utf8'),{document:{getElementById:id=>elements[id]}});
 return {dialog,views,panels,elements};
}
test('demo switches snapshots with matching visible panels and accessible selection',()=>{
 const h=harness();h.elements['welcome-demo-open'].listeners.click();assert.equal(h.dialog.open,true);
 for(const index of [1,0]){
  h.views[index].listeners.click();
  h.views.forEach((view,i)=>assert.equal(view.attrs['aria-pressed'],String(index===i)));
  h.panels.forEach((panel,i)=>assert.equal(panel.hidden,index!==i));
 }
 h.elements['welcome-demo-close'].listeners.click();assert.equal(h.dialog.open,false);
});
test('demo stays open on content clicks and closes only on its backdrop',()=>{
 const h=harness(),click=h.dialog.listeners.click;
 h.dialog.showModal();click({target:{},clientX:0,clientY:0});assert.equal(h.dialog.open,true);
 click({target:h.dialog,clientX:50,clientY:50});assert.equal(h.dialog.open,true);
 click({target:h.dialog,clientX:5,clientY:50});assert.equal(h.dialog.open,false);
});
