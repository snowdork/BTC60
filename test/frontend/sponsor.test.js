const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../src/frontend/sponsor.js'),'utf8');
async function render(data,ok=true){
 const strips=[];
 const document={createElement(tag){return {tag,children:[],setAttribute(name,value){this[name]=value;},append(...children){this.children.push(...children);}};},querySelector(){return {after(strip){strips.push(strip);}};}};
 await vm.runInNewContext(source,{document,URL,fetch:async()=>({ok,json:async()=>data})});
 return strips;
}
test('sponsor strip is absent when disabled, unavailable, or unsafe',async()=>{
 for(const data of [{enabled:false},{enabled:true,url:'javascript:alert(1)'},{enabled:true,url:'https://user:secret@example.com'}])assert.equal((await render(data)).length,0);
 assert.equal((await render({},false)).length,0);
});
test('sponsor content stays plain text and outbound link has safe sponsored attributes',async()=>{
 const strips=await render({enabled:true,name:'<img src=x onerror=alert(1)>',message:'Sponsor message',url:'https://example.com/offer'});
 assert.equal(strips.length,1);
 const strip=strips[0],link=strip.children[2];
 assert.equal(strip['aria-label'],'Advertisement');
 assert.equal(strip.children[0].textContent,'ADVERTISEMENT');
 assert.equal(link.textContent,'<img src=x onerror=alert(1)>');
 assert.equal(link.href,'https://example.com/offer');
 assert.equal(link.rel,'sponsored noopener noreferrer');
 assert.equal(link.children.length,0);
});
