(function(root){
  'use strict';
  const coins=Object.freeze([
    {symbol:'BTC',name:'Bitcoin',product:'BTC-USD',precision:2,demoBase:67450,icon:'assets/coins/btc.svg'},
    {symbol:'ETH',name:'Ethereum',product:'ETH-USD',precision:2,demoBase:2500,icon:'assets/coins/eth.svg'},
    {symbol:'SOL',name:'Solana',product:'SOL-USD',precision:3,demoBase:110,icon:'assets/coins/sol.svg'},
    {symbol:'XRP',name:'XRP',product:'XRP-USD',precision:4,demoBase:1.4,icon:'assets/coins/xrp.svg'},
    {symbol:'DOGE',name:'Dogecoin',product:'DOGE-USD',precision:5,demoBase:.085,icon:'assets/coins/doge.svg'}
  ].map(Object.freeze));
  const getCoin=symbol=>coins.find(coin=>coin.symbol===symbol)||coins[0];
  const formatPrice=(value,symbol='BTC')=>Number.isFinite(value)?value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:getCoin(symbol).precision,maximumFractionDigits:getCoin(symbol).precision}):'—';
  const api={coins,getCoin,formatPrice};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RolrCoins=api;
})(typeof globalThis!=='undefined'?globalThis:this);
