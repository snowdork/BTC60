"""Regression checks for bounded VPS resources and reduced duplicate database/provider work."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import http.client
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
import contests
import server


class ResourceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original = server.DB
        server.DB = Path(self.temp.name) / 'test.sqlite3'
        server.initialize()

    def tearDown(self):
        server.DB = self.original
        self.temp.cleanup()

    def test_catalog_query_counts_are_constant_as_instruments_grow(self):
        original_connect = server.connect
        statements = []

        @contextmanager
        def traced_connect():
            with original_connect() as conn:
                conn.set_trace_callback(statements.append)
                yield conn

        handler = object.__new__(server.Handler)
        handler.reply = lambda status, body: (status, body)
        for added in (0, 30):
            if added:
                with original_connect() as conn:
                    for number in range(added):
                        conn.execute(
                            'INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order,category,feed,unit) '
                            'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                            (f'TEST{number}', 'Extra', f'TEST{number}-USD', 2, 100, '', 0, number, 'crypto', 'coinbase', 'USD'),
                        )
            for path, expected in (('/api/coins', 1), ('/api/categories', 2)):
                with self.subTest(added=added, path=path):
                    statements.clear()
                    handler.path = path
                    with patch('server.connect', traced_connect), patch('server.oilprice_api.configured', return_value=False):
                        status, body = handler.do_GET()
                    self.assertEqual(status, 200)
                    self.assertEqual(len([s for s in statements if s.lstrip().upper().startswith('SELECT')]), expected)
                    if path == '/api/coins':
                        coins = {coin['symbol']: coin for coin in body['coins']}
                        self.assertEqual(coins['BTC']['feed'], 'coinbase')
                        self.assertEqual(coins['WTI']['feed'], 'twelvedata')
                        self.assertEqual(coins['DUBAI']['feedState'], 'unsupported')
                        self.assertFalse(any('override_provider' in coin or 'override_product' in coin for coin in coins.values()))

    def test_database_scopes_commit_rollback_and_close_without_gc(self):
        with server.connect() as conn:
            conn.execute('CREATE TABLE scope_test (value INTEGER)')
            conn.execute('INSERT INTO scope_test VALUES(1)')
        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute('SELECT 1')
        with self.assertRaisesRegex(RuntimeError, 'rollback'):
            with server.connect() as failed:
                failed.execute('INSERT INTO scope_test VALUES(2)')
                raise RuntimeError('rollback')
        with self.assertRaises(sqlite3.ProgrammingError):
            failed.execute('SELECT 1')
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT value FROM scope_test').fetchall()[0][0], 1)
            self.assertEqual(conn.execute('SELECT count(*) FROM scope_test').fetchone()[0], 1)

    def test_repeated_contest_dashboard_does_not_take_writer_lock(self):
        now = 86400 * 20000
        with server.connect() as conn:
            contests.dashboard(conn, 0, now)
        with server.connect() as writer:
            writer.execute('BEGIN IMMEDIATE')
            with server.connect() as reader:
                reader.execute('PRAGMA busy_timeout=10')
                statements = []
                reader.set_trace_callback(statements.append)
                result = contests.dashboard(reader, 0, now)
                self.assertEqual(len(result['contests']), 1)
                self.assertFalse(reader.in_transaction)
                self.assertFalse(any(s.startswith(('INSERT', 'UPDATE', 'DELETE')) for s in statements))

    def test_final_dashboard_bounds_leaders_without_losing_personal_ranks_or_tied_winners(self):
        now = 86400 * 20000
        with server.connect() as conn:
            conn.executemany('INSERT INTO users(id,name,email,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)',
                             [(uid, f'Player {uid}', f'{uid}@example.com', '', '', now) for uid in range(1, 251)])
            period = contests.ensure_period(conn, 'hourly', now - 3600)
            conn.execute('UPDATE contests SET finalized_at=? WHERE id=?', (now, period['id']))
            period = conn.execute('SELECT * FROM contests WHERE id=?', (period['id'],)).fetchone()
            for winner_count in (1, 125, 250, 0):
                with self.subTest(winners=winner_count):
                    conn.execute('DELETE FROM contest_results')
                    conn.executemany('INSERT INTO contest_results VALUES(?,?,?,?,?)',
                                     [(period['id'], uid, 1 if uid <= winner_count else uid,
                                       1000 if uid <= winner_count else -uid, 2)
                                      for uid in range(1, 251)] if winner_count else [])
                    expected = contests.standings(conn, period)
                    materialized = []

                    def counted_row(cursor, values):
                        row = sqlite3.Row(cursor, values)
                        if 'rank' in row.keys():
                            materialized.append(row)
                        return row

                    conn.row_factory = counted_row
                    result = contests.dashboard(conn, 250, now)
                    conn.row_factory = sqlite3.Row
                    actual = next(item for item in result['contests'] if item['id'] == period['id'])
                    self.assertEqual(actual['leaders'], expected[:100])
                    self.assertEqual(actual['mine'], next((row for row in expected if row['user_id'] == 250), None))
                    self.assertEqual(actual['winners'], [row for row in expected if row['rank'] == 1])
                    self.assertEqual(actual['winnerCount'], winner_count)
                    self.assertEqual(actual['participants'], len(expected))
                    if winner_count == 1:
                        self.assertEqual(len(materialized), 101)
                    self.assertIsNone(contests.dashboard_standings(conn, period, 999)['mine'])

    def test_failed_settlement_benchmark_is_requested_once_per_pass_and_retried(self):
        start = int(server.time.time()) // 3600 * 3600 - 3600
        with server.connect() as conn:
            conn.execute("INSERT INTO users(id,name,email,password_hash,salt,created_at) VALUES(1,'Test','test@example.com','','',0)")
            for number in range(3):
                identifier = f'pending-{number}'
                conn.execute('INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                             (identifier, 1, identifier, 'BTC', '60-0', 'up', start, start + 3600, 100, 50, 2, 100, start))
        with patch('server.time.time', return_value=start + 3606), patch('server.candle_close', side_effect=ValueError('offline')) as provider:
            server._settle_due()
            self.assertEqual(provider.call_count, 1)
        with patch('server.time.time', return_value=start + 3606), patch('server.candle_close', return_value=101) as provider:
            server._settle_due()
            self.assertEqual(provider.call_count, 1)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM settlements').fetchone()[0], 3)

    def test_concurrent_history_loads_share_the_six_provider_batches(self):
        server.HISTORY_CACHE.clear()
        barrier = threading.Barrier(8)
        def request():
            barrier.wait(timeout=5)
            return server.pricing_history('TEST-USD', 1800000000)
        def response(*args, **kwargs):
            return io.BytesIO(json.dumps([]).encode())
        try:
            with patch('server.urllib.request.urlopen', side_effect=response) as provider:
                with ThreadPoolExecutor(max_workers=8) as pool:
                    results = list(pool.map(lambda _: request(), range(8)))
                self.assertEqual(results, [[]] * 8)
                self.assertEqual(provider.call_count, 6)
        finally:
            server.HISTORY_CACHE.clear()

    def test_history_failure_does_not_poison_subsequent_retry(self):
        server.HISTORY_CACHE.clear()
        with patch('server.urllib.request.urlopen', side_effect=OSError('offline')):
            with self.assertRaises(OSError):
                server.pricing_history('RETRY-USD', 1800000000)
        with patch('server.urllib.request.urlopen', side_effect=lambda *a, **k: io.BytesIO(b'[]')) as provider:
            self.assertEqual(server.pricing_history('RETRY-USD', 1800000000), [])
            self.assertEqual(provider.call_count, 6)
        server.HISTORY_CACHE.clear()


class ConcurrencyTest(unittest.TestCase):
    def test_overload_returns_503_and_slots_are_reusable(self):
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        class Handler(server.SimpleHTTPRequestHandler):
            def do_GET(self):
                entered.set()
                release.wait(timeout=5)
                self.send_response(200)
                self.send_header('Content-Length', '0')
                self.end_headers()
            def log_message(self, *args):
                pass
        class TrackedServer(server.Predict60HTTPServer):
            def process_request_thread(self, *args):
                try:
                    super().process_request_thread(*args)
                finally:
                    finished.set()
        with patch.dict(server.os.environ, {'P60_MAX_REQUESTS': '1'}):
            http = TrackedServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        def connect():
            return http_client(http.server_port)
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                initial = pool.submit(connect)
                self.assertTrue(entered.wait(timeout=3))
                self.assertEqual(connect(), 503)
                release.set()
                self.assertEqual(initial.result(timeout=3), 200)
                self.assertTrue(finished.wait(timeout=3))
                self.assertEqual(connect(), 200)
        finally:
            release.set()
            http.shutdown()
            http.server_close()
            thread.join(timeout=3)


def http_client(port):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    try:
        conn.request('GET', '/')
        response = conn.getresponse()
        response.read()
        return response.status
    finally:
        conn.close()
