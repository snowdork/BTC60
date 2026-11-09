const {test}=require('node:test');
const assert=require('node:assert/strict');
const {markup,priceMovement}=require('../../src/frontend/segment-card.js');
const market={id:'15-0',minutes:15,status:'settled',start:'17:00',end:'17:15',strike:100,close:110};

test('both card views show the confirmed green Up or red Down result, including ties as Up',()=>{
 for(const options of [{index:0},{}]){
  for(const [close,direction,arrow] of [[110,'up','↑'],[90,'down','↓'],[100,'up','↑']]){
   const html=markup({...market,close},options);
   assert.match(html,new RegExp(`class="play-settlement-arrow ${direction}"`));
   assert.match(html,new RegExp(`aria-label="${direction==='up'?'Up':'Down'} wins"`));
   assert(html.includes(`<span aria-hidden="true">${arrow}</span>`));
  }
 }
});

test('upcoming, live and unconfirmed results never get a completed result arrow',()=>{
 for(const values of [{status:'queued'},{status:'open'},{close:null},{strike:null}]){
  const html=markup({...market,...values});
  assert(!html.includes('play-settlement-arrow'));
 }
 assert.match(markup({...market,status:'queued'}),/data-state="upcoming"/);
});

test('price movement uses the starting price, including small moves and an unchanged Up result',()=>{
 assert.equal(priceMovement(200,202).label,'↑ Up +1.00% from start');
 assert.equal(priceMovement(200,198).label,'↓ Down −1.00% from start');
 assert.equal(priceMovement(100,100.0015).label,'↑ Up +0.0015% from start');
 assert.equal(priceMovement(100,100).label,'↑ Up +0.00% from start');
 for(const [start,current] of [[null,100],[0,100],[100,NaN],[100,0]])assert.equal(priceMovement(start,current),null);
});
