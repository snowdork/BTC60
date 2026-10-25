const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../src/frontend/orientation.js'),'utf8');

function setup(options={}){
 const calls=[],buttonEvents={},documentEvents={},windowEvents={},attributes={};
 const label={textContent:''},hint={hidden:true,textContent:''},media={matches:!!options.landscape};
 const button={disabled:false,querySelector:()=>label,setAttribute(name,value){attributes[name]=value;},addEventListener(name,handler){buttonEvents[name]=handler;}};
 const root={};
 const document={documentElement:root,fullscreenElement:options.existingFullscreen?root:null,
  getElementById:id=>id==='landscape-button'?button:hint,
  addEventListener(name,handler){documentEvents[name]=handler;},
  async exitFullscreen(){calls.push('exit');this.fullscreenElement=null;documentEvents.fullscreenchange?.();}};
 if(!options.noFullscreen)root.requestFullscreen=async()=>{
  calls.push('fullscreen');
  if(options.fullscreenFails)throw Error('Permission denied');
  document.fullscreenElement=root;documentEvents.fullscreenchange?.();
 };
 const orientation=options.unsupported?{}:{
  async lock(value){calls.push(value);if(options.lockFails)throw Error('Unavailable');media.matches=true;},
  unlock(){calls.push('unlock');media.matches=false;},addEventListener(){}};
 const window={screen:{orientation},matchMedia:()=>media,addEventListener(name,handler){windowEvents[name]=handler;}};
 vm.runInNewContext(source,{document,window});
 return {button,label,hint,attributes,calls,media,document,documentEvents,windowEvents,click:()=>buttonEvents.click()};
}

test('landscape request enters fullscreen, locks orientation, and is reversible',async()=>{
 const s=setup();
 assert.equal(s.label.textContent,'Rotate');
 await s.click();
 assert.deepEqual(s.calls,['fullscreen','landscape']);
 assert.equal(s.label.textContent,'Auto rotate');
 assert.equal(s.attributes['aria-pressed'],'true');
 assert.equal(s.button.disabled,false);
 await s.click();
 assert.deepEqual(s.calls,['fullscreen','landscape','unlock','exit']);
 assert.equal(s.label.textContent,'Rotate');
 assert.equal(s.attributes['aria-pressed'],'false');
});
test('unsupported browsers receive physical rotation guidance without entering fullscreen',async()=>{
 const s=setup({unsupported:true});await s.click();
 assert.deepEqual(s.calls,[]);
 assert.equal(s.hint.hidden,false);
 assert.match(s.hint.textContent,/Turn your phone sideways/);
 assert.match(s.hint.textContent,/rotation lock/);
 assert.equal(s.button.disabled,false);
 s.media.matches=true;s.windowEvents.resize();
 assert.equal(s.label.textContent,'Landscape');
 assert.equal(s.button.disabled,true);
 assert.equal(s.hint.hidden,true);
});
test('failed locking restores fullscreen and leaves a working fallback',async()=>{
 const s=setup({lockFails:true});await s.click();
 assert.deepEqual(s.calls,['fullscreen','landscape','exit']);
 assert.equal(s.document.fullscreenElement,null);
 assert.equal(s.hint.hidden,false);
 assert.equal(s.button.disabled,false);
 assert.equal(s.attributes['aria-busy'],'false');
});
test('denied fullscreen displays guidance without attempting a lock',async()=>{
 const s=setup({fullscreenFails:true});await s.click();
 assert.deepEqual(s.calls,['fullscreen']);
 assert.equal(s.hint.hidden,false);
 assert.equal(s.label.textContent,'Rotate');
});
test('an existing landscape view is reflected without forcing rotation',()=>{
 const s=setup({landscape:true});
 assert.equal(s.label.textContent,'Landscape');
 assert.equal(s.button.disabled,true);
 assert.deepEqual(s.calls,[]);
 s.media.matches=false;s.windowEvents.resize();
 assert.equal(s.button.disabled,false);
 assert.equal(s.label.textContent,'Rotate');
});
test('exiting fullscreen through browser controls clears the requested orientation',async()=>{
 const s=setup();await s.click();
 s.document.fullscreenElement=null;s.documentEvents.fullscreenchange();
 assert.deepEqual(s.calls,['fullscreen','landscape','unlock']);
 assert.equal(s.label.textContent,'Rotate');
 assert.equal(s.attributes['aria-pressed'],'false');
});
test('restoring rotation preserves fullscreen entered by another control',async()=>{
 const s=setup({existingFullscreen:true});await s.click();await s.click();
 assert.deepEqual(s.calls,['landscape','unlock']);
 assert.notEqual(s.document.fullscreenElement,null);
});
test('orientation can be requested without fullscreen when the browser permits it',async()=>{
 const s=setup({noFullscreen:true});await s.click();
 assert.deepEqual(s.calls,['landscape']);
 assert.equal(s.label.textContent,'Auto rotate');
});
test('leaving the page releases rotation before a restored page is used again',async()=>{
 const s=setup();await s.click();s.windowEvents.pagehide();
 assert.deepEqual(s.calls,['fullscreen','landscape','unlock']);
 assert.equal(s.label.textContent,'Rotate');
 assert.equal(s.attributes['aria-pressed'],'false');
});
