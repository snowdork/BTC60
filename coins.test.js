const {test}=require('node:test');
const assert=require('node:assert/strict');
const {coins,getCoin,formatPrice}=require('./coins.js');
test('five supported coins each have a USD feed and local icon',()=>{assert.deepEqual(coins.map(c=>c.symbol),['BTC','ETH','SOL','XRP','DOGE']);for(const coin of coins){assert.equal(coin.product,coin.symbol+'-USD');assert(require('node:fs').existsSync(coin.icon));}});
test('small coin prices retain meaningful decimals',()=>{assert.equal(formatPrice(.08531,'DOGE'),'$0.08531');assert.equal(formatPrice(1.4063,'XRP'),'$1.4063');assert.equal(formatPrice(110.171,'SOL'),'$110.171');assert.equal(formatPrice(2508.12,'ETH'),'$2,508.12');assert.equal(formatPrice(83005.04,'BTC'),'$83,005.04');assert.equal(formatPrice(NaN,'DOGE'),'—');});
test('unknown preferences fall back to Bitcoin',()=>{assert.equal(getCoin('INVALID').symbol,'BTC');});
