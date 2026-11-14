"""Registration stays open for both identity methods while retaining code and bot checks."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import server


class SignupProtectionTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        for context in (patch.object(server, 'DB', Path(self.directory.name) / 'test.sqlite3'),
                        patch.dict(os.environ, {}, clear=True),
                        patch.object(server.CONST, 'SIGNUP_CODE_REQUIRED', False)):
            context.start()
            self.addCleanup(context.stop)
        server.initialize()

    def handler(self, address='192.0.2.1'):
        handler = server.Handler.__new__(server.Handler)
        handler.client_address = (address, 12345)
        handler.headers = {'Host': 'localhost', 'Origin': 'http://localhost',
                           'X-Requested-With': 'XMLHttpRequest', 'Cookie': 'p60_google_csrf=test', 'X-CSRF-Token': 'test'}
        handler.auth_rate_limited = lambda: False
        handler.reply = lambda status, data, *args: (status, data)
        return handler

    def register(self, index, handler=None, **extra):
        return (handler or self.handler()).authenticate('/api/signup', {
            'name': 'Player', 'email': f'player{index}@example.test',
            'password': 'test-password', 'confirmPassword': 'test-password', **extra})

    def test_password_signup_needs_no_code_and_opt_in_gate_still_works(self):
        self.assertEqual(self.register(1)[0], 200)
        with patch.object(server.CONST, 'SIGNUP_CODE_REQUIRED', True), patch.dict(os.environ, {'P60_SIGNUP_CODE': 'secret'}):
            with self.assertRaises(server.AuthenticationError) as error:
                self.register(2)
            self.assertEqual(error.exception.status, 403)
            self.assertEqual(self.register(2, signupCode='secret')[0], 200)

    def test_password_and_google_signup_ignore_previous_network_budgets(self):
        with server.connect() as conn:
            conn.executemany('INSERT INTO signup_events VALUES(?,?,?)',
                             [('192.0.2.1', server.time.time(), success) for success in [0] * 10 + [1] * 3])
        for index in range(11):
            self.assertEqual(self.register(index)[0], 200)
        identity = {'googleSub': 'google-player', 'email': 'google@example.test'}
        with patch('server.verify_google_login', return_value=identity):
            self.assertEqual(self.handler().authenticate_google({'name': 'Google'}, signup=True)[0], 200)
            self.assertEqual(self.handler().authenticate_google({}, signup=False)[0], 200)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM signup_events').fetchone()[0], 13)

    def test_bot_trap_blocks_password_and_google_before_verification(self):
        with self.assertRaises(server.AuthenticationError):
            self.register(1, website='spam.example')
        with patch('server.verify_google_login') as verify:
            with self.assertRaises(server.AuthenticationError):
                self.handler().authenticate_google({'website': 'spam.example'}, signup=True)
            verify.assert_not_called()
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 0)

    def test_duplicate_email_still_rejected(self):
        self.register(1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.register(1)

    def test_concurrent_signup_and_google_can_exceed_previous_account_cap(self):
        with server.connect() as conn:
            conn.executemany('INSERT INTO users(name,email,password_hash,salt,created_at) VALUES(?,?,?,?,?)',
                             [('Seed', f'seed{i}@example.test', '', '00', 0) for i in range(100)])
        with ThreadPoolExecutor(max_workers=6) as pool:
            statuses = list(pool.map(lambda index: self.register(index)[0], range(6)))
        self.assertEqual(statuses, [200] * 6)
        with patch('server.verify_google_login', return_value={'googleSub': 'new', 'email': 'new@example.test'}):
            self.assertEqual(self.handler().authenticate_google({'name': 'New'}, signup=True)[0], 200)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 107)
        self.assertEqual(self.handler().authenticate('/api/login', {
            'email': 'player0@example.test', 'password': 'test-password'})[0], 200)
