"""Exercise contest isolation, limits, UTC boundaries, finalization, and prize auditing."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import contests
import server
import server_test


class ContestTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_db = server.DB
        server.DB = Path(self.temp.name) / 'contest.sqlite3'
        server.initialize()
        self.day = 86400 * 20000
        with server.connect() as conn:
            for uid in (1, 2, 3):
                conn.execute('INSERT INTO users(id,name,email,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)',
                             (uid, f'Player {uid}', f'{uid}@example.com', '', '', self.day))

    def tearDown(self):
        server.DB = self.original_db
        self.temp.cleanup()

    def entry(self, conn, identifier, user=1, start=None, cost=50000, coin='BTC', payout=None):
        start = self.day if start is None else start
        conn.execute('INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                     (identifier, user, identifier, coin, '60-0', 'up', start, start + 3600, 100, 50, cost / 50, cost, start + 60))
        contests.enter(conn, identifier, user, coin, start, start + 3600, cost)
        if payout is not None:
            conn.execute('INSERT INTO settlements VALUES(?,?,?,?,?,?)', (identifier, 101, 'up', payout, start + 3601, 'test'))

    def test_daily_allowance_and_window_limit_do_not_depend_on_practice_balance(self):
        with server.connect() as conn:
            conn.execute('UPDATE users SET balance_cents=0 WHERE id=1')
            self.entry(conn, 'first', cost=60000)
        with self.assertRaisesRegex(ValueError, 'per instrument'):
            with server.connect() as conn:
                self.entry(conn, 'over-window', cost=40001)
        with server.connect() as conn:
            self.entry(conn, 'at-limit', cost=40000)
            self.assertEqual(contests.wallet(conn, 1, self.day)['remaining_cents'], 900000)
            self.assertEqual(conn.execute('SELECT count(*) FROM predictions').fetchone()[0], 2)
            self.assertEqual(conn.execute('SELECT balance_cents FROM users WHERE id=1').fetchone()[0], 0)

    def test_concurrent_entries_cannot_exceed_aggregate_cap(self):
        def submit(identifier):
            try:
                with server.connect() as conn:
                    conn.execute('BEGIN IMMEDIATE')
                    self.entry(conn, identifier, cost=60000)
                return True
            except ValueError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(submit, ['race-a', 'race-b'])), [False, True])
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM predictions').fetchone()[0], 1)

    def test_daily_total_cap_and_midnight_reset(self):
        with server.connect() as conn:
            for i in range(10):
                self.entry(conn, f'entry-{i}', start=self.day + i * 3600, cost=100000, payout=200000)
            self.assertEqual(contests.wallet(conn, 1, self.day)['remaining_cents'], 0)
            self.assertEqual(contests.wallet(conn, 1, self.day + 86400)['remaining_cents'], 1000000)
        with self.assertRaisesRegex(ValueError, 'Daily contest'):
            with server.connect() as conn:
                self.entry(conn, 'over-day', start=self.day + 10 * 3600, cost=100)
        with server.connect() as conn:
            self.entry(conn, 'next-day', start=self.day + 86400, cost=100000)
            self.assertEqual(contests.wallet(conn, 1, self.day + 86400)['remaining_cents'], 900000)

    def test_midnight_close_belongs_to_previous_day(self):
        with server.connect() as conn:
            self.entry(conn, 'midnight', start=self.day + 23 * 3600)
            period = conn.execute('SELECT c.* FROM contests c JOIN contest_entries e ON e.daily_id=c.id').fetchone()
            self.assertEqual(period['starts_at'], self.day)
            self.assertEqual(contests.wallet(conn, 1, self.day + 86400)['spent_cents'], 0)

    def test_pending_results_delay_winners_and_finalization_is_idempotent(self):
        with server.connect() as conn:
            self.entry(conn, 'settled', user=1, payout=100000)
            self.entry(conn, 'pending', user=2)
            contests.finalize(conn, self.day + 90000)
            self.assertEqual(conn.execute('SELECT count(*) FROM contest_results').fetchone()[0], 0)
            conn.execute('INSERT INTO settlements VALUES(?,?,?,?,?,?)', ('pending', 101, 'up', 100000, self.day + 90001, 'test'))
            contests.finalize(conn, self.day + 90002)
            contests.finalize(conn, self.day + 90003)
            results = conn.execute('SELECT * FROM contest_results').fetchall()
            self.assertEqual(len(results), 4)
            self.assertTrue(all(row['rank'] == 1 and row['score_cents'] == 50000 for row in results))

    def test_reserved_pools_split_once_and_private_references_stay_private(self):
        with server.connect() as conn:
            contests.reserve_prize(conn, 'hourly', self.day, 'gift_card', 501, 'Test award', 'PRIVATE-RESERVE', now=self.day - 1)
            self.entry(conn, 'tie-1', user=1, payout=100000)
            self.entry(conn, 'tie-2', user=2, payout=100000)
            contests.finalize(conn, self.day + 3601)
            contests.finalize(conn, self.day + 3602)
            gifts = conn.execute("SELECT * FROM contest_prizes WHERE kind='gift_card' ORDER BY user_id").fetchall()
            self.assertEqual([p['amount'] for p in gifts], [251, 250])
            self.assertEqual(conn.execute('SELECT count(*) FROM contest_prizes').fetchone()[0], 2)
            prize_id = gifts[0]['id']
            with self.assertRaises(ValueError):
                contests.update_prize(conn, prize_id, 'fulfilled', 'too-soon')
            contests.update_prize(conn, prize_id, 'approved', 'Verified eligibility')
            contests.update_prize(conn, prize_id, 'fulfilled', 'PRIVATE-DELIVERY')
            contests.update_prize(conn, prize_id, 'fulfilled', 'PRIVATE-DELIVERY')
            self.assertEqual(conn.execute('SELECT count(*) FROM contest_prize_events WHERE prize_id=?', (prize_id,)).fetchone()[0], 3)
            view = contests.dashboard(conn, 1, self.day + 3602)
            self.assertNotIn('PRIVATE', str(view))
            self.assertEqual(len(view['prizes']), 1)
            self.assertNotIn('user_id', view['prizes'][0])

    def test_prizes_cannot_be_added_after_open_and_no_entries_means_no_winner(self):
        with server.connect() as conn:
            with self.assertRaises(ValueError):
                contests.reserve_prize(conn, 'hourly', self.day, 'gift_card', 500, 'Prize', 'Funds', now=self.day)
            contests.reserve_prize(conn, 'hourly', self.day, 'gift_card', 500, 'Prize', 'Funds', now=self.day - 1)
            with self.assertRaises(sqlite3.IntegrityError):
                contests.reserve_prize(conn, 'hourly', self.day, 'gift_card', 999, 'Changed', 'Funds', now=self.day - 1)
            contests.finalize(conn, self.day + 3601)
            self.assertEqual(conn.execute('SELECT count(*) FROM contest_results').fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT count(*) FROM contest_prizes').fetchone()[0], 0)

    def test_non_gift_card_prizes_are_rejected(self):
        with server.connect() as conn:
            with self.assertRaises(ValueError):
                contests.reserve_prize(conn, 'hourly', self.day, 'ai_credit', 100, 'Unsupported', 'Funds', now=self.day - 1)

    def test_existing_schema_keeps_old_records_but_rejects_new_non_gift_prizes(self):
        with sqlite3.connect(':memory:') as conn:
            conn.execute("CREATE TABLE contest_prize_plans (contest_id INTEGER, kind TEXT, amount INTEGER, description TEXT, funding_reference TEXT, created_at INTEGER, PRIMARY KEY(contest_id,kind))")
            conn.execute("INSERT INTO contest_prize_plans VALUES(1,'ai_credit',100,'Old record','old',0)")
            contests.initialize(conn)
            self.assertEqual(conn.execute('SELECT count(*) FROM contest_prize_plans').fetchone()[0], 1)
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO contest_prize_plans VALUES(2,'ai_credit',100,'Unsupported','new',0)")
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("UPDATE contest_prize_plans SET kind='other' WHERE contest_id=1")

    def test_sponsor_configuration_rejects_non_https_or_credentials(self):
        with patch.dict(contests.os.environ, {}, clear=True):
            self.assertEqual(contests.sponsor(), {'enabled': False})
        for url in ['javascript:alert(1)', 'https://user:secret@example.com', 'http://example.com', 'https://[bad']:
            with patch.dict(contests.os.environ, {'P60_SPONSOR_NAME': 'Sponsor', 'P60_SPONSOR_URL': url}, clear=True):
                self.assertFalse(contests.sponsor()['enabled'])
        with patch.dict(contests.os.environ, {'P60_SPONSOR_NAME': 'Sponsor', 'P60_SPONSOR_URL': 'https://example.com'}, clear=True):
            self.assertTrue(contests.sponsor()['enabled'])


class ContestHTTPTest(unittest.TestCase):
    request = server_test.AccountsTest.request

    def setUp(self):
        self.original_db = server.DB
        self.temp = tempfile.TemporaryDirectory()
        server.DB = Path(self.temp.name) / 'api.sqlite3'
        server.initialize()
        server.AUTH_ATTEMPTS.clear()
        self.http = server.Predict60HTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        server.DB = self.original_db
        self.temp.cleanup()

    def test_contest_predictions_settle_without_affecting_practice_balance(self):
        self.assertEqual(self.request('GET', '/api/contests')[0], 401)
        _, initial, cookie = self.request('POST', '/api/signup', {'confirmPassword': 'pass-123', 'signupCode': '777', 'name': 'Player', 'email': 'contest@example.com', 'password': 'pass-123'})
        initial = self.request('GET', '/api/account', cookie=cookie)[1]
        csrf = initial['csrf']
        now = int(server.time.time()) // 3600 * 3600 + 120
        start = now // 3600 * 3600
        order = {'mode': 'contest', 'coin': 'BTC', 'marketId': '60-0', 'side': 'up', 'budget': 600, 'requestId': 'contest-http-request-01', 'startsAt': start * 1000}
        with patch('server.time.time', return_value=now), patch('server.candle_close', return_value=100), patch('server.fresh_spot', return_value=101), patch('server.market_up', return_value=50):
            self.assertEqual(self.request('POST', '/api/predictions', order, cookie)[0], 403)
            status, accepted, _ = self.request('POST', '/api/predictions', order, cookie, csrf)
            self.assertEqual(status, 201, accepted)
            self.assertEqual(accepted['user']['balance_cents'], initial['user']['balance_cents'])
            self.assertEqual(accepted['contestWallet']['remaining_cents'], 940000)
            self.assertEqual(accepted['predictions'][0]['mode'], 'contest')
            self.assertEqual(self.request('POST', '/api/predictions', order, cookie, csrf)[0], 200)
            rejected = dict(order, requestId='contest-http-request-02', side='down', budget=401)
            self.assertEqual(self.request('POST', '/api/predictions', rejected, cookie, csrf)[0], 400)
            unchanged = self.request('GET', '/api/account', cookie=cookie)[1]
            self.assertEqual(len(unchanged['predictions']), 1)
            self.assertEqual(unchanged['contestWallet']['remaining_cents'], 940000)
        with patch('server.time.time', return_value=start + 3605), patch('server.candle_close', return_value=101):
            server.settle_due()
            server.settle_due()
            account = self.request('GET', '/api/account', cookie=cookie)[1]
            self.assertEqual(account['user']['balance_cents'], initial['user']['balance_cents'])
            self.assertEqual(account['predictions'][0]['payout_cents'], 120000)
            board = self.request('GET', '/api/contests', cookie=cookie)[1]
            completed = next(c for c in board['contests'] if c['kind'] == 'hourly' and c['starts_at'] == start)
            self.assertEqual(completed['state'], 'final')
            self.assertEqual(completed['mine']['rank'], 1)
            self.assertEqual(completed['mine']['score_cents'], 60000)
