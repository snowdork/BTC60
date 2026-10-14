"""Twelve Data spot quotes and UTC minute candles; never substitutes demo prices."""
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PROVIDER = 'Twelve Data'
MAX_AGE = 90  # Provider REST commodity quotes update minutely.
SYMBOLS = {'WTI':'WTI/USD', 'BRENT':'XBR/USD'}  # Verified against /commodities.
CACHE = {}
LOCK = threading.Lock()


def configured():
    return bool(os.environ.get('TWELVE_DATA_API_KEY') or os.environ.get('TWELVEDATA_API_KEY'))


def request(endpoint, params):
    key = os.environ.get('TWELVE_DATA_API_KEY') or os.environ.get('TWELVEDATA_API_KEY')
    if not key:
        raise ValueError('Oil feed needs a Twelve Data API key on the server.')
    url = 'https://api.twelvedata.com/' + endpoint + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'Authorization':'apikey '+key, 'User-Agent':'BTC60/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.load(response)
    except Exception:
        # Do not send provider errors or credentials to the browser or logs.
        raise ValueError('Oil provider unavailable. Retry shortly.') from None
    if not isinstance(data, dict) or data.get('status') == 'error':
        raise ValueError('Oil provider rejected the request. Check subscription, symbol access, or rate limits.')
    return data


def positive(value):
    try:
        result = float(value)
        if math.isfinite(result) and result > 0:
            return result
    except (TypeError,ValueError):
        pass
    raise ValueError('Oil provider returned an invalid price.')


def quote(product):
    if not product:
        raise ValueError('This crude grade has no verified live spot feed.')
    if not configured():
        raise ValueError('Oil feed needs a Twelve Data API key on the server.')
    with LOCK:
        cached = CACHE.get(('quote',product))
        if cached and time.monotonic()-cached[0] < 20:
            data = cached[1]
        else:
            try:
                data = request('quote', {'symbol':product, 'timezone':'UTC'})
            except ValueError as error:
                data = {'error':str(error)}
            CACHE[('quote',product)] = (time.monotonic(),data)
    if 'error' in data:
        raise ValueError(data['error'])
    currency=data.get('currency') or data.get('currency_quote') or product.rsplit('/',1)[-1]
    if data.get('symbol') != product or currency != 'USD':
        raise ValueError('Oil provider returned a different instrument or currency.')
    if data.get('is_market_open') is False:
        raise ValueError('Oil market closed. Waiting for the next trading session.')
    try:
        stamp = float(data.get('last_update_at') or data.get('last_quote_at'))
        if not math.isfinite(stamp) or not -5 <= time.time()-stamp <= MAX_AGE:
            raise ValueError()
    except (TypeError,ValueError):
        raise ValueError('Oil price is stale. Waiting for a fresh provider quote.') from None
    return {'price':positive(data.get('close')), 'time':int(stamp*1000), 'source':PROVIDER, 'maxAgeMs':MAX_AGE*1000}


def candles(product, start, end):
    if not product:
        raise ValueError('This crude grade has no verified live spot feed.')
    boundary = int(time.time())//60*60
    cache_key = ('candles',product,int(start),int(end),boundary)
    with LOCK:
        cached = CACHE.get(cache_key)
        if cached and time.monotonic()-cached[0] < 60:
            return cached[1]
    utc = lambda stamp: datetime.fromtimestamp(stamp,timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    data = request('time_series', {'symbol':product,'interval':'1min','timezone':'UTC',
                   'start_date':utc(start),'end_date':utc(end),'outputsize':5000,'order':'asc'})
    meta = data.get('meta',{})
    if meta.get('symbol') != product or meta.get('interval') != '1min' or (meta.get('currency') or meta.get('currency_quote') or product.rsplit('/',1)[-1]) != 'USD':
        raise ValueError('Oil provider returned incompatible candle metadata.')
    if not isinstance(data.get('values'),list):
        raise ValueError('Oil minute history unavailable.')
    result = {}
    for row in data['values']:
        try:
            stamp = int(datetime.strptime(row['datetime'],'%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp())
            low,high,opening,close = [positive(row.get(field)) for field in ('low','high','open','close')]
            if low>min(opening,close) or high<max(opening,close) or stamp%60:
                raise ValueError()
        except (TypeError,KeyError,ValueError):
            raise ValueError('Oil provider returned invalid minute history.') from None
        if start <= stamp and stamp+60 <= min(end,boundary):
            result[stamp] = [stamp,low,high,opening,close,0]
    if not result:
        raise ValueError('Oil minute history unavailable for this interval.')
    candles = sorted(result.values())
    with LOCK:
        for key in list(CACHE):
            if time.monotonic()-CACHE[key][0] > 120:
                del CACHE[key]
        CACHE[cache_key] = (time.monotonic(),candles)
    return candles
