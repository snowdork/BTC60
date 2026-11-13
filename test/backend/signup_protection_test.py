"""Registration limits cover both identity methods, persistent budgets and concurrent capacity."""
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
                        patch.multiple(server.CONST, SIGNUP_CODE_REQUIRED=False, MAX_PLAYER_ACCOUNTS=100,
                                       SIGNUP_ATTEMPTS_PER_IP=10, SIGNUP_ACCOUNTS_PER_IP=3)):
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

    def test_google_and_password_share_daily_ip_budget_and_returning_google_login_works(self):
        handler = self.handler()
        self.register(1)
        self.register(2)
        identity = {'googleSub': 'google-player', 'email': 'google@example.test'}
        with patch('server.verify_google_login', return_value=identity):
            self.assertEqual(handler.authenticate_google({'name': 'Google'}, signup=True)[0], 200)
            with self.assertRaises(server.AuthenticationError) as error:
                self.register(3)
            self.assertEqual(error.exception.status, 429)
            self.assertEqual(handler.authenticate_google({}, signup=False)[0], 200)

    def test_failed_attempts_survive_handler_recreation_and_expire(self):
        with patch('server.time.time', return_value=100000):
            for _ in range(10):
                with self.assertRaises(ValueError):
                    self.handler().authenticate('/api/signup', {})
            with self.assertRaises(server.AuthenticationError) as error:
                self.register(1)
            self.assertEqual(error.exception.status, 429)
        with patch('server.time.time', return_value=103601):
            self.assertEqual(self.register(1)[0], 200)

    def test_bot_trap_blocks_password_and_google_before_verification(self):
        with self.assertRaises(server.AuthenticationError):
            self.register(1, website='spam.example')
        with patch('server.verify_google_login') as verify:
            with self.assertRaises(server.AuthenticationError):
                self.handler().authenticate_google({'website': 'spam.example'}, signup=True)
            verify.assert_not_called()
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 0)

    def test_daily_budget_expires_and_event_retention_is_bounded(self):
        with patch('server.time.time', return_value=100000):
            for index in range(3):
                self.register(index)
        with patch('server.time.time', return_value=186401):
            self.assertEqual(self.register(4)[0], 200)
            with server.connect() as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM signup_events').fetchone()[0], 2)

    def test_duplicate_email_does_not_consume_successful_registration_budget(self):
        self.register(1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.register(1)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM signup_events WHERE successful=1').fetchone()[0], 1)

    def test_ipv6_rotation_and_untrusted_forwarding_do_not_evade_ip_budget(self):
        first = self.handler('2001:db8:1:2::1')
        second = self.handler('2001:db8:1:2::abcd')
        self.assertEqual(first.signup_address(), second.signup_address())
        first.headers['X-Forwarded-For'] = '192.0.2.9'
        self.assertEqual(first.signup_address(), second.signup_address())
        self.assertEqual(self.handler('::ffff:192.0.2.1').signup_address(), self.handler().signup_address())

    def test_concurrent_last_slot_cannot_exceed_100_and_login_is_available_at_capacity(self):
        with server.connect() as conn:
            conn.executemany('INSERT INTO users(name,email,password_hash,salt,created_at) VALUES(?,?,?,?,?)',
                             [('Seed', f'seed{i}@example.test', '', '00', 0) for i in range(99)])
        def register(index):
            try:
                return self.register(index, self.handler(f'192.0.2.{index + 1}'))[0]
            except server.AuthenticationError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=6) as pool:
            statuses = list(pool.map(register, range(6)))
        self.assertEqual(statuses.count(200), 1)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 100)
            email = conn.execute("SELECT email FROM users WHERE name='Player'").fetchone()[0]
        self.assertEqual(self.handler().authenticate('/api/login', {'email': email, 'password': 'test-password'})[0], 200)
        with patch('server.verify_google_login', return_value={'googleSub': 'new', 'email': 'new@example.test'}):
            with self.assertRaises(server.AuthenticationError) as error:
                self.handler().authenticate_google({'name': 'New'}, signup=True)
            self.assertEqual(error.exception.status, 403)

    def test_concurrent_requests_cannot_exceed_daily_ip_allowance(self):
        def register(index):
            try:
                return self.register(index)[0]
            except server.AuthenticationError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=6) as pool:
            statuses = list(pool.map(register, range(6)))
        self.assertEqual(statuses.count(200), 3)
        self.assertEqual(statuses.count(429), 3)
