"""OilPriceAPI physical spot assessments, with original source dates."""
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from live_oil import positive

PROVIDER = 'OilPriceAPI'
SYMBOLS = {'WTI':'WTI_SPOT_USD','BRENT':'BRENT_SPOT_USD','DUBAI':'DUBAI_CRUDE_USD','OMAN':'OMAN_CRUDE_USD','BONNY':'BONNY_LIGHT_USD'}
KEY_FILE = Path(__file__).resolve().parents[2] / 'data' / 'oilpriceapi.key'
CACHE = {}
LOCK = threading.Lock()


def credential():
    """Resolve the provider key from the supported environment variables or private server-side key file."""
    key = os.environ.get('OILPRICE_API_KEY','').strip()
    if key:
        return key
    try:
        return KEY_FILE.read_text().strip()
    except OSError:
        return ''


def configured():
    """Report whether server-side credentials are available without exposing their contents."""
    return bool(credential())


def request(product):
    """Fetch provider JSON with server-side authentication and convert provider failures to safe application errors."""
    key = credential()
    if not key:
        raise ValueError('Oil feed needs an OilPriceAPI key on the server.')
    url = 'https://api.oilpriceapi.com/v1/prices/latest?' + urllib.parse.urlencode({'by_code':product})
    req = urllib.request.Request(url,headers={'Authorization':'Token '+key,'User-Agent':'Predict60/1.0'})
    try:
        with urllib.request.urlopen(req,timeout=8) as response:
            data = json.load(response)
    except Exception:
        raise ValueError('OilPriceAPI unavailable. Check trial access or request quota.') from None
    if not isinstance(data,dict) or data.get('status')!='success' or not isinstance(data.get('data'),dict):
        raise ValueError('OilPriceAPI returned an invalid response.')
    return data['data']


def quote(product):
    """Return a cached provider observation after checking instrument identity, units, and timestamp rules."""
    if product not in SYMBOLS.values():
        raise ValueError('This crude grade has no verified spot feed.')
    with LOCK:
        cached = CACHE.get(product)
        if cached and time.monotonic()-cached[0]<5:
            data = cached[1]
        else:
            try:
                data = request(product)
            except ValueError as error:
                data = {'error':str(error)}
            CACHE[product] = (time.monotonic(),data)
    if 'error' in data:
        raise ValueError(data['error'])
    if data.get('code')!=product or data.get('currency')!='USD' or data.get('unit')!='barrel':
        raise ValueError('OilPriceAPI returned a different instrument or unit.')
    if data.get('synthetic') or data.get('source')=='heartbeat':
        raise ValueError('OilPriceAPI returned a carried-forward value, not a new assessment.')
    if (data.get('benchmark') or {}).get('instrument_type')=='front_month_futures':
        raise ValueError('OilPriceAPI returned futures instead of physical spot.')
    raw = data.get('as_of') or data.get('observed_at') or data.get('source_date')
    try:
        stamp = datetime.fromisoformat(raw.replace('Z','+00:00'))
        if stamp.tzinfo is None:
            raise ValueError()
        stamp = stamp.timestamp()
        if stamp>time.time()+5:
            raise ValueError()
    except (ValueError,TypeError,AttributeError):
        raise ValueError('OilPriceAPI source timestamp unavailable or invalid.') from None
    return {'price':positive(data.get('price')),'time':int(stamp*1000),'source':PROVIDER,
            'quoteKind':'assessment','tradable':False,'sourceDate':data.get('source_date'),
            'message':'Latest spot assessment. This feed does not supply minute benchmarks for hourly predictions.'}


def fresh_spot(product):
    """Return a validated current quote; reject stale data and providers without tradable benchmarks."""
    raise ValueError('OilPriceAPI spot assessments cannot settle hourly predictions: minute benchmarks unavailable.')


def candles(product,start,end):
    """Reject minute-history requests because physical spot assessments cannot provide exact settlement candles."""
    raise ValueError('OilPriceAPI spot assessments do not provide exact minute candles. Hourly predictions unavailable.')
