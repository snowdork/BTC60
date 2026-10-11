(function(root){
  'use strict';
  function createCatalog(records){
    if(!Array.isArray(records))throw Error('Invalid coin catalog.');
    const coins=Object.freeze(records.map(record=>{
      if(!record||typeof record.symbol!=='string'||typeof record.name!=='string'||typeof record.product!=='string'||!Number.isInteger(record.precision)||record.precision<0||record.precision>12||!Number.isFinite(record.demoBase)||record.demoBase<=0)throw Error('Invalid coin catalog.');
      return Object.freeze({...record,enabled:!!record.enabled});
    }));
    const available=Object.freeze(coins.filter(coin=>coin.enabled).slice(0,8));
    const getCoin=symbol=>coins.find(coin=>coin.symbol===symbol)||available[0]||coins[0];
    const formatPrice=(value,symbol)=>Number.isFinite(value)?value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:getCoin(symbol)?.precision??2,maximumFractionDigits:getCoin(symbol)?.precision??2}):'—';
    return {coins,available,getCoin,formatPrice};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={createCatalog};
  else root.RolrCoinCatalog={createCatalog};
})(typeof globalThis!=='undefined'?globalThis:this);
