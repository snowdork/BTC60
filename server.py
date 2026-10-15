"""Local BTC60 demo server: SQLite accounts, sessions, orders and settlements."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, ROUND_CEILING
import argparse
import odds
import simulated_prices
import live_oil
import oilprice_api
import weather
import fcntl
import hashlib
import gzip
import json
import math
import logging
from btc60_logging import configure
import os
import re
import secrets
import sqlite3
import time
import threading
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get('BTC60_DB', str(ROOT / 'data' / 'btc60.sqlite3')))
QUOTES = {'60-0': 68, '30-0': 54, '30-1': 58, '15-0': 49, '15-1': 57, '15-2': 62, '15-3': 50}
AUTH_ATTEMPTS = {}
AUTH_LOCK = threading.Lock()
SETTLE_LOCK = threading.Lock()
STATIC_CACHE = {}
LOG = logging.getLogger(__name__)


def connect():
    conn = sqlite3.connect(DB, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        seed_coins = not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coins'").fetchone()
        conn.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS coins (
          symbol TEXT PRIMARY KEY, name TEXT NOT NULL, product TEXT UNIQUE NOT NULL,
          precision INTEGER NOT NULL CHECK(precision BETWEEN 0 AND 12),
          demo_base REAL NOT NULL CHECK(demo_base>0), icon TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS catalog_migrations (version INTEGER PRIMARY KEY);
        CREATE TRIGGER IF NOT EXISTS max_enabled_coins_insert BEFORE INSERT ON coins
        WHEN NEW.enabled=1 AND (SELECT count(*) FROM coins WHERE enabled=1)>=8
        BEGIN SELECT RAISE(ABORT,'Maximum 8 enabled prediction coins'); END;
        CREATE TRIGGER IF NOT EXISTS max_enabled_coins_update BEFORE UPDATE OF enabled ON coins
        WHEN NEW.enabled=1 AND OLD.enabled=0 AND (SELECT count(*) FROM coins WHERE enabled=1)>=8
        BEGIN SELECT RAISE(ABORT,'Maximum 8 enabled prediction coins'); END;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL, salt TEXT NOT NULL,
          balance_cents INTEGER NOT NULL DEFAULT 1425000 CHECK(balance_cents>=0), created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS predictions (
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
          coin TEXT NOT NULL REFERENCES coins(symbol), market_id TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('up','down')),
          starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, strike REAL NOT NULL,
          cents INTEGER NOT NULL CHECK(cents BETWEEN 1 AND 99), contracts INTEGER NOT NULL CHECK(contracts>0),
          cost_cents INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id,request_id));
        CREATE TABLE IF NOT EXISTS settlements (
          prediction_id TEXT PRIMARY KEY REFERENCES predictions(id), close_price REAL NOT NULL,
          outcome TEXT NOT NULL, payout_cents INTEGER NOT NULL, settled_at INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'Coinbase minute-close proxy');
        CREATE TRIGGER IF NOT EXISTS prediction_coin_exists BEFORE INSERT ON predictions
        WHEN NOT EXISTS(SELECT 1 FROM coins WHERE symbol=NEW.coin)
        BEGIN SELECT RAISE(ABORT,'Unknown coin'); END;
        CREATE TRIGGER IF NOT EXISTS preserve_prediction_coin BEFORE DELETE ON coins
        WHEN EXISTS(SELECT 1 FROM predictions WHERE coin=OLD.symbol)
        BEGIN SELECT RAISE(ABORT,'Coin has predictions; disable it instead'); END;
        CREATE TRIGGER IF NOT EXISTS preserve_prediction_symbol BEFORE UPDATE OF symbol ON coins
        WHEN EXISTS(SELECT 1 FROM predictions WHERE coin=OLD.symbol)
        BEGIN SELECT RAISE(ABORT,'Coin has predictions; preserve its symbol'); END;
        CREATE INDEX IF NOT EXISTS predictions_user ON predictions(user_id,created_at);
        ''')
        if seed_coins:
            for coin in json.loads((ROOT / 'coins.seed.json').read_text()):
                conn.execute('INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order) VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(coin['enabled']),coin['sortOrder']))
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=1').fetchone():
            # Add new catalog entries once, preserving administrator changes on restart.
            for coin in json.loads((ROOT / 'coins.seed.json').read_text())[5:]:
                if conn.execute('SELECT 1 FROM coins WHERE symbol=?', (coin['symbol'],)).fetchone():
                    continue
                room = conn.execute('SELECT count(*) FROM coins WHERE enabled=1').fetchone()[0] < 8
                conn.execute('INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order) VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(coin['enabled'] and room),coin['sortOrder']))
            conn.execute('INSERT INTO catalog_migrations VALUES(1)')
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=2').fetchone():
            conn.execute("UPDATE coins SET enabled=0 WHERE symbol='LINK'")
            coin = next(c for c in json.loads((ROOT / 'coins.seed.json').read_text()) if c['symbol']=='LTC')
            room = conn.execute('SELECT count(*) FROM coins WHERE enabled=1').fetchone()[0] < 8
            conn.execute('INSERT OR IGNORE INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order) VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(room),coin['sortOrder']))
            conn.execute('INSERT INTO catalog_migrations VALUES(2)')


        # Add categories without rebuilding existing accounts or prediction tables.
        conn.execute('CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, icon TEXT NOT NULL, accent TEXT NOT NULL, background TEXT NOT NULL, unit TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)')
        for category in json.loads((ROOT / 'categories.seed.json').read_text()):
            conn.execute('INSERT OR IGNORE INTO categories VALUES(?,?,?,?,?,?,?,?)', (category['id'],category['name'],category['description'],category['icon'],category['accent'],category['background'],category['unit'],category['sortOrder']))
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(coins)')}
        for name, definition in [('category', "TEXT NOT NULL DEFAULT 'crypto'"), ('feed', "TEXT NOT NULL DEFAULT 'coinbase' CHECK(feed IN ('coinbase','simulated'))"), ('unit', "TEXT NOT NULL DEFAULT 'USD'")]:
            if name not in columns:
                conn.execute(f'ALTER TABLE coins ADD COLUMN {name} {definition}')
        conn.executescript("""
        DROP TRIGGER IF EXISTS max_enabled_coins_insert;
        DROP TRIGGER IF EXISTS max_enabled_coins_update;
        CREATE TRIGGER max_enabled_coins_insert BEFORE INSERT ON coins
        WHEN NEW.enabled=1 AND (SELECT count(*) FROM coins WHERE enabled=1 AND category=NEW.category)>=8
        BEGIN SELECT RAISE(ABORT,'Maximum 8 enabled instruments per category'); END;
        CREATE TRIGGER max_enabled_coins_update BEFORE UPDATE OF enabled,category ON coins
        WHEN NEW.enabled=1 AND (OLD.enabled=0 OR OLD.category<>NEW.category)
          AND (SELECT count(*) FROM coins WHERE enabled=1 AND category=NEW.category)>=8
        BEGIN SELECT RAISE(ABORT,'Maximum 8 enabled instruments per category'); END;
        CREATE TRIGGER IF NOT EXISTS preserve_prediction_feed BEFORE UPDATE OF product,feed,category,demo_base ON coins
        WHEN (NEW.product<>OLD.product OR NEW.feed<>OLD.feed OR NEW.category<>OLD.category OR NEW.demo_base<>OLD.demo_base)
          AND EXISTS(SELECT 1 FROM predictions WHERE coin=OLD.symbol)
        BEGIN SELECT RAISE(ABORT,'Instrument has predictions; preserve its price source'); END;
        CREATE TRIGGER IF NOT EXISTS instrument_category_insert BEFORE INSERT ON coins
        WHEN NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.category)
        BEGIN SELECT RAISE(ABORT,'Unknown category'); END;
        CREATE TRIGGER IF NOT EXISTS instrument_category_update BEFORE UPDATE OF category ON coins
        WHEN NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.category)
        BEGIN SELECT RAISE(ABORT,'Unknown category'); END;
        CREATE TRIGGER IF NOT EXISTS preserve_instrument_category BEFORE DELETE ON categories
        WHEN EXISTS(SELECT 1 FROM coins WHERE category=OLD.id)
        BEGIN SELECT RAISE(ABORT,'Category has instruments'); END;
        CREATE TRIGGER IF NOT EXISTS preserve_category_id BEFORE UPDATE OF id ON categories
        WHEN EXISTS(SELECT 1 FROM coins WHERE category=OLD.id)
        BEGIN SELECT RAISE(ABORT,'Category has instruments; preserve its id'); END;
        CREATE INDEX IF NOT EXISTS coins_category ON coins(category,enabled,sort_order);
        """)
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=3').fetchone():
            for instrument in json.loads((ROOT / 'oil.seed.json').read_text()):
                conn.execute('INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order,category,feed,unit) VALUES(?,?,?,?,?,?,?,?,?,?,?)', (instrument['symbol'],instrument['name'],instrument['product'],instrument['precision'],instrument['demoBase'],instrument['icon'],int(instrument['enabled']),instrument['sortOrder'],instrument['category'],instrument['feed'],instrument['unit']))
            conn.execute('INSERT INTO catalog_migrations VALUES(3)')

        conn.executescript("""
        CREATE TABLE IF NOT EXISTS instrument_sources(
          coin TEXT PRIMARY KEY REFERENCES coins(symbol), provider TEXT NOT NULL CHECK(provider='twelvedata'),
          product TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS prediction_sources(
          prediction_id TEXT PRIMARY KEY REFERENCES predictions(id), provider TEXT NOT NULL,
          product TEXT NOT NULL);
        """)
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=4').fetchone():
            for row in conn.execute("SELECT symbol FROM coins WHERE category='oil'").fetchall():
                conn.execute('INSERT OR IGNORE INTO instrument_sources VALUES(?,?,?)',(row['symbol'],'twelvedata',live_oil.SYMBOLS.get(row['symbol'],'')))
            conn.execute('INSERT INTO catalog_migrations VALUES(4)')

        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=5').fetchone():
            conn.executescript("""
            ALTER TABLE instrument_sources RENAME TO instrument_sources_v4;
            CREATE TABLE instrument_sources(
              coin TEXT PRIMARY KEY REFERENCES coins(symbol),
              provider TEXT NOT NULL CHECK(provider IN ('twelvedata','oilpriceapi')),
              product TEXT NOT NULL DEFAULT '');
            INSERT INTO instrument_sources SELECT * FROM instrument_sources_v4;
            DROP TABLE instrument_sources_v4;
            INSERT INTO catalog_migrations VALUES(5);
            """)
        if oilprice_api.configured():
            for symbol,product in oilprice_api.SYMBOLS.items():
                conn.execute("UPDATE instrument_sources SET provider='oilpriceapi',product=? WHERE coin=?",(product,symbol))

    os.chmod(DB, 0o600)


def instrument_source(coin, legacy=False):
    with connect() as conn:
        row=conn.execute('SELECT symbol,product,feed,demo_base,category FROM coins WHERE symbol=?',(coin,)).fetchone()
        override=None if legacy else conn.execute('SELECT provider,product FROM instrument_sources WHERE coin=?',(coin,)).fetchone()
    if not row:
        raise ValueError('Unknown instrument.')
    source=dict(row)
    if override:
        source.update(feed=override['provider'],product=override['product'])
    return source


def candle_close(coin, boundary, source=None):
    record=source or instrument_source(coin)
    if record['feed']=='oilpriceapi':
        raise ValueError('OilPriceAPI spot feed has no minute benchmark for this interval.')
    if record['feed']=='twelvedata':
        history=live_oil.candles(record['product'],boundary-60,boundary)
        candle=next((c for c in history if c[0]==boundary-60),None)
        if candle is None:raise ValueError('Exact oil settlement minute unavailable. Retry shortly.')
        return candle[4]
    if record['feed']=='simulated':
        return simulated_prices.price(coin, record['demo_base'], boundary-1)
    product = urllib.parse.quote(record['product'], safe='')
    start = datetime.fromtimestamp(boundary - 60, timezone.utc).isoformat()
    end = datetime.fromtimestamp(boundary, timezone.utc).isoformat()
    query = urllib.parse.urlencode({'granularity': 60, 'start': start, 'end': end})
    request = urllib.request.Request(f'https://api.exchange.coinbase.com/products/{product}/candles?{query}', headers={'User-Agent': 'BTC60-local-demo/1.0'})
    with urllib.request.urlopen(request, timeout=8) as response:
        candles = json.load(response)
    for candle in candles:
        if candle[0] == boundary - 60 and math.isfinite(float(candle[4])) and float(candle[4]) > 0:
            return float(candle[4])
    raise ValueError('Benchmark history is unavailable. Try again shortly.')


def fresh_spot(coin, source=None):
    record=source or instrument_source(coin)
    if record['feed']=='oilpriceapi':
        return oilprice_api.fresh_spot(record['product'])
    if record['feed']=='twelvedata':
        return live_oil.quote(record['product'])['price']
    if record['feed']=='simulated':
        return simulated_prices.price(coin, record['demo_base'], int(time.time()))
    product = record['product']
    request = urllib.request.Request('https://api.exchange.coinbase.com/products/'+urllib.parse.quote(product,safe='')+'/ticker', headers={'User-Agent':'BTC60-local-demo/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            ticker = json.load(response)
        timestamp = datetime.fromisoformat(ticker['time'].replace('Z','+00:00')).timestamp()
        price = float(ticker['price'])
        if not math.isfinite(price) or price<=0 or not -5 <= time.time()-timestamp <= 15:
            raise ValueError('Price feed stale. Wait for a fresh price before predicting.')
        return price
    except ValueError:
        raise
    except Exception:
        raise ValueError('Live price unavailable. Reconnect before predicting.')


def estimated_up(strike, spot, now, start, end, volatility, calibration=None):
    return max(1, min(99, math.floor(100*odds.probability(strike, spot, now, end, volatility, calibration)+.5)))


HISTORY_CACHE = {}
HISTORY_LOCK = threading.Lock()


def pricing_history(product, now, instrument=None):
    if instrument and instrument['feed']=='oilpriceapi':
        return oilprice_api.candles(product,0,0)
    if instrument and instrument['feed']=='twelvedata':
        boundary=int(now)//60*60
        return live_oil.candles(product,boundary-86400,boundary)
    if instrument and instrument['feed']=='simulated':
        boundary=int(now)//60*60
        return simulated_prices.candles(instrument['symbol'],instrument['demo_base'],boundary-86400,boundary)
    # Six requests stay below Coinbase's 300-candle limit per request.
    boundary = int(now)//60*60
    key = (product, boundary)
    with HISTORY_LOCK:
        cached = HISTORY_CACHE.get(key)
    if cached is not None:
        return cached
    with HISTORY_LOCK:
        previous = max((k for k in HISTORY_CACHE if k[0]==product and 0<boundary-k[1]<=300), default=None, key=lambda k:k[1])
        previous_candles = list(HISTORY_CACHE[previous]) if previous else []
    candles = {c[0]:c for c in previous_candles if boundary-86400<=c[0]<boundary}
    ranges = [(previous[1]-60,boundary)] if previous else [(boundary-(i+1)*14400,boundary-i*14400) for i in range(6)]

    def fetch_batch(interval):
        start,end=interval
        query=urllib.parse.urlencode({'granularity':60,'start':datetime.fromtimestamp(start,timezone.utc).isoformat(),'end':datetime.fromtimestamp(end,timezone.utc).isoformat()})
        request=urllib.request.Request('https://api.exchange.coinbase.com/products/'+urllib.parse.quote(product,safe='')+'/candles?'+query,headers={'User-Agent':'BTC60-local-demo/1.0'})
        with urllib.request.urlopen(request,timeout=8) as response:
            batch=json.load(response)
        if not isinstance(batch,list):raise ValueError('Invalid pricing history.')
        return [c for c in batch if isinstance(c,list) and len(c)>=5 and all(isinstance(c[i],(int,float)) and math.isfinite(c[i]) for i in (0,4)) and c[4]>0 and start<=c[0]<end]

    # A cold load takes two bounded waves; subsequent minutes fetch only the delta.
    with ThreadPoolExecutor(max_workers=3) as pool:
        for batch in pool.map(fetch_batch,ranges):
            candles.update({c[0]:c for c in batch})
    result=sorted(candles.values())
    with HISTORY_LOCK:
        for old in list(HISTORY_CACHE):
            if boundary-old[1]>600:del HISTORY_CACHE[old]
        HISTORY_CACHE[key]=result
    return result


def market_up(coin, strike, spot, now, start, end, source=None):
    instrument=source or instrument_source(coin)
    try:
        volatility = odds.minute_volatility(pricing_history(instrument['product'], now, instrument), now)
        return estimated_up(strike, spot, now, start, end, volatility, odds.calibrations().get(coin))
    except Exception:
        raise ValueError('Pricing history unavailable. Review again shortly.')


def _settle_due(user_id=None):
    with connect() as conn:
        pending = conn.execute('SELECT p.* FROM predictions p LEFT JOIN settlements s ON s.prediction_id=p.id WHERE s.prediction_id IS NULL AND p.ends_at<=? AND (? IS NULL OR p.user_id=?)', (int(time.time()) - 5, user_id, user_id)).fetchall()
    prices = {}
    for p in pending:
        with connect() as conn:
            snapshot=conn.execute('SELECT provider,product FROM prediction_sources WHERE prediction_id=?',(p['id'],)).fetchone()
        source=instrument_source(p['coin'],legacy=True)
        if snapshot:source.update(feed=snapshot['provider'],product=snapshot['product'])
        key = (p['coin'], p['ends_at'], source['feed'], source['product'])
        try:
            if key not in prices:
                prices[key] = candle_close(p['coin'],p['ends_at'],source=source)
            close = prices[key]
        except Exception:
            LOG.debug('Settlement deferred prediction=%s', p['id'], exc_info=True)
            continue  # Keep pending and retry; never invent a settlement.
        outcome = 'up' if close >= p['strike'] else 'down'
        payout = (p['cost_cents']*100+p['cents']-1)//p['cents'] if outcome == p['side'] else 0
        with connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            settlement_source='Twelve Data live oil minute close' if source['feed']=='twelvedata' else 'Simulated oil minute close · '+simulated_prices.VERSION if source['feed']=='simulated' else 'Coinbase minute-close proxy'
            inserted = conn.execute('INSERT OR IGNORE INTO settlements(prediction_id,close_price,outcome,payout_cents,settled_at,source) VALUES(?,?,?,?,?,?)', (p['id'], close, outcome, payout, int(time.time()), settlement_source)).rowcount
            if inserted:
                conn.execute('UPDATE users SET balance_cents=balance_cents+? WHERE id=?', (payout, p['user_id']))
        if inserted:
            LOG.info('Settlement prediction=%s user=%s coin=%s outcome=%s payout_cents=%s',
                     p['id'], p['user_id'], p['coin'], outcome, payout)


def settle_due(user_id=None):
    if SETTLE_LOCK.acquire(blocking=False):
        try:
            _settle_due(user_id)
        finally:
            SETTLE_LOCK.release()


def settlement_worker():
    while True:
        try:
            settle_due()
        except Exception:
            LOG.error('Settlement worker failed; retrying in 30 seconds')
            LOG.debug('Settlement worker details', exc_info=True)
        time.sleep(30)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        # Preserve existing HTTP diagnostics in debug mode.
        LOG.debug('%s %s', self.client_address[0], format % args)

    def log_request(self, code='-', size='-'):
        path = urllib.parse.urlsplit(self.path).path
        if self.command == 'POST':
            LOG.info('User action method=POST path=%s status=%s', path, code)
        elif str(code).startswith('5'):
            LOG.error('HTTP failure method=%s path=%s status=%s', self.command, path, code)
        super().log_request(code, size)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        super().end_headers()

    def reply(self, status, payload, cookie=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        if self.command!='HEAD':
            self.wfile.write(body)

    def session(self):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            token = jar['btc60_session'].value
        except (KeyError, cookies.CookieError):
            return None
        with connect() as conn:
            return conn.execute('SELECT s.*,u.name,u.email,u.balance_cents FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?', (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()

    def account(self, session):
        with connect() as conn:
            user = conn.execute('SELECT id,name,email,balance_cents FROM users WHERE id=?', (session['user_id'],)).fetchone()
            positions = [dict(row) for row in conn.execute('SELECT p.*,i.category,i.name AS instrument_name,i.unit,ps.provider AS pricing_source,s.close_price,s.outcome,s.payout_cents,s.settled_at,s.source FROM predictions p JOIN coins i ON i.symbol=p.coin LEFT JOIN prediction_sources ps ON ps.prediction_id=p.id LEFT JOIN settlements s ON s.prediction_id=p.id WHERE p.user_id=? ORDER BY p.created_at DESC', (session['user_id'],))]
        return {'user': dict(user), 'csrf': session['csrf'], 'predictions': positions}

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/categories':
            with connect() as conn:
                categories = [dict(row) for row in conn.execute('SELECT c.*,count(i.symbol) AS instrumentCount FROM categories c LEFT JOIN coins i ON i.category=c.id AND i.enabled=1 GROUP BY c.id ORDER BY c.sort_order,c.id')]
                for category in categories:
                    if category['id'] == 'weather':
                        category.update(weather.catalog())
                        continue
                    instruments=[dict(row) for row in conn.execute('SELECT symbol,name,feed FROM coins WHERE category=? AND enabled=1 ORDER BY sort_order,symbol',(category['id'],))]
                    overrides={row['coin']:row['product'] for row in conn.execute('SELECT * FROM instrument_sources')}
                    category['instruments']=[{'symbol':i['symbol'],'name':i['name'],'liveSupported':bool(overrides.get(i['symbol'])) if i['symbol'] in overrides else True} for i in instruments]
                    if any(i['symbol'] in overrides for i in instruments):
                        category.update(provider=oilprice_api.PROVIDER if oilprice_api.configured() else 'Twelve Data',feedState='configured' if oilprice_api.configured() or live_oil.configured() else 'setup_required',supportedCount=sum(bool(overrides.get(i['symbol'])) for i in instruments),quoteCadence='Spot assessments · hourly predictions unavailable' if oilprice_api.configured() else 'Minute updates')
                    else:category.update(provider='Coinbase',feedState='available',supportedCount=len(instruments),quoteCadence='Streaming prices')
            return self.reply(200, {'categories':categories})
        if path == '/api/coins':
            with connect() as conn:
                records = [dict(row) for row in conn.execute('SELECT symbol,name,product,precision,demo_base AS demoBase,icon,enabled,sort_order AS sortOrder,category,feed,unit FROM coins ORDER BY category,sort_order,symbol')]
                for instrument in records:
                    override=conn.execute('SELECT * FROM instrument_sources WHERE coin=?',(instrument['symbol'],)).fetchone()
                    if override:
                        instrument.update(feed=override['provider'],product=override['product'],maxPriceAgeMs=live_oil.MAX_AGE*1000,feedState='unsupported' if not override['product'] else 'configured' if (oilprice_api.configured() if override['provider']=='oilpriceapi' else live_oil.configured()) else 'setup_required')
            return self.reply(200, {'coins': records, 'marketConfig': {'quotes': QUOTES, 'oddsVersion': odds.VERSION, 'calibrations': odds.calibrations(), 'settlement': {'source':'Coinbase Exchange', 'method':'Minute candle close immediately before interval boundaries', 'version':'coinbase-minute-close-v1', 'tie':'up'}}})
        if path in ('/api/spot','/api/candles'):
            query=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            coin=query.get('coin',[''])[0]
            with connect() as conn:
                record=conn.execute('SELECT * FROM coins WHERE symbol=? AND enabled=1',(coin,)).fetchone()
            if not record:
                return self.reply(400, {'error':'Unknown instrument.'})
            record=instrument_source(coin)
            if record['feed'] not in ('simulated','twelvedata','oilpriceapi'):
                return self.reply(400, {'error':'Use the instrument price feed.'})
            now=int(time.time())
            if path=='/api/spot':
                try:
                    tick=oilprice_api.quote(record['product']) if record['feed']=='oilpriceapi' else live_oil.quote(record['product']) if record['feed']=='twelvedata' else {'price':simulated_prices.price(coin,record['demo_base'],now),'time':now*1000,'source':simulated_prices.VERSION}
                    return self.reply(200,tick)
                except ValueError as error:
                    return self.reply(503,{'error':str(error)})
            try:
                start=int(query.get('start',[''])[0]);end=int(query.get('end',[''])[0])
                if not now-86400*30<=start<end<=now or end-start>86400:
                    raise ValueError()
            except (ValueError,TypeError):
                return self.reply(400, {'error':'Choose a candle range within the last 30 days, at most 24 hours long.'})
            try:
                candles=oilprice_api.candles(record['product'],start,end) if record['feed']=='oilpriceapi' else live_oil.candles(record['product'],start,end) if record['feed']=='twelvedata' else simulated_prices.candles(coin,record['demo_base'],start,end)
                return self.reply(200,candles)
            except ValueError as error:
                return self.reply(503,{'error':str(error)})
        if path == '/api/pricing-history':
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            coin = query.get('coin', [''])[0]
            with connect() as conn:
                row = conn.execute('SELECT symbol,product,feed,demo_base FROM coins WHERE symbol=? AND enabled=1', (coin,)).fetchone()
            if row is None:
                return self.reply(400, {'error':'Unknown coin.'})
            try:
                source=instrument_source(coin)
                return self.reply(200, {'candles':pricing_history(source['product'], time.time(), source)})
            except Exception:
                return self.reply(503, {'error':'Pricing history unavailable.'})
        if path == '/api/account':
            session = self.session()
            if not session:
                return self.reply(401, {'error': 'Log in to save your predictions.'})
            return self.reply(200, self.account(session))
        if path.startswith('/api/'):
            return self.reply(404, {'error': 'Unknown endpoint.'})
        # Serve only public application assets, never SQLite, source or dotfiles.
        public = {'index.html', 'categories.html', 'welcome.html', 'login.html', 'signup.html', 'styles.css', 'auth.css', 'auth.js', 'account.js', 'app.js', 'btc-chart.js', 'market-model.js', 'coins.js', 'bootstrap.js', 'splash.js', 'portfolio.html', 'portfolio.js', 'portfolio-model.js', 'portfolio.css', 'theme.js', 'theme.css', 'responsive.css', 'categories.js', 'categories.css', 'welcome.css'}
        relative = urllib.parse.unquote(path).lstrip('/')
        if not relative:
            self.path = '/welcome.html'
        elif relative not in public and relative not in {'assets/previews/prediction-playfield.png', 'assets/backgrounds/hourly-markets.webp'} and not (re.fullmatch(r'assets/coins/[a-zA-Z0-9_-]+\.svg', relative)):
            return self.reply(404, {'error': 'Not found.'})
        if relative == 'index.html' and urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('category') == ['weather']:
            self.send_response(302)
            self.send_header('Location', '/welcome.html')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if relative in {'index.html', 'categories.html'} and not self.session():
            self.send_response(302)
            self.send_header('Location', '/welcome.html')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        self.serve_static()

    def serve_static(self):
        relative = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip('/')
        path = ROOT / relative
        if not path.is_file():
            return self.reply(404, {'error': 'Not found.'})
        stat = path.stat()
        compressed = path.suffix in {'.html','.css','.js','.svg'} and 'gzip' in self.headers.get('Accept-Encoding','')
        key = (relative,stat.st_mtime_ns,stat.st_size,compressed)
        cached = STATIC_CACHE.get(key)
        if cached is None:
            raw = path.read_bytes()
            body = gzip.compress(raw,compresslevel=6) if compressed else raw
            etag = '"' + hashlib.sha256(body).hexdigest()[:24] + '"'
            cached = (body,etag)
            # Keep at most the current plain/gzip versions of each public file.
            for old in list(STATIC_CACHE):
                if old[0]==relative and old[3]==compressed:
                    STATIC_CACHE.pop(old,None)
            STATIC_CACHE[key] = cached
        body,etag = cached
        unchanged = self.headers.get('If-None-Match')==etag
        self.send_response(304 if unchanged else 200)
        self.send_header('Cache-Control','private, no-store' if relative in {'index.html', 'categories.html'} else 'public, max-age=0, must-revalidate')
        self.send_header('ETag',etag)
        self.send_header('Vary','Accept-Encoding')
        if not unchanged:
            self.send_header('Content-Type',self.guess_type(str(path)))
            self.send_header('Content-Length',str(len(body)))
            if compressed:
                self.send_header('Content-Encoding','gzip')
        self.end_headers()
        if not unchanged and self.command!='HEAD':
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{self.headers.get("Host")}':
            return self.reply(403, {'error': 'Invalid request origin.'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': 'JSON required.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 8192:
                raise ValueError('Invalid request size.')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Invalid request.')
            path = urllib.parse.urlsplit(self.path).path
            if path in ('/api/signup', '/api/login'):
                return self.authenticate(path, data)
            session = self.session()
            if not session:
                return self.reply(401, {'error': 'Log in to save your predictions.'})
            if not secrets.compare_digest(self.headers.get('X-CSRF-Token', ''), session['csrf']):
                return self.reply(403, {'error': 'Refresh the page and try again.'})
            if path == '/api/logout':
                with connect() as conn:
                    conn.execute('DELETE FROM sessions WHERE token_hash=?', (session['token_hash'],))
                return self.reply(200, {'ok': True}, 'btc60_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
            if path == '/api/settle':
                settle_due(session['user_id'])
                return self.reply(200, self.account(session))
            if path == '/api/predictions':
                return self.predict(session, data)
            return self.reply(404, {'error': 'Unknown endpoint.'})
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            return self.reply(400, {'error': str(exc) or 'Invalid request.'})
        except sqlite3.IntegrityError:
            return self.reply(409, {'error': 'Account or request already exists.'})
        except Exception:
            LOG.error('User action failed path=%s', urllib.parse.urlsplit(self.path).path)
            LOG.debug('User action failure details', exc_info=True)
            return self.reply(503, {'error': 'Service unavailable. Please try again.'})

    def authenticate(self, path, data):
        with AUTH_LOCK:
            now = time.time()
            for address in list(AUTH_ATTEMPTS):
                AUTH_ATTEMPTS[address] = [t for t in AUTH_ATTEMPTS[address] if t > now - 60]
                if not AUTH_ATTEMPTS[address]:
                    del AUTH_ATTEMPTS[address]
            attempts = AUTH_ATTEMPTS.setdefault(self.client_address[0], [])
            if len(attempts) >= 20:
                return self.reply(429, {'error': 'Too many attempts. Try again in a minute.'})
            attempts.append(now)
        email, password = data.get('email', ''), data.get('password', '')
        if not isinstance(email, str) or not isinstance(password, str):
            raise ValueError('Enter a valid email and password.')
        email = email.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) or len(email) > 254 or not 10 <= len(password) <= 128:
            raise ValueError('Use a valid email and a password of 10–128 characters.')
        with connect() as conn:
            if path == '/api/signup':
                name = data.get('name', '')
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
                    raise ValueError('Enter your name (up to 60 characters).')
                salt = secrets.token_hex(16)
                digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
                user_id = conn.execute('INSERT INTO users(name,email,password_hash,salt,created_at) VALUES(?,?,?,?,?)', (name.strip(), email, digest, salt, int(time.time()))).lastrowid
            else:
                user = conn.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
                salt = user['salt'] if user else '0' * 32
                digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
                if not user or not secrets.compare_digest(digest, user['password_hash']):
                    return self.reply(401, {'error': 'Email or password is incorrect.'})
                user_id = user['id']
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            conn.execute('DELETE FROM sessions WHERE expires_at<=?', (int(time.time()),))
            conn.execute('INSERT INTO sessions VALUES(?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user_id, csrf, int(time.time()) + 604800))
        LOG.info('Authentication action=%s user=%s', path.rsplit('/', 1)[-1], user_id)
        return self.reply(200, {'ok': True}, f'btc60_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800')

    def predict(self, session, data):
        coin, market_id, side = data.get('coin'), data.get('marketId'), data.get('side')
        budget, request_id = data.get('budget'), data.get('requestId')
        if not isinstance(coin, str) or not isinstance(market_id,str) or not isinstance(side,str):
            raise ValueError('Invalid market or prediction.')
        with connect() as conn:
            available_coin = conn.execute('SELECT 1 FROM coins WHERE symbol=? AND enabled=1', (coin,)).fetchone()
        if not available_coin or market_id not in QUOTES or side not in ('up', 'down'):
            raise ValueError('Invalid market or prediction.')
        if isinstance(budget, bool) or not isinstance(budget, (int, float)) or not math.isfinite(budget) or not 1 <= budget <= 1000000:
            raise ValueError('Enter a valid budget.')
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
            raise ValueError('Invalid request ID.')
        with connect() as conn:
            existing = conn.execute('SELECT id FROM predictions WHERE user_id=? AND request_id=?', (session['user_id'], request_id)).fetchone()
        if existing:
            return self.reply(200, self.account(session))
        now = int(time.time())
        duration, index = map(int, market_id.split('-'))
        start = now // 3600 * 3600 + index * duration * 60
        end = start + duration * 60
        requested_start = data.get('startsAt')
        if isinstance(requested_start, (int, float)) and time.time() >= requested_start / 1000 + duration * 60 - 30:
            raise ValueError('Betting closed. Bets must be placed at least 30 seconds before the interval ends.')
        if not start <= now < end - 30 or data.get('startsAt') != start * 1000:
            raise ValueError('This market is closed or changed. Review again.')
        source=instrument_source(coin)
        strike = candle_close(coin, start, source=source)
        spot = fresh_spot(coin, source=source)
        # Execute at the authoritative live quote, even if the browser's
        # benchmark/history or displayed quote changed during confirmation.
        up = market_up(coin, strike, spot, now, start, end, source=source)
        cents = up if side == 'up' else 100 - up
        if not start <= time.time() < end - 30:
            raise ValueError('Betting closed. Bets must be placed at least 30 seconds before the interval ends.')
        cost = int((Decimal(str(budget))*100).to_integral_value(rounding=ROUND_CEILING))
        contracts = cost / cents
        created = False
        with connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT id FROM predictions WHERE user_id=? AND request_id=?', (session['user_id'], request_id)).fetchone():
                pass
            else:
                if time.time() >= end - 30:
                    raise ValueError('Betting closed. Bets must be placed at least 30 seconds before the interval ends.')
                changed = conn.execute('UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?', (cost, session['user_id'], cost)).rowcount
                if not changed or contracts <= 0:
                    raise ValueError('Insufficient demo balance.')
                conn.execute('INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', (secrets.token_hex(16), session['user_id'], request_id, coin, market_id, side, start, end, strike, cents, contracts, cost, now))
                conn.execute('INSERT INTO prediction_sources VALUES(?,?,?)',(conn.execute('SELECT id FROM predictions WHERE user_id=? AND request_id=?',(session['user_id'],request_id)).fetchone()['id'],source['feed'],source['product']))
                created = True
        if created:
            LOG.info('Prediction created user=%s coin=%s market=%s side=%s cost_cents=%s',
                     session['user_id'], coin, market_id, side, cost)
        return self.reply(201, self.account(session))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--log-level', choices=('normal', 'debug', 'warning', 'error'),
                        default=os.environ.get('BTC60_LOG_LEVEL', 'normal'))
    args = parser.parse_args()
    configure(args.log_level)
    DB = DB.expanduser().resolve()
    DB.parent.mkdir(parents=True, exist_ok=True)
    with open(str(DB) + '.lock', 'a') as database_lock:
        os.chmod(database_lock.name, 0o600)
        try:
            fcntl.flock(database_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Database is in use by a server or maintenance command. Stop it before starting another server.')
        initialize()
        threading.Thread(target=settlement_worker, daemon=True).start()
        LOG.info('BTC60 local demo: http://127.0.0.1:%s', args.port)
        ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
