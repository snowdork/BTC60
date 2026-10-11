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
        cls.temp = tempfile.TemporaryDirectory()
        server.DB = Path(cls.temp.name) / 'test.sqlite3'
        server.initialize()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.temp.cleanup()

    def request(self, method, path, data=None, cookie='', csrf=''):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
        headers = {'Content-Type': 'application/json', 'Cookie': cookie, 'X-CSRF-Token': csrf}
        conn.request(method, path, json.dumps(data) if data is not None else None, headers)
        response = conn.getresponse()
        raw = response.read()
        payload = json.loads(raw) if response.getheader('Content-Type', '').startswith('application/json') else raw
        result = response.status, payload, response.getheader('Set-Cookie', '').split(';')[0]
        conn.close()
        return result

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
        with patch('server.time.time', return_value=now), patch('server.candle_close', return_value=100), patch('server.fresh_spot',return_value=101), patch('server.market_up',return_value=69):
            status, account, _ = self.request('POST', '/api/predictions', order, cookie, csrf)
            self.assertEqual(status, 201, account)
            self.assertEqual(account['user']['balance_cents'], 1425000 - 73 * 68)
            self.assertEqual(len(account['predictions']), 1)
            status, replay, _ = self.request('POST', '/api/predictions', order, cookie, csrf)
            self.assertEqual(replay['user']['balance_cents'], account['user']['balance_cents'])
            bad = dict(order, requestId='test-request-00000002', cents=1)
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
        self.assertEqual(settled['user']['balance_cents'], 1425000 - 73 * 68 + 7300)
        self.assertEqual(settled['predictions'][0]['outcome'], 'up')
        status, _, other_cookie = self.request('POST', '/api/signup', {'name': 'Other', 'email': 'other@example.com', 'password': 'strong-password-456'})
        self.assertEqual(status, 200)
        self.assertEqual(self.request('GET', '/api/account', cookie=other_cookie)[1]['predictions'], [])
        with server.connect() as conn:
            saved = conn.execute('SELECT password_hash FROM users LIMIT 1').fetchone()[0]
            self.assertNotEqual(saved, 'strong-password-123')
        self.assertEqual(self.request('POST', '/api/logout', {}, cookie, csrf)[0], 200)
        self.assertEqual(self.request('GET', '/api/account', cookie=cookie)[0], 401)

    def test_database_coin_catalog(self):
        with server.connect() as conn:
            conn.execute("UPDATE coins SET enabled=1 WHERE symbol='AVAX'")
            self.assertEqual(conn.execute('SELECT count(*) FROM coins WHERE enabled=1').fetchone()[0], 8)
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("UPDATE coins SET enabled=1 WHERE symbol='TRUMP'")
            conn.execute("UPDATE coins SET enabled=0 WHERE symbol='AVAX'")
            conn.execute("INSERT INTO coins VALUES('TEST','Test coin','CUSTOM-USD',4,1.5,'',1,99)")
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
        self.assertEqual(up['payout_cents'],up['contracts']*100)
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

    def test_private_files_not_served(self):
        for path in ['/data/btc60.sqlite3', '/server.py', '/.git/config', '/%2e%2e/server.py']:
            self.assertEqual(self.request('GET', path)[0], 404)
        for path in ['/', '/login.html', '/signup.html', '/index.html', '/portfolio.html', '/portfolio.js', '/portfolio.css']:
            self.assertEqual(self.request('GET', path)[0], 200)


if __name__ == '__main__':
    unittest.main()
