"""Local BTC60 demo server: SQLite accounts, sessions, orders and settlements."""
import argparse
import fcntl
import hashlib
import gzip
import json
import math
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
                conn.execute('INSERT INTO coins VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(coin['enabled']),coin['sortOrder']))
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=1').fetchone():
            # Add new catalog entries once, preserving administrator changes on restart.
            for coin in json.loads((ROOT / 'coins.seed.json').read_text())[5:]:
                if conn.execute('SELECT 1 FROM coins WHERE symbol=?', (coin['symbol'],)).fetchone():
                    continue
                room = conn.execute('SELECT count(*) FROM coins WHERE enabled=1').fetchone()[0] < 8
                conn.execute('INSERT INTO coins VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(coin['enabled'] and room),coin['sortOrder']))
            conn.execute('INSERT INTO catalog_migrations VALUES(1)')
        if not conn.execute('SELECT 1 FROM catalog_migrations WHERE version=2').fetchone():
            conn.execute("UPDATE coins SET enabled=0 WHERE symbol='LINK'")
            coin = next(c for c in json.loads((ROOT / 'coins.seed.json').read_text()) if c['symbol']=='LTC')
            room = conn.execute('SELECT count(*) FROM coins WHERE enabled=1').fetchone()[0] < 8
            conn.execute('INSERT OR IGNORE INTO coins VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(room),coin['sortOrder']))
            conn.execute('INSERT INTO catalog_migrations VALUES(2)')

    os.chmod(DB, 0o600)


def candle_close(coin, boundary):
    with connect() as conn:
        record = conn.execute('SELECT product FROM coins WHERE symbol=?', (coin,)).fetchone()
    if not record:
        raise ValueError('Unknown coin.')
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


def fresh_spot(coin):
    with connect() as conn:
        product = conn.execute('SELECT product FROM coins WHERE symbol=?', (coin,)).fetchone()['product']
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


def estimated_up(strike, spot, now, start, end, volatility):
    if now-start<1:
        return 50
    uncertainty=max(.0001, volatility)*math.sqrt(max(1/60, (end-now)/60))
    z=math.log(spot/strike)/uncertainty
    probability=100/(1+math.exp(max(-700,min(700,-1.7*z))))
    return max(1,min(99,math.floor(probability+.5)))


def market_up(coin, strike, spot, now, start, end):
    with connect() as conn:
        product=conn.execute('SELECT product FROM coins WHERE symbol=?',(coin,)).fetchone()['product']
    hour=now//3600*3600
    query=urllib.parse.urlencode({'granularity':60,'start':datetime.fromtimestamp(hour-60,timezone.utc).isoformat(),'end':datetime.fromtimestamp(now,timezone.utc).isoformat()})
    request=urllib.request.Request('https://api.exchange.coinbase.com/products/'+urllib.parse.quote(product,safe='')+'/candles?'+query,headers={'User-Agent':'BTC60-local-demo/1.0'})
    try:
        with urllib.request.urlopen(request,timeout=8) as response:
            candles=json.load(response)
        closed=sorted((c for c in candles if hour-60<=c[0] and c[0]+60<=now and math.isfinite(float(c[4])) and c[4]>0),key=lambda c:c[0])
        returns=[math.log(b[4]/a[4]) for a,b in zip(closed,closed[1:]) if b[0]-a[0]==60]
        volatility=max(.0001,math.sqrt(sum(r*r for r in returns)/len(returns))) if returns else .0001
        return estimated_up(strike,spot,now,start,end,volatility)
    except Exception:
        raise ValueError('Pricing history unavailable. Review again shortly.')


def _settle_due(user_id=None):
    with connect() as conn:
        pending = conn.execute('SELECT p.* FROM predictions p LEFT JOIN settlements s ON s.prediction_id=p.id WHERE s.prediction_id IS NULL AND p.ends_at<=? AND (? IS NULL OR p.user_id=?)', (int(time.time()) - 5, user_id, user_id)).fetchall()
    prices = {}
    for p in pending:
        key = (p['coin'], p['ends_at'])
        try:
            if key not in prices:
                prices[key] = candle_close(*key)
            close = prices[key]
        except Exception:
            continue  # Keep pending and retry; never invent a settlement.
        outcome = 'up' if close >= p['strike'] else 'down'
        payout = p['contracts'] * 100 if outcome == p['side'] else 0
        with connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            inserted = conn.execute('INSERT OR IGNORE INTO settlements(prediction_id,close_price,outcome,payout_cents,settled_at) VALUES(?,?,?,?,?)', (p['id'], close, outcome, payout, int(time.time()))).rowcount
            if inserted:
                conn.execute('UPDATE users SET balance_cents=balance_cents+? WHERE id=?', (payout, p['user_id']))


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
            pass
        time.sleep(30)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

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
            positions = [dict(row) for row in conn.execute('SELECT p.*,s.close_price,s.outcome,s.payout_cents,s.settled_at,s.source FROM predictions p LEFT JOIN settlements s ON s.prediction_id=p.id WHERE p.user_id=? ORDER BY p.created_at DESC', (session['user_id'],))]
        return {'user': dict(user), 'csrf': session['csrf'], 'predictions': positions}

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/coins':
            with connect() as conn:
                records = [dict(row) for row in conn.execute('SELECT symbol,name,product,precision,demo_base AS demoBase,icon,enabled,sort_order AS sortOrder FROM coins ORDER BY sort_order,symbol')]
            return self.reply(200, {'coins': records, 'marketConfig': {'quotes': QUOTES, 'settlement': {'source':'Coinbase Exchange', 'method':'Minute candle close immediately before interval boundaries', 'version':'coinbase-minute-close-v1', 'tie':'up'}}})
        if path == '/api/account':
            session = self.session()
            if not session:
                return self.reply(401, {'error': 'Log in to save your predictions.'})
            return self.reply(200, self.account(session))
        if path.startswith('/api/'):
            return self.reply(404, {'error': 'Unknown endpoint.'})
        # Serve only public application assets, never SQLite, source or dotfiles.
        public = {'index.html', 'welcome.html', 'login.html', 'signup.html', 'styles.css', 'auth.css', 'auth.js', 'account.js', 'app.js', 'btc-chart.js', 'market-model.js', 'coins.js', 'bootstrap.js', 'splash.js', 'portfolio.html', 'portfolio.js', 'portfolio-model.js', 'portfolio.css', 'theme.js', 'theme.css', 'responsive.css'}
        relative = urllib.parse.unquote(path).lstrip('/')
        if not relative:
            self.path = '/welcome.html'
        elif relative not in public and relative != 'assets/previews/prediction-playfield.png' and not (re.fullmatch(r'assets/coins/[a-zA-Z0-9_-]+\.svg', relative)):
            return self.reply(404, {'error': 'Not found.'})
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
        self.send_header('Cache-Control','public, max-age=0, must-revalidate')
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
        if isinstance(requested_start, (int, float)) and now >= requested_start / 1000 + duration * 60:
            raise ValueError('Too late to place. This interval has expired.')
        if not start <= now < end or data.get('startsAt') != start * 1000:
            raise ValueError('This market is closed or changed. Review again.')
        strike = candle_close(coin, start)
        spot = fresh_spot(coin)
        # Execute at the authoritative live quote, even if the browser's
        # benchmark/history or displayed quote changed during confirmation.
        up = market_up(coin, strike, spot, now, start, end)
        cents = up if side == 'up' else 100 - up
        if not start <= time.time() < end:
            raise ValueError('Too late to place. This interval has expired.')
        contracts = math.floor(round(budget * 100) / cents)
        cost = contracts * cents
        with connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT id FROM predictions WHERE user_id=? AND request_id=?', (session['user_id'], request_id)).fetchone():
                pass
            else:
                if time.time() >= end:
                    raise ValueError('Too late to place. This interval has expired.')
                changed = conn.execute('UPDATE users SET balance_cents=balance_cents-? WHERE id=? AND balance_cents>=?', (cost, session['user_id'], round(budget * 100))).rowcount
                if not changed or contracts < 1:
                    raise ValueError('Insufficient demo balance.')
                conn.execute('INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', (secrets.token_hex(16), session['user_id'], request_id, coin, market_id, side, start, end, strike, cents, contracts, cost, now))
        return self.reply(201, self.account(session))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
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
        print(f'BTC60 local demo: http://127.0.0.1:{args.port}', flush=True)
        ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
