import http.client
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class AccountsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.oil_config=patch('oilprice_api.configured',return_value=False)
        cls.oil_config.start()
        cls.temp = tempfile.TemporaryDirectory()
        server.DB = Path(cls.temp.name) / 'test.sqlite3'
        server.initialize()
        cls.http = server.Predict60HTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.temp.cleanup()
        cls.oil_config.stop()

    def request(self, method, path, data=None, cookie='', csrf='', extra_headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
        headers = {'Content-Type': 'application/json', 'Cookie': cookie, 'X-CSRF-Token': csrf}
        headers.update(extra_headers or {})
        conn.request(method, path, json.dumps(data) if data is not None else None, headers)
        response = conn.getresponse()
        raw = response.read()
        self.last_headers = dict(response.getheaders())
        payload = json.loads(raw) if response.getheader('Content-Type', '').startswith('application/json') else raw
        result = response.status, payload, response.getheader('Set-Cookie', '').split(';')[0]
        conn.close()
        return result

    def test_health_check_verifies_database(self):
        status, payload, _ = self.request('GET', '/healthz')
        self.assertEqual((status, payload), (200, {'ok': True}))
        self.assertEqual(self.last_headers['Cache-Control'], 'no-store')

    def test_https_origin_sets_matching_secure_login_and_logout_cookies(self):
        with patch.dict(server.os.environ, {'P60_HOST': 'https://predict60.com'}, clear=True):
            status, _, cookie = self.request('POST', '/api/signup', {
                'name': 'Secure', 'email': 'secure@example.com', 'password': 'strong-password-secure',
            })
            self.assertEqual(status, 200)
            login_cookie = self.last_headers['Set-Cookie']
            for attribute in ('HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800', 'Secure'):
                self.assertIn(attribute, login_cookie)
            self.assertEqual(self.last_headers['Strict-Transport-Security'],
                             'max-age=31536000')
            csrf = self.request('GET', '/api/account', cookie=cookie)[1]['csrf']
            self.assertEqual(self.request('POST', '/api/logout', {}, cookie, csrf)[0], 200)
            logout_cookie = self.last_headers['Set-Cookie']
            for attribute in ('HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0', 'Secure'):
                self.assertIn(attribute, logout_cookie)

    def test_local_http_cookie_is_not_forced_secure(self):
        with patch.dict(server.os.environ, {}, clear=True):
            self.assertNotIn('Secure', server.session_cookie('token', 60))
        with patch.dict(server.os.environ, {'P60_SECURE_COOKIES': 'true'}, clear=True):
            self.assertIn('Secure', server.session_cookie('token', 60))

    def test_deployment_environment_validation(self):
        valid = {
            'P60_HOST': 'https://predict60.com',
            'P60_TRUSTED_PROXIES': '127.0.0.1,::1',
            'P60_SECURE_COOKIES': 'true',
        }
        with patch.dict(server.os.environ, valid, clear=True):
            server.validate_environment()
        for variable, value in (
            ('P60_HOST', 'https://predict60.com/path'),
            ('P60_HOST', 'https://predict60.com/'),
            ('P60_HOST', 'ftp://predict60.com'),
            ('P60_TRUSTED_PROXIES', 'not-an-ip'),
            ('P60_SECURE_COOKIES', 'sometimes'),
        ):
            with self.subTest(variable=variable, value=value), patch.dict(
                    server.os.environ, {variable: value}, clear=True):
                with self.assertRaises(ValueError):
                    server.validate_environment()

    def test_forwarded_client_is_used_only_from_a_trusted_proxy(self):
        server.AUTH_ATTEMPTS.clear()
        headers = {'X-Forwarded-For': '203.0.113.25'}
        with patch.dict(server.os.environ, {'P60_TRUSTED_PROXIES': '127.0.0.1'}, clear=True):
            self.request('POST', '/api/login', {
                'email': 'missing@example.com', 'password': 'wrong-password',
            }, extra_headers=headers)
        self.assertIn('203.0.113.25', server.AUTH_ATTEMPTS)
        self.assertNotIn('127.0.0.1', server.AUTH_ATTEMPTS)
        server.AUTH_ATTEMPTS.clear()
        with patch.dict(server.os.environ, {}, clear=True):
            self.request('POST', '/api/login', {
                'email': 'missing@example.com', 'password': 'wrong-password',
            }, extra_headers=headers)
        self.assertIn('127.0.0.1', server.AUTH_ATTEMPTS)

    def test_public_origin_override_accepts_https_and_rejects_other_origins(self):
        with patch.dict('os.environ', {'P60_HOST': 'https://predict60.com'}):
            for path in ('/api/signup', '/api/login', '/api/logout', '/api/predictions'):
                for origin, expected in (
                    ('https://predict60.com', 415),
                    ('http://predict60.com', 403),
                    ('https://predict60.com.evil.example', 403),
                    ('https://evil.example', 403),
                    ('null', 403),
                    (f'http://127.0.0.1:{self.http.server_port}', 403),
                ):
                    with self.subTest(path=path, origin=origin):
                        # Unsupported content type proves accepted origins reach the next validation.
                        status, _, _ = self.request('POST', path, {}, extra_headers={
                            'Origin': origin, 'Content-Type': 'text/plain',
                        })
                        self.assertEqual(status, expected)

    def test_origin_default_and_absent_origin_preserve_existing_behavior(self):
        for configuration in (None, ''):
            with patch.dict('os.environ'):
                if configuration is None:
                    server.os.environ.pop('P60_HOST', None)
                else:
                    server.os.environ['P60_HOST'] = configuration
                for origin, expected in (
                    (f'http://127.0.0.1:{self.http.server_port}', 415),
                    ('https://predict60.com', 403),
                    (None, 415),
                ):
                    with self.subTest(configuration=configuration, origin=origin):
                        headers = {'Content-Type': 'text/plain'}
                        if origin is not None:
                            headers['Origin'] = origin
                        self.assertEqual(self.request('POST', '/api/login', {}, extra_headers=headers)[0], expected)
        with patch.dict('os.environ', {'P60_HOST': 'https://predict60.com'}):
            self.assertEqual(self.request('POST', '/api/login', {}, extra_headers={'Content-Type': 'text/plain'})[0], 415)

    def test_account_prediction_settlement_lifecycle(self):
        status, _, cookie = self.request('POST', '/api/signup', {'name': '<Test>', 'email': 'one@example.com', 'password': 'strong-password-123'})
        self.assertEqual(status, 200)
        self.assertEqual(self.request('GET', '/api/account')[0], 401)
        status, account, _ = self.request('GET', '/api/account', cookie=cookie)
        self.assertEqual(account['user']['balance_cents'], 1425000)
        csrf = account['csrf']
        self.assertEqual(self.request('POST', '/api/predictions', {}, cookie)[0], 403)
        self.assertEqual(self.request('POST', '/api/login', {'email': 'one@example.com', 'password': 'wrong-password'})[0], 401)
        self.assertEqual(self.request('POST', '/api/signup', {'name': 'Again', 'email': 'ONE@example.com', 'password': 'strong-password-123'})[0], 409)
        self.assertEqual(self.request('POST', '/api/login', {'email': 'one@example.com', 'password': 'strong-password-123'})[0], 200)
        now = int(server.time.time())
        start = now // 3600 * 3600
        order = {'coin': 'BTC', 'marketId': '60-0', 'side': 'up', 'budget': 50, 'requestId': 'test-request-00000001', 'startsAt': start * 1000, 'strike': 100, 'cents': 68}
        with patch('server.time.time', return_value=now), patch('server.candle_close', return_value=100), patch('server.fresh_spot', side_effect=ValueError('Price feed stale')):
            self.assertEqual(self.request('POST', '/api/predictions', order, cookie, csrf)[0], 400)
            unchanged = self.request('GET', '/api/account', cookie=cookie)[1]
            self.assertEqual(unchanged['user']['balance_cents'], 1425000)
            self.assertEqual(unchanged['predictions'], [])
        with patch('server.time.time', return_value=now), patch('server.candle_close', return_value=100), patch('server.fresh_spot',return_value=101), patch('server.market_up',return_value=68):
            status, account, _ = self.request('POST', '/api/predictions', order, cookie, csrf)
            self.assertEqual(status, 201, account)
            self.assertEqual(account['user']['balance_cents'], 1425000 - 5000)
            self.assertEqual(len(account['predictions']), 1)
            status, replay, _ = self.request('POST', '/api/predictions', order, cookie, csrf)
            self.assertEqual(replay['user']['balance_cents'], account['user']['balance_cents'])
            bad = dict(order, requestId='test-request-00000002', budget=0)
            self.assertEqual(self.request('POST', '/api/predictions', bad, cookie, csrf)[0], 400)
            bad = dict(order, requestId='test-request-00000003', startsAt=0)
            self.assertEqual(self.request('POST', '/api/predictions', bad, cookie, csrf)[0], 400)
        with patch('server.time.time', return_value=start + 3606), patch('server.candle_close', side_effect=ValueError('offline')):
            server.settle_due()
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM settlements').fetchone()[0], 0)
        with patch('server.time.time', return_value=start + 3606), patch('server.candle_close', return_value=100), patch('server.fresh_spot',return_value=101), patch('server.market_up',return_value=68):
            server.settle_due()
            server.settle_due()
        _, settled, _ = self.request('GET', '/api/account', cookie=cookie)
        self.assertEqual(settled['user']['balance_cents'], 1425000 - 5000 + 7353)
        self.assertEqual(settled['predictions'][0]['outcome'], 'up')
        status, _, other_cookie = self.request('POST', '/api/signup', {'name': 'Other', 'email': 'other@example.com', 'password': 'strong-password-456'})
        self.assertEqual(status, 200)
        self.assertEqual(self.request('GET', '/api/account', cookie=other_cookie)[1]['predictions'], [])
        with server.connect() as conn:
            saved = conn.execute('SELECT password_hash FROM users LIMIT 1').fetchone()[0]
            self.assertNotEqual(saved, 'strong-password-123')
        self.assertEqual(self.request('POST', '/api/logout', {}, cookie, csrf)[0], 200)
        self.assertEqual(self.request('GET', '/api/account', cookie=cookie)[0], 401)

    def test_live_execution_accepts_updated_benchmark_and_quote_until_cutoff(self):
        _, _, cookie = self.request('POST', '/api/signup', {'name': 'Live', 'email': 'live@example.com', 'password': 'strong-password-123'})
        csrf = self.request('GET', '/api/account', cookie=cookie)[1]['csrf']
        start = int(server.time.time()) // 3600 * 3600
        order = {'coin': 'BTC', 'marketId': '60-0', 'side': 'up', 'budget': 50, 'requestId': 'live-request-00000001', 'startsAt': start * 1000, 'strike': 99, 'cents': 10}
        with patch('server.time.time', return_value=start + 3569), patch('server.candle_close', return_value=100), patch('server.fresh_spot', return_value=101), patch('server.market_up', return_value=70):
            status, account, _ = self.request('POST', '/api/predictions', order, cookie, csrf)
            self.assertEqual(status, 201, account)
            with server.connect() as conn:
                saved = conn.execute('SELECT * FROM predictions WHERE request_id=?', (order['requestId'],)).fetchone()
                self.assertEqual(saved['strike'], 100)
                self.assertEqual(saved['cents'], 70)
                self.assertAlmostEqual(saved['contracts'], 5000/70)
                self.assertEqual(saved['cost_cents'], 5000)
            balance = account['user']['balance_cents']
        with patch('server.time.time', return_value=start + 3570):
            order['requestId'] = 'live-request-00000002'
            status, _, _ = self.request('POST', '/api/predictions', order, cookie, csrf)
            self.assertEqual(status, 400)
            self.assertEqual(self.request('GET', '/api/account', cookie=cookie)[1]['user']['balance_cents'], balance)

    def test_oil_is_coming_soon_while_feed_diagnostics_remain_available(self):
        categories = self.request('GET', '/api/categories')[1]['categories']
        self.assertEqual({c['id'] for c in categories}, {'crypto', 'oil', 'weather'})
        oil_category = next(c for c in categories if c['id'] == 'oil')
        self.assertEqual(oil_category['instrumentCount'], 5)
        self.assertEqual(oil_category['availability'], 'coming_soon')
        self.assertFalse(oil_category['tradable'])
        oil = [c for c in self.request('GET', '/api/coins')[1]['coins'] if c['category'] == 'oil']
        self.assertEqual({c['symbol'] for c in oil}, {'WTI', 'BRENT', 'DUBAI', 'OMAN', 'BONNY'})
        self.assertTrue(all(c['feed'] == 'twelvedata' and c['unit'] == 'USD/barrel' for c in oil))
        now = int(server.time.time()) // 3600 * 3600 + 600
        start = now // 3600 * 3600
        def history(product,start,end):
            return server.simulated_prices.candles('WTI',72,start,end)
        def quote(product):
            return {'price':server.simulated_prices.price('WTI',72,now),'time':now*1000,'source':'Twelve Data'}
        with patch('server.time.time', return_value=now), patch('server.live_oil.quote',side_effect=quote), patch('server.live_oil.candles',side_effect=history), patch('server.urllib.request.urlopen', side_effect=AssertionError('Oil must not use Coinbase')):
            spot = self.request('GET', '/api/spot?coin=WTI')[1]
            self.assertEqual(spot['price'], server.fresh_spot('WTI'))
            self.assertEqual(spot['source'], 'Twelve Data')
            candles = self.request('GET', f'/api/candles?coin=WTI&start={start-60}&end={now}')[1]
            self.assertEqual(candles[0][4], server.candle_close('WTI', start))
            self.assertTrue(all(c[1] <= min(c[3], c[4]) <= max(c[3], c[4]) <= c[2] for c in candles))
            self.assertEqual(self.request('GET', '/api/spot?coin=BTC')[0], 400)
            self.assertEqual(self.request('GET', f'/api/candles?coin=WTI&start=0&end={now}')[0], 400)
            _, _, cookie = self.request('POST', '/api/signup', {'name':'Oil player', 'email':'oil@example.com', 'password':'strong-password-oil'})
            account = self.request('GET', '/api/account', cookie=cookie)[1]
            csrf = account['csrf']
            order = {'coin':'WTI', 'marketId':'60-0', 'side':'up', 'budget':50, 'requestId':'oil-test-request-0001', 'startsAt':start*1000}
            status, error, _ = self.request('POST', '/api/predictions', order, cookie, csrf)
            self.assertEqual(status, 400)
            self.assertEqual(error['error'], 'Oil predictions are coming soon.')
            account = self.request('GET', '/api/account', cookie=cookie)[1]
            self.assertEqual(account['user']['balance_cents'], 1425000)
            self.assertEqual(account['predictions'], [])

    def test_live_oil_missing_key_and_unavailable_grades_do_not_return_fake_prices(self):
        with patch.dict(server.os.environ,{},clear=True),patch('server.urllib.request.urlopen') as network:
            status,data,_=self.request('GET','/api/spot?coin=WTI')
            self.assertEqual(status,503)
            self.assertIn('API key',data['error'])
            self.assertNotIn('price',data)
            status,data,_=self.request('GET','/api/spot?coin=DUBAI')
            self.assertEqual(status,503)
            self.assertIn('no verified',data['error'])
            network.assert_not_called()

    def test_database_coin_catalog(self):
        with server.connect() as conn:
            conn.execute("UPDATE coins SET enabled=1 WHERE symbol='AVAX'")
            self.assertEqual(conn.execute('SELECT count(*) FROM coins WHERE enabled=1 AND category="crypto"').fetchone()[0], 8)
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("UPDATE coins SET enabled=1 WHERE symbol='TRUMP'")
            conn.execute("UPDATE coins SET enabled=0 WHERE symbol='AVAX'")
            conn.execute("INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order) VALUES('TEST','Test coin','CUSTOM-USD',4,1.5,'',1,99)")
        status, catalog, _ = self.request('GET', '/api/coins')
        self.assertEqual(status, 200)
        added = next(c for c in catalog['coins'] if c['symbol'] == 'TEST')
        self.assertEqual(added['product'], 'CUSTOM-USD')
        self.assertEqual(added['precision'], 4)
        self.assertEqual(added['demoBase'], 1.5)
        with server.connect() as conn:
            conn.execute("UPDATE coins SET enabled=0,name='Renamed coin' WHERE symbol='TEST'")
        server.initialize()  # Restart does not overwrite administrator edits.
        catalog = self.request('GET', '/api/coins')[1]
        added = next(c for c in catalog['coins'] if c['symbol'] == 'TEST')
        self.assertEqual(added['enabled'], 0)
        self.assertEqual(added['name'], 'Renamed coin')
        status, _, cookie = self.request('POST', '/api/signup', {'name':'Catalog user','email':'catalog@example.com','password':'strong-password-789'})
        self.assertEqual(status, 200)
        csrf = self.request('GET', '/api/account', cookie=cookie)[1]['csrf']
        self.assertEqual(self.request('POST', '/api/predictions', {'coin':'TEST','marketId':'60-0','side':'up'}, cookie, csrf)[0], 400)
        class Candles:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return b'[[60,0,0,0,1.5]]'
        with patch('server.urllib.request.urlopen', return_value=Candles()) as request:
            self.assertEqual(server.candle_close('TEST', 120), 1.5)
            self.assertIn('/products/CUSTOM-USD/candles?', request.call_args.args[0].full_url)

    def test_win_loss_settlement_credits_once_and_is_user_scoped(self):
        status, _, cookie = self.request('POST','/api/signup',{'name':'Settlement user','email':'settle@example.com','password':'strong-password-999'})
        self.assertEqual(status,200)
        _, account, _ = self.request('GET','/api/account',cookie=cookie)
        user_id=account['user']['id'];csrf=account['csrf']
        now=int(server.time.time());start=now//3600*3600
        with patch('server.candle_close',return_value=100),patch('server.fresh_spot',return_value=101), patch('server.market_up',return_value=68):
            for side,cents in [('up',68),('down',32)]:
                order={'coin':'BTC','marketId':'60-0','side':side,'budget':50,'requestId':'settlement-request-'+side,'startsAt':start*1000,'strike':100,'cents':cents}
                status, account, _ = self.request('POST','/api/predictions',order,cookie,csrf)
                self.assertEqual(status,201,account)
        cost=sum(p['cost_cents'] for p in account['predictions'])
        with patch('server.time.time',return_value=start+3606),patch('server.candle_close',return_value=100),patch('server.fresh_spot',return_value=101), patch('server.market_up',return_value=68):
            server.settle_due(user_id+1000)
            self.assertTrue(all(p['settled_at'] is None for p in self.request('GET','/api/account',cookie=cookie)[1]['predictions']))
            for _ in range(2):
                self.assertEqual(self.request('POST','/api/settle',{},cookie,csrf)[0],200)
        _, settled, _ = self.request('GET','/api/account',cookie=cookie)
        up=next(p for p in settled['predictions'] if p['side']=='up')
        down=next(p for p in settled['predictions'] if p['side']=='down')
        self.assertEqual(up['payout_cents'],(up['cost_cents']*100+up['cents']-1)//up['cents'])
        self.assertEqual(down['payout_cents'],0)
        self.assertIsNotNone(down['settled_at'])
        self.assertEqual(settled['user']['balance_cents'],1425000-cost+up['payout_cents'])
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM settlements s JOIN predictions p ON p.id=s.prediction_id WHERE p.user_id=?',(user_id,)).fetchone()[0],2)

    def test_percentage_pricing(self):
        self.assertEqual(server.estimated_up(100,100,1000,1000,1900,.001),50)
        self.assertEqual(server.estimated_up(100,100,1060,1000,1900,.001),50)
        self.assertGreater(server.estimated_up(100,100.1,1060,1000,1900,.001),50)
        self.assertLess(server.estimated_up(100,99.9,1060,1000,1900,.001),50)
        self.assertEqual(server.estimated_up(100,200,1060,1000,1900,.001),99)

    def test_fresh_spot_rejects_stale_and_invalid_prices(self):
        from datetime import datetime, timezone
        now=int(server.time.time())
        class Ticker:
            def __init__(self,price,timestamp):
                self.body=json.dumps({'price':price,'time':datetime.fromtimestamp(timestamp,timezone.utc).isoformat()}).encode()
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self): return self.body
        with patch('server.urllib.request.urlopen',return_value=Ticker('101',now)):
            self.assertEqual(server.fresh_spot('BTC'),101)
        for price,timestamp in [('101',now-16),('101',now+10),('NaN',now),('0',now)]:
            with patch('server.urllib.request.urlopen',return_value=Ticker(price,timestamp)):
                with self.assertRaises(ValueError):server.fresh_spot('BTC')

    def test_static_compression_revalidation_and_head(self):
        import gzip
        conn=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        conn.request('GET','/styles.css',headers={'Accept-Encoding':'gzip'})
        response=conn.getresponse();body=response.read();etag=response.getheader('ETag')
        self.assertEqual(response.status,200)
        self.assertEqual(response.getheader('Content-Encoding'),'gzip')
        self.assertEqual(gzip.decompress(body),(server.ROOT/'styles.css').read_bytes())
        self.assertLess(len(body),len(gzip.decompress(body)))
        conn.request('GET','/styles.css',headers={'Accept-Encoding':'gzip','If-None-Match':etag})
        response=conn.getresponse();self.assertEqual(response.status,304);self.assertEqual(response.read(),b'')
        conn.request('HEAD','/responsive.css')
        response=conn.getresponse();self.assertEqual(response.status,200);self.assertEqual(response.read(),b'')
        self.assertGreater(int(response.getheader('Content-Length')),0)
        conn.close()

    def test_weather_is_coming_soon(self):
        categories = self.request('GET', '/api/categories')[1]['categories']
        weather = next(c for c in categories if c['id'] == 'weather')
        self.assertEqual(weather['availability'], 'coming_soon')
        self.assertEqual(weather['instrumentCount'], 20)
        self.assertEqual(len(weather['cities']), 10)
        self.assertFalse(weather['tradable'])
        self.assertEqual(self.request('GET', '/index.html?category=weather')[0], 302)
        coins = self.request('GET', '/api/coins')[1]['coins']
        self.assertFalse(any(c['category'] == 'weather' and c['enabled'] for c in coins))

    def test_markets_require_login(self):
        self.assertEqual(self.request('GET', '/index.html?category=oil')[0], 302)
        self.assertEqual(self.request('GET', '/categories.html')[0], 302)
        _, account, cookie = self.request('POST', '/api/signup', {
            'name': 'Market access', 'email': 'market-access@example.com',
            'password': 'strong-password-123'})
        self.assertEqual(self.request('GET', '/index.html?category=oil', cookie=cookie)[0], 302)
        self.assertEqual(self.request('GET', '/categories.html', cookie=cookie)[0], 200)
        for path in ['/', '/welcome.html']:
            conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
            conn.request('GET', path, headers={'Cookie': cookie})
            response = conn.getresponse()
            response.read()
            self.assertEqual(response.status, 302)
            self.assertEqual(response.getheader('Location'), '/categories.html')
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
            conn.close()
        _, account, _ = self.request('GET', '/api/account', cookie=cookie)
        self.assertEqual(self.request('POST', '/api/logout', {}, cookie, account['csrf'])[0], 200)
        self.assertEqual(self.request('GET', '/index.html', cookie=cookie)[0], 302)
        self.assertEqual(self.request('GET', '/welcome.html', cookie=cookie)[0], 200)

    def test_community_counts_track_unique_recent_sessions(self):
        before = self.request('GET', '/api/community')[1]
        _, _, cookie = self.request('POST', '/api/signup', {
            'name': 'Community member', 'email': 'community@example.com',
            'password': 'strong-password-123'})
        counts = self.request('GET', '/api/community', cookie=cookie)[1]
        self.assertEqual(counts['users'], before['users'] + 1)
        self.assertEqual(counts['activeUsers'], before['activeUsers'] + 1)
        with server.connect() as conn:
            user_id = conn.execute("SELECT id FROM users WHERE email='community@example.com'").fetchone()[0]
            conn.execute("INSERT INTO sessions(token_hash,user_id,csrf,expires_at,last_seen_at) VALUES('second-community-session',?,'csrf',?,?)", (user_id, int(server.time.time())+600, int(server.time.time())))
        self.assertEqual(self.request('GET', '/api/community')[1]['activeUsers'], counts['activeUsers'])
        with server.connect() as conn:
            conn.execute('UPDATE sessions SET last_seen_at=? WHERE user_id=?', (int(server.time.time())-301, user_id))
        self.assertEqual(self.request('GET', '/api/community')[1]['activeUsers'], before['activeUsers'])
        self.assertEqual(self.request('GET', '/api/community', cookie=cookie)[1]['activeUsers'], counts['activeUsers'])
        _, account, _ = self.request('GET', '/api/account', cookie=cookie)
        self.request('POST', '/api/logout', {}, cookie, account['csrf'])
        self.assertEqual(self.request('GET', '/api/community')[1]['activeUsers'], before['activeUsers'])

    def test_private_files_not_served(self):
        for path in ['/data/p60.sqlite3', '/server.py', '/.git/config', '/%2e%2e/server.py']:
            self.assertEqual(self.request('GET', path)[0], 404)
        for path in ['/', '/login.html', '/signup.html', '/portfolio.html', '/portfolio.js', '/portfolio.css']:
            self.assertEqual(self.request('GET', path)[0], 200)


if __name__ == '__main__':
    unittest.main()
