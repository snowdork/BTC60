/** @module coins
 * Validate and freeze category-specific instrument catalogs and format their prices.
 */
(function(root){
  'use strict';
  /** Validate server instrument records, freeze the catalog, and select enabled instruments for the requested category. */ function createCatalog(records,category='crypto'){
    if(!Array.isArray(records))throw Error('Invalid coin catalog.');
    // Validate every record before publishing an immutable category catalog.
    const coins=Object.freeze(records.map(record=>{
      if(!record||typeof record.symbol!=='string'||typeof record.name!=='string'||typeof record.product!=='string'||!Number.isInteger(record.precision)||record.precision<0||record.precision>12||!Number.isFinite(record.demoBase)||record.demoBase<=0)throw Error('Invalid coin catalog.');
      const oilIcon=record.category==='oil'&&['WTI','BRENT','DUBAI','OMAN','BONNY'].includes(record.symbol)?`assets/coins/oil-${record.symbol.toLowerCase()}.svg`:record.icon;
      return Object.freeze({category:'crypto',feed:'coinbase',unit:'USD',...record,icon:oilIcon,enabled:!!record.enabled});
    }));
    const available=Object.freeze(coins.filter(coin=>coin.enabled&&coin.category===category).slice(0,8));
    const /** Find an instrument by symbol, falling back to the first available catalog entry. */ getCoin=symbol=>coins.find(coin=>coin.symbol===symbol)||available[0]||coins[0];
    const /** Format a finite instrument price with its configured precision, or show an unknown-value marker. */ formatPrice=(value,symbol)=>Number.isFinite(value)?value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:getCoin(symbol)?.precision??2,maximumFractionDigits:getCoin(symbol)?.precision??2}):'—';
    return {coins,available,getCoin,formatPrice};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={createCatalog};
  else root.PredictCoinCatalog={createCatalog};
})(typeof globalThis!=='undefined'?globalThis:this);
