"""Local Predict60 demo server: SQLite accounts, sessions, orders and settlements."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from decimal import Decimal, ROUND_CEILING
import argparse
import ipaddress
import odds
import contests
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
from p60_logging import configure
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
# Keep existing installations on their current database unless explicitly configured.
DEFAULT_DB = ROOT / 'data' / 'p60.sqlite3'
LEGACY_DB = ROOT / 'data' / 'btc60.sqlite3'
if not DEFAULT_DB.exists() and LEGACY_DB.exists():
    DEFAULT_DB = LEGACY_DB
DB = Path(os.environ.get('PREDICT60_DB') or os.environ.get('P60_DB')
          or os.environ.get('BTC60_DB') or DEFAULT_DB)
QUOTES = {'60-0': 68, '30-0': 54, '30-1': 58, '15-0': 49, '15-1': 57, '15-2': 62, '15-3': 50}
MAX_PREDICTION_CREDITS = 1000
COMING_SOON_CATEGORIES = {'oil', 'weather'}
AUTH_ATTEMPTS = {}
AUTH_LOCK = threading.Lock()
SETTLE_LOCK = threading.Lock()
STATIC_CACHE = {}
LOG = logging.getLogger(__name__)
PUBLIC_ASSETS = {
    'assets/previews/prediction-playfield.png',
    'assets/backgrounds/hourly-markets.webp',
    'assets/brand/p60-mark.svg',
    'assets/fonts/manrope-latin.woff2',
    'assets/fonts/space-grotesk-latin.woff2',
    'assets/fonts/manrope-OFL.txt',
    'assets/fonts/spacegrotesk-OFL.txt',
}
PUBLIC_FILES = {
    'brand.css',
    'password.html', 'password.js',
    'contests.html', 'contests.js', 'contests.css', 'sponsor.js',
    'account.js',
    'app.js',
    'auth.css',
    'auth.js',
    'bootstrap.js',
    'btc-chart.js',
    'categories.css',
    'categories.html',
    'categories.js',
    'coins.js',
    'community.js',
    'index.html',
    'login.html',
    'market-model.js',
    'portfolio-model.js',
    'portfolio.css',
    'portfolio.html',
    'portfolio.js',
    'responsive.css',
    'signup.html',
    'styles.css',
    'theme.css',
    'theme.js',
    'welcome.css',
    'welcome.html',
}


def configured_public_origin():
    """Return and validate the optional exact browser origin used behind a proxy."""
    origin = os.environ.get('P60_HOST', '').strip()
    if not origin:
        return ''
    try:
        parsed = urllib.parse.urlsplit(origin)
        port = parsed.port  # Force validation of malformed ports.
    except ValueError as error:
        raise ValueError(f'Invalid P60_HOST: {error}') from error
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname
            or parsed.username or parsed.password or parsed.path
            or parsed.query or parsed.fragment):
        raise ValueError('P60_HOST must be an exact http(s) origin with no path, credentials, query, or fragment.')
    default_port = 443 if parsed.scheme == 'https' else 80
    expected_netloc = parsed.hostname if port in (None, default_port) else f'{parsed.hostname}:{port}'
    if ':' in parsed.hostname:
        expected_netloc = f'[{parsed.hostname}]' if port in (None, default_port) else f'[{parsed.hostname}]:{port}'
    normalized = f'{parsed.scheme}://{expected_netloc}'
    if origin != normalized:
        raise ValueError(f'P60_HOST must use its normalized form: {normalized}')
    return origin


def trusted_proxies():
    """Parse explicitly trusted reverse-proxy addresses from the environment."""
    configured = os.environ.get('P60_TRUSTED_PROXIES', '').strip()
    if not configured:
        return set()
    try:
        return {str(ipaddress.ip_address(value.strip())) for value in configured.split(',') if value.strip()}
    except ValueError as error:
        raise ValueError(f'Invalid P60_TRUSTED_PROXIES: {error}') from error


def secure_session_cookies():
    """Require HTTPS-only cookies whenever the configured public origin uses HTTPS."""
    override = os.environ.get('P60_SECURE_COOKIES', '').strip().lower()
    if override not in ('', '0', '1', 'false', 'true', 'no', 'yes'):
        raise ValueError('P60_SECURE_COOKIES must be true/false or 1/0.')
    return configured_public_origin().startswith('https://') or override in ('1', 'true', 'yes')


def session_cookie(value, max_age):
    """Build matching login/logout cookie attributes for the current deployment."""
    attributes = [f'p60_session={value}', 'HttpOnly', 'SameSite=Lax', 'Path=/', f'Max-Age={max_age}']
    if secure_session_cookies():
        attributes.append('Secure')
    return '; '.join(attributes)


def validate_environment():
    """Fail startup before binding when deployment security settings are malformed."""
    configured_public_origin()
    trusted_proxies()
    secure_session_cookies()


class Predict60HTTPServer(ThreadingHTTPServer):
    """Bounded, promptly terminating HTTP server intended for loopback proxying."""
    daemon_threads = True
    request_queue_size = 128
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        """Limit in-flight HTTP threads so bursts cannot exhaust VPS memory."""
        limit = int(os.environ.get('P60_MAX_REQUESTS', '32'))
        if not 1 <= limit <= 256:
            raise ValueError('P60_MAX_REQUESTS must be between 1 and 256.')
        self.request_slots = threading.BoundedSemaphore(limit)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        """Reject overload promptly instead of creating an unbounded request thread."""
        if not self.request_slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nRetry-After: 1\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        """Return the concurrency slot even if a request handler raises."""
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()


@contextmanager
def connect():
    """Commit or roll back one database scope and always close its connection."""
    conn = sqlite3.connect(DB, timeout=15)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        with conn:
            yield conn
    finally:
        conn.close()


def initialize():
    """Create missing tables and apply idempotent catalog migrations while preserving saved accounts and orders."""
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
          balance_cents INTEGER NOT NULL DEFAULT 1000000 CHECK(balance_cents>=0), created_at INTEGER NOT NULL);
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
        CREATE INDEX IF NOT EXISTS predictions_due ON predictions(ends_at);
        CREATE INDEX IF NOT EXISTS predictions_user_window ON predictions(user_id,coin,starts_at,ends_at);
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        ''')
        contests.initialize(conn)
        if 'last_seen_at' not in {row['name'] for row in conn.execute('PRAGMA table_info(sessions)')}:
            conn.execute('ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0')
        if seed_coins:
            for coin in json.loads((ROOT / 'coins.seed.json').read_text()):
                conn.execute('INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order) VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(coin['enabled']),coin['sortOrder']))
        # Apply this migration once; saved prediction sources and account state must survive restarts.
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=1').fetchone():
            # Add new catalog entries once, preserving administrator changes on restart.
            for coin in json.loads((ROOT / 'coins.seed.json').read_text())[5:]:
                if conn.execute('SELECT 1 FROM coins WHERE symbol=?', (coin['symbol'],)).fetchone():
                    continue
                room = conn.execute('SELECT count(*) FROM coins WHERE enabled=1').fetchone()[0] < 8
                conn.execute('INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order) VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(coin['enabled'] and room),coin['sortOrder']))
            conn.execute('INSERT INTO catalog_migrations VALUES(1)')
        # Apply this migration once; saved prediction sources and account state must survive restarts.
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=2').fetchone():
            conn.execute("UPDATE coins SET enabled=0 WHERE symbol='LINK'")
            coin = next(c for c in json.loads((ROOT / 'coins.seed.json').read_text()) if c['symbol']=='LTC')
            room = conn.execute('SELECT count(*) FROM coins WHERE enabled=1').fetchone()[0] < 8
            conn.execute('INSERT OR IGNORE INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order) VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(room),coin['sortOrder']))
            conn.execute('INSERT INTO catalog_migrations VALUES(2)')


        # Add categories without rebuilding existing accounts or prediction tables.
        conn.execute('CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, icon TEXT NOT NULL, accent TEXT NOT NULL, background TEXT NOT NULL, unit TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)')
        # Insert missing category metadata without overwriting administrator customizations.
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
        # Apply this migration once; saved prediction sources and account state must survive restarts.
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
        # Apply this migration once; saved prediction sources and account state must survive restarts.
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=4').fetchone():
            for row in conn.execute("SELECT symbol FROM coins WHERE category='oil'").fetchall():
                conn.execute('INSERT OR IGNORE INTO instrument_sources VALUES(?,?,?)',(row['symbol'],'twelvedata',live_oil.SYMBOLS.get(row['symbol'],'')))
            conn.execute('INSERT INTO catalog_migrations VALUES(4)')

        # Apply this migration once; saved prediction sources and account state must survive restarts.
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
    """Resolve the authoritative feed and product, optionally retaining the legacy settlement source."""
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
    """Fetch the exact closing benchmark immediately before a UTC interval boundary; fail if it is unavailable."""
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
    request = urllib.request.Request(f'https://api.exchange.coinbase.com/products/{product}/candles?{query}', headers={'User-Agent': 'Predict60-local-demo/1.0'})
    with urllib.request.urlopen(request, timeout=8) as response:
        candles = json.load(response)
    for candle in candles:
        if candle[0] == boundary - 60 and math.isfinite(float(candle[4])) and float(candle[4]) > 0:
            return float(candle[4])
    raise ValueError('Benchmark history is unavailable. Try again shortly.')


def fresh_spot(coin, source=None):
    """Return a validated current quote; reject stale data and providers without tradable benchmarks."""
    record=source or instrument_source(coin)
    if record['feed']=='oilpriceapi':
        return oilprice_api.fresh_spot(record['product'])
    if record['feed']=='twelvedata':
        return live_oil.quote(record['product'])['price']
    if record['feed']=='simulated':
        return simulated_prices.price(coin, record['demo_base'], int(time.time()))
    product = record['product']
    request = urllib.request.Request('https://api.exchange.coinbase.com/products/'+urllib.parse.quote(product,safe='')+'/ticker', headers={'User-Agent':'Predict60-local-demo/1.0'})
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
    """Calculate the integer Up purchase probability from validated provider history and current price."""
    return max(1, min(99, math.floor(100*odds.probability(strike, spot, now, end, volatility, calibration)+.5)))


HISTORY_CACHE = {}
HISTORY_LOCK = threading.Lock()
# Fixed stripes bound lock memory while coalescing simultaneous cold loads.
HISTORY_LOAD_LOCKS = tuple(threading.Lock() for _ in range(32))


def pricing_history(product, now, instrument=None):
    """Coalesce concurrent history loads for a product before checking the minute cache."""
    with HISTORY_LOAD_LOCKS[hash(product) % len(HISTORY_LOAD_LOCKS)]:
        return _pricing_history(product, now, instrument)


def _pricing_history(product, now, instrument=None):
    """Load and combine provider minute history for the trailing volatility window."""
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
        """Fetch one historical candle batch for the pricing-history aggregation."""
        start,end=interval
        query=urllib.parse.urlencode({'granularity':60,'start':datetime.fromtimestamp(start,timezone.utc).isoformat(),'end':datetime.fromtimestamp(end,timezone.utc).isoformat()})
        request=urllib.request.Request('https://api.exchange.coinbase.com/products/'+urllib.parse.quote(product,safe='')+'/candles?'+query,headers={'User-Agent':'Predict60-local-demo/1.0'})
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
    """Compute the executable Up quote for an instrument and prediction interval."""
    instrument=source or instrument_source(coin)
    try:
        volatility = odds.minute_volatility(pricing_history(instrument['product'], now, instrument), now)
        return estimated_up(strike, spot, now, start, end, volatility, odds.calibrations().get(coin))
    except Exception:
        raise ValueError('Pricing history unavailable. Review again shortly.')


def _settle_due(user_id=None):
    """Settle due orders from their frozen provider snapshots, crediting each winning payout only once."""
    with connect() as conn:
        query = ('SELECT p.*,ps.provider AS frozen_provider,ps.product AS frozen_product '
                 'FROM predictions p LEFT JOIN settlements s ON s.prediction_id=p.id '
                 'LEFT JOIN prediction_sources ps ON ps.prediction_id=p.id '
                 'WHERE s.prediction_id IS NULL AND p.ends_at<=?')
        parameters = [int(time.time()) - 5]
        if user_id is not None:
            query += ' AND p.user_id=?'
            parameters.append(user_id)
        pending = conn.execute(query, parameters).fetchall()
    prices, sources, failed = {}, {}, set()
    for p in pending:
        if p['coin'] not in sources:
            sources[p['coin']] = instrument_source(p['coin'], legacy=True)
        source = dict(sources[p['coin']])
        if p['frozen_provider'] is not None:
            source.update(feed=p['frozen_provider'], product=p['frozen_product'])
        key = (p['coin'], p['ends_at'], source['feed'], source['product'])
        if key in failed:
            continue
        try:
            if key not in prices:
                prices[key] = candle_close(p['coin'],p['ends_at'],source=source)
            close = prices[key]
        except Exception:
            failed.add(key)
            LOG.debug('Settlement deferred prediction=%s', p['id'], exc_info=True)
            continue  # Keep pending and retry; never invent a settlement.
        outcome = 'up' if close >= p['strike'] else 'down'
        payout = (p['cost_cents']*100+p['cents']-1)//p['cents'] if outcome == p['side'] else 0
        with connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            settlement_source='Twelve Data live oil minute close' if source['feed']=='twelvedata' else 'Simulated oil minute close · '+simulated_prices.VERSION if source['feed']=='simulated' else 'Coinbase minute-close proxy'
            inserted = conn.execute('INSERT OR IGNORE INTO settlements(prediction_id,close_price,outcome,payout_cents,settled_at,source) VALUES(?,?,?,?,?,?)', (p['id'], close, outcome, payout, int(time.time()), settlement_source)).rowcount
            if inserted:
                if not conn.execute('SELECT 1 FROM contest_entries WHERE prediction_id=?', (p['id'],)).fetchone():
                    conn.execute('UPDATE users SET balance_cents=balance_cents+? WHERE id=?', (payout, p['user_id']))
        if inserted:
            LOG.info('Settlement prediction=%s user=%s coin=%s outcome=%s payout_cents=%s',
                     p['id'], p['user_id'], p['coin'], outcome, payout)


def settle_due(user_id=None):
    """Run settlement under a nonblocking process lock so concurrent requests cannot overlap."""
    if SETTLE_LOCK.acquire(blocking=False):
        try:
            _settle_due(user_id)
            with connect() as conn:
                conn.execute('BEGIN IMMEDIATE')
                contests.finalize(conn)
        finally:
            SETTLE_LOCK.release()


def settlement_worker():
    """Retry pending settlements continuously, logging failures without terminating the worker."""
    while True:
        try:
            settle_due()
        except Exception:
            LOG.error('Settlement worker failed; retrying in 30 seconds')
            LOG.debug('Settlement worker details', exc_info=True)
        time.sleep(30)


class Handler(SimpleHTTPRequestHandler):
    """Serve allowlisted frontend assets and account, quote, prediction, and community HTTP endpoints."""
    def __init__(self, *args, **kwargs):
        """Initialize the HTTP handler with this checkout as its static source directory."""
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def setup(self):
        """Bound the lifetime of stalled backend connections from the local proxy."""
        super().setup()
        self.connection.settimeout(30)

    def client_ip(self):
        """Return a proxy-provided client IP only when the direct peer is trusted."""
        peer = str(ipaddress.ip_address(self.client_address[0]))
        if peer not in trusted_proxies():
            return peer
        forwarded = self.headers.get('X-Forwarded-For', '').strip()
        # The deployment proxy overwrites this header with exactly one address.
        if not forwarded or ',' in forwarded:
            return peer
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            return peer

    def log_message(self, format, *args):
        # Preserve existing HTTP diagnostics in debug mode.
        """Route HTTP diagnostics to debug logging without writing request bodies or credentials."""
        LOG.debug('%s %s', self.client_ip(), format % args)

    def log_request(self, code='-', size='-'):
        """Record user actions and server failures while keeping routine polling out of normal logs."""
        path = urllib.parse.urlsplit(self.path).path
        if self.command == 'POST':
            LOG.info('User action method=POST path=%s status=%s', path, code)
        elif str(code).startswith('5'):
            LOG.error('HTTP failure method=%s path=%s status=%s', self.command, path, code)
        super().log_request(code, size)

    def end_headers(self):
        """Add browser security headers before completing an HTTP response."""
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        if secure_session_cookies():
            self.send_header('Strict-Transport-Security', 'max-age=31536000')
        super().end_headers()

    def reply(self, status, payload, cookie=None):
        """Send a JSON response with no-store caching and an optional session cookie; suppress bodies for HEAD."""
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

    def redirect(self, target):
        """Send an uncached redirect with an empty response body."""
        self.send_response(302)
        self.send_header('Location', target)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def session(self):
        """Validate the session cookie and expiry, then periodically refresh its activity timestamp."""
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            token = jar['p60_session'].value
        except (KeyError, cookies.CookieError):
            return None
        with connect() as conn:
            session = conn.execute('SELECT s.*,u.name,u.email,u.balance_cents FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?', (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()
            if session and session['last_seen_at'] < int(time.time()) - 15:
                conn.execute('UPDATE sessions SET last_seen_at=? WHERE token_hash=?', (int(time.time()), session['token_hash']))
            return session

    def account(self, session):
        """Build the signed-in account snapshot with saved predictions, settlement results, and CSRF token."""
        with connect() as conn:
            user = conn.execute('SELECT id,name,email,balance_cents FROM users WHERE id=?', (session['user_id'],)).fetchone()
            positions = [dict(row) for row in conn.execute("SELECT p.*,CASE WHEN ce.prediction_id IS NULL THEN 'practice' ELSE 'contest' END AS mode,i.category,i.name AS instrument_name,i.unit,ps.provider AS pricing_source,s.close_price,s.outcome,s.payout_cents,s.settled_at,s.source FROM predictions p LEFT JOIN contest_entries ce ON ce.prediction_id=p.id JOIN coins i ON i.symbol=p.coin LEFT JOIN prediction_sources ps ON ps.prediction_id=p.id LEFT JOIN settlements s ON s.prediction_id=p.id WHERE p.user_id=? ORDER BY p.created_at DESC", (session['user_id'],))]
            contest_wallet = contests.wallet(conn, session['user_id'])
            last_hour = contests.last_hour_score(conn, session['user_id'])
        return {'user': dict(user), 'csrf': session['csrf'], 'predictions': positions, 'contestWallet': contest_wallet, 'lastHourContest': last_hour}

    def do_GET(self):
        """Dispatch read endpoints and enforce authentication and the static-file allowlist."""
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/sponsor':
            return self.reply(200, contests.sponsor())
        if path == '/api/contests':
            session = self.session()
            if not session:
                return self.reply(401, {'error': 'Log in to view contests.'})
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            try:
                before = int(query['before'][0]) if 'before' in query else None
                if before is not None and not 0 <= before <= 253402300799:
                    raise ValueError()
            except (ValueError, TypeError):
                return self.reply(400, {'error': 'Choose a valid history timestamp.'})
            with connect() as conn:
                dashboard = contests.dashboard(conn, session['user_id'], before=before)
            return self.reply(200, dashboard)
        if path == '/healthz':
            try:
                with connect() as conn:
                    conn.execute('SELECT id FROM users LIMIT 1').fetchone()
                return self.reply(200, {'ok': True})
            except (OSError, sqlite3.Error):
                return self.reply(503, {'ok': False})
        # Heartbeat valid sessions before counting distinct accounts across tabs/devices.
        if path == '/api/community':
            self.session()  # Record this signed-in visitor's heartbeat.
            now = int(time.time())
            with connect() as conn:
                total = conn.execute('SELECT count(*) FROM users').fetchone()[0]
                active = conn.execute('SELECT count(DISTINCT user_id) FROM sessions WHERE expires_at>? AND last_seen_at>=?', (now, now - 300)).fetchone()[0]
            return self.reply(200, {'users': total, 'activeUsers': active, 'activeWindowSeconds': 300})
        if path == '/api/categories':
            with connect() as conn:
                categories = [dict(row) for row in conn.execute('SELECT c.*,count(i.symbol) AS instrumentCount FROM categories c LEFT JOIN coins i ON i.category=c.id AND i.enabled=1 GROUP BY c.id ORDER BY c.sort_order,c.id')]
                instruments_by_category = {}
                overrides = {}
                for row in conn.execute(
                    'SELECT i.symbol,i.name,i.category,s.coin AS override_coin,s.product '
                    'FROM coins i LEFT JOIN instrument_sources s ON s.coin=i.symbol '
                    'WHERE i.enabled=1 ORDER BY i.sort_order,i.symbol'
                ):
                    instruments_by_category.setdefault(row['category'], []).append(row)
                    if row['override_coin'] is not None:
                        overrides[row['symbol']] = row['product']
                for category in categories:
                    if category['id'] == 'weather':
                        category.update(weather.catalog())
                        continue
                    instruments = instruments_by_category.get(category['id'], [])
                    category['instruments']=[{'symbol':i['symbol'],'name':i['name'],'liveSupported':bool(overrides.get(i['symbol'])) if i['symbol'] in overrides else True} for i in instruments]
                    if any(i['symbol'] in overrides for i in instruments):
                        category.update(provider=oilprice_api.PROVIDER if oilprice_api.configured() else 'Twelve Data',feedState='configured' if oilprice_api.configured() or live_oil.configured() else 'setup_required',supportedCount=sum(bool(overrides.get(i['symbol'])) for i in instruments),quoteCadence='Spot assessments · hourly predictions unavailable' if oilprice_api.configured() else 'Minute updates')
                    else:category.update(provider='Coinbase',feedState='available',supportedCount=len(instruments),quoteCadence='Streaming prices')
                    if category['id'] in COMING_SOON_CATEGORIES:
                        category.update(availability='coming_soon', tradable=False)
            return self.reply(200, {'categories':categories})
        if path == '/api/coins':
            with connect() as conn:
                records = [dict(row) for row in conn.execute(
                    'SELECT i.symbol,i.name,i.product,i.precision,i.demo_base AS demoBase,'
                    'i.icon,i.enabled,i.sort_order AS sortOrder,i.category,i.feed,i.unit,'
                    's.provider AS override_provider,s.product AS override_product '
                    'FROM coins i LEFT JOIN instrument_sources s ON s.coin=i.symbol '
                    'ORDER BY i.category,i.sort_order,i.symbol'
                )]
                for instrument in records:
                    provider = instrument.pop('override_provider')
                    product = instrument.pop('override_product')
                    if provider is not None:
                        configured = oilprice_api.configured() if provider == 'oilpriceapi' else live_oil.configured()
                        instrument.update(
                            feed=provider, product=product, maxPriceAgeMs=live_oil.MAX_AGE * 1000,
                            feedState='unsupported' if not product else 'configured' if configured else 'setup_required',
                        )
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
        relative = urllib.parse.unquote(path).lstrip('/')
        if not relative:
            self.path = '/welcome.html'
        elif relative not in PUBLIC_FILES and relative not in PUBLIC_ASSETS and not (re.fullmatch(r'assets/coins/[a-zA-Z0-9_-]+\.svg', relative)):
            return self.reply(404, {'error': 'Not found.'})
        # Returning signed-in visitors enter categories without seeing the guest splash.
        if relative in {'', 'welcome.html'} and self.session():
            return self.redirect('/categories.html')
        if relative == 'index.html' and set(urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('category', [])) & COMING_SOON_CATEGORIES:
            return self.redirect('/welcome.html')
        # Protect direct terminal/category URLs independently of client-side navigation.
        if relative in {'index.html', 'categories.html', 'contests.html', 'password.html'} and not self.session():
            return self.redirect('/welcome.html')
        self.serve_static()

    def serve_static(self):
        """Serve an allowlisted file with gzip, ETag revalidation, and private caching for account entry pages."""
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
        self.send_header('Cache-Control','private, no-store' if relative in {'index.html', 'categories.html', 'welcome.html'} else 'public, max-age=0, must-revalidate')
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
        """Reuse GET routing and headers while suppressing response bodies."""
        self.do_GET()

    def do_POST(self):
        """Validate request origin, JSON size, session, and CSRF token before routing account mutations."""
        origin = self.headers.get('Origin')
        # Pin the public origin behind HTTPS proxies; retain local behavior without an override.
        allowed_origin = configured_public_origin() or f'http://{self.headers.get("Host")}'
        if origin and origin != allowed_origin:
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
            # Authentication creates a session; all later mutations require that session and its CSRF token.
            if path in ('/api/signup', '/api/login'):
                return self.authenticate(path, data)
            session = self.session()
            if not session:
                return self.reply(401, {'error': 'Log in to save your predictions.'})
            if not secrets.compare_digest(self.headers.get('X-CSRF-Token', ''), session['csrf']):
                return self.reply(403, {'error': 'Refresh the page and try again.', 'code': 'csrf_mismatch'})
            if path == '/api/logout':
                with connect() as conn:
                    conn.execute('DELETE FROM sessions WHERE token_hash=?', (session['token_hash'],))
                return self.reply(200, {'ok': True}, session_cookie('', 0))
            if path == '/api/change-password':
                return self.change_password(session, data)
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

    def auth_rate_limited(self):
        """Limit password verification attempts per client address."""
        with AUTH_LOCK:
            now = time.time()
            for address in list(AUTH_ATTEMPTS):
                AUTH_ATTEMPTS[address] = [t for t in AUTH_ATTEMPTS[address] if t > now - 60]
                if not AUTH_ATTEMPTS[address]:
                    del AUTH_ATTEMPTS[address]
            attempts = AUTH_ATTEMPTS.setdefault(self.client_ip(), [])
            if len(attempts) >= 20:
                return True
            attempts.append(now)
        return False

    def change_password(self, session, data):
        """Verify the current password and revoke other sessions atomically."""
        if self.auth_rate_limited():
            return self.reply(429, {'error': 'Too many attempts. Try again in a minute.'})
        current = data.get('currentPassword')
        password = data.get('newPassword')
        confirmation = data.get('confirmPassword')
        if not isinstance(current, str) or not 8 <= len(current) <= 128:
            raise ValueError('Enter your current password.')
        if not isinstance(password, str) or not 8 <= len(password) <= 16:
            raise ValueError('Use a password of 8–16 characters.')
        if not isinstance(confirmation, str) or not secrets.compare_digest(password.encode(), confirmation.encode()):
            raise ValueError('Passwords do not match.')
        with connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            user = conn.execute('SELECT password_hash,salt FROM users WHERE id=?', (session['user_id'],)).fetchone()
            digest = hashlib.scrypt(current.encode(), salt=bytes.fromhex(user['salt']), n=16384, r=8, p=1).hex()
            if not secrets.compare_digest(digest, user['password_hash']):
                return self.reply(403, {'error': 'Current password is incorrect.'})
            salt = secrets.token_hex(16)
            digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
            conn.execute('UPDATE users SET password_hash=?,salt=? WHERE id=?', (digest, salt, session['user_id']))
            conn.execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', (session['user_id'], session['token_hash']))
        return self.reply(200, {'ok': True})

    def authenticate(self, path, data):
        """Validate credentials, throttle attempts, create or verify the account, and issue a session cookie."""
        if self.auth_rate_limited():
            return self.reply(429, {'error': 'Too many attempts. Try again in a minute.'})
        if path == '/api/signup':
            expected_code = os.environ.get('P60_SIGNUP_CODE', '')
            if not expected_code:
                return self.reply(503, {'error': 'Signup is currently unavailable.'})
            signup_code = data.get('signupCode')
            if not isinstance(signup_code, str) or not secrets.compare_digest(signup_code.encode('utf-8'), expected_code.encode('utf-8')):
                return self.reply(403, {'error': 'Invalid signup code.'})
        email, password = data.get('email', ''), data.get('password', '')
        if not isinstance(email, str) or not isinstance(password, str):
            raise ValueError('Enter a valid email and password.')
        email = email.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) or len(email) > 254:
            raise ValueError('Enter a valid email address.')
        if path == '/api/signup':
            if not 8 <= len(password) <= 16:
                raise ValueError('Use a password of 8–16 characters.')
            confirmation = data.get('confirmPassword')
            if not isinstance(confirmation, str) or not secrets.compare_digest(password.encode('utf-8'), confirmation.encode('utf-8')):
                raise ValueError('Passwords do not match.')
        elif not 8 <= len(password) <= 128:
            raise ValueError('Enter your password.')
        with connect() as conn:
            if path == '/api/signup':
                name = data.get('name', '')
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
                    raise ValueError('Enter your name (up to 60 characters).')
                salt = secrets.token_hex(16)
                digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
                user_id = conn.execute('INSERT INTO users(name,email,password_hash,salt,created_at,balance_cents) VALUES(?,?,?,?,?,?)', (name.strip(), email, digest, salt, int(time.time()), 1000000)).lastrowid
            else:
                user = conn.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
                salt = user['salt'] if user else '0' * 32
                digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
                if not user or not secrets.compare_digest(digest, user['password_hash']):
                    return self.reply(401, {'error': 'Email or password is incorrect.'})
                user_id = user['id']
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            conn.execute('DELETE FROM sessions WHERE expires_at<=?', (int(time.time()),))
            conn.execute('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,last_seen_at) VALUES(?,?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user_id, csrf, int(time.time()) + 604800, int(time.time())))
        LOG.info('Authentication action=%s user=%s', path.rsplit('/', 1)[-1], user_id)
        return self.reply(200, {'ok': True}, session_cookie(token, 604800))

    def predict(self, session, data):
        """Validate order timing and budget, freeze the provider quote, and atomically debit and save an idempotent order."""
        mode = data.get('mode', 'practice')
        if mode not in ('practice', 'contest'):
            raise ValueError('Choose practice or contest mode.')
        coin, market_id, side = data.get('coin'), data.get('marketId'), data.get('side')
        budget, request_id = data.get('budget'), data.get('requestId')
        if not isinstance(coin, str) or not isinstance(market_id,str) or not isinstance(side,str):
            raise ValueError('Invalid market or prediction.')
        with connect() as conn:
            available_coin = conn.execute('SELECT category FROM coins WHERE symbol=? AND enabled=1', (coin,)).fetchone()
        if not available_coin or market_id not in QUOTES or side not in ('up', 'down'):
            raise ValueError('Invalid market or prediction.')
        if available_coin['category'] in COMING_SOON_CATEGORIES:
            raise ValueError(f"{available_coin['category'].title()} predictions are coming soon.")
        if isinstance(budget, bool) or not isinstance(budget, (int, float)) or not math.isfinite(budget) or not 1 <= budget <= MAX_PREDICTION_CREDITS:
            raise ValueError('Enter a prediction budget from 1 to 1,000 credits.')
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
                if mode == 'practice':
                    changed = conn.execute('UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?', (cost, session['user_id'], cost)).rowcount
                    if not changed or contracts <= 0:
                        raise ValueError('Insufficient credits.')
                conn.execute('INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', (secrets.token_hex(16), session['user_id'], request_id, coin, market_id, side, start, end, strike, cents, contracts, cost, now))
                conn.execute('INSERT INTO prediction_sources VALUES(?,?,?)',(conn.execute('SELECT id FROM predictions WHERE user_id=? AND request_id=?',(session['user_id'],request_id)).fetchone()['id'],source['feed'],source['product']))
                if mode == 'contest':
                    prediction_id = conn.execute('SELECT id FROM predictions WHERE user_id=? AND request_id=?', (session['user_id'], request_id)).fetchone()['id']
                    contests.enter(conn, prediction_id, session['user_id'], coin, start, end, cost)
                created = True
        if created:
            LOG.info('Prediction created user=%s coin=%s market=%s side=%s cost_cents=%s',
                     session['user_id'], coin, market_id, side, cost)
        return self.reply(201, self.account(session))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument(
        '--bind',
        default='127.0.0.1',
        help='Address to listen on (default: 127.0.0.1)',
    )
    parser.add_argument('--log-level', choices=('normal', 'debug', 'warning', 'error'),
                        default=os.environ.get('PREDICT60_LOG_LEVEL') or os.environ.get('P60_LOG_LEVEL') or os.environ.get('BTC60_LOG_LEVEL', 'normal'))
    args = parser.parse_args()
    try:
        validate_environment()
    except ValueError as error:
        parser.error(str(error))
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
        LOG.info('Predict60 listening on http://%s:%s', args.bind, args.port)
        Predict60HTTPServer((args.bind, args.port), Handler).serve_forever()
