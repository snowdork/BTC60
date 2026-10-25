"""Google credentials never grant access without verification and same-origin CSRF."""
import hashlib
import json
import os
import tempfile
from pathlib import Path
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import google_login
import server
import server_test as fixtures


class GoogleLoginHTTPTest(unittest.TestCase):
    setUpClass = classmethod(fixtures.AccountsTest.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.AccountsTest.tearDownClass.__func__)
    setUp = fixtures.AccountsTest.setUp
    request = fixtures.AccountsTest.request

    def signup(self):
        status, _, cookie = self.request('POST', '/api/signup', {
            'name': 'Google player', 'email': 'player@example.com',
            'password': 'test-password', 'confirmPassword': 'test-password', 'signupCode': '777'})
        self.assertEqual(status, 200)
        return cookie

    def google_request(self, identity, cookie='', extra_headers=None, path='/api/auth/google', fields=None):
        headers = {'Origin': f'http://127.0.0.1:{self.http.server_port}',
                   'X-Requested-With': 'XMLHttpRequest'}
        _, data, csrf_cookie = self.request('GET', '/api/auth/google/csrf', extra_headers=headers)
        headers.update(extra_headers or {})
        with patch('server.verify_google_login', return_value=identity):
            return self.request('POST', path, {'credential': 'test-token', **(fields or {})},
                                '; '.join(c.split(';')[0] for c in [cookie, csrf_cookie] if c), data['csrf'], headers)

    def test_google_login_rotates_normal_session_and_uses_subject_not_email(self):
        old_cookie = self.signup()
        with server.connect() as conn:
            user_id = conn.execute('SELECT id FROM users').fetchone()['id']
            conn.execute('INSERT INTO google_identities VALUES(?,?,?)', ('google-123', user_id, int(time.time())))
        status, data, cookie = self.google_request({'googleSub': 'google-123', 'email': 'changed@example.com'}, old_cookie)
        self.assertEqual(status, 200)
        self.assertEqual(data['redirect'], '/categories.html')
        self.assertIn('HttpOnly', self.last_headers['Set-Cookie'])
        self.assertNotEqual(cookie, old_cookie)
        self.assertEqual(self.request('GET', '/api/account', cookie=old_cookie)[0], 401)
        account = self.request('GET', '/api/account', cookie=cookie)[1]
        self.assertEqual(account['user']['id'], user_id)
        self.assertTrue(account['csrf'])
        with server.connect() as conn:
            stored = conn.execute('SELECT token_hash FROM sessions').fetchone()['token_hash']
        self.assertEqual(stored, hashlib.sha256(cookie.split(';')[0].split('=', 1)[1].encode()).hexdigest())

    def test_unknown_subject_never_links_by_email_or_creates_an_account(self):
        self.signup()
        for email, code in [('player@example.com', 'LINK_REQUIRED'), ('new@example.com', 'SIGNUP_REQUIRED')]:
            status, data, cookie = self.google_request({'googleSub': 'new-subject', 'email': email})
            self.assertEqual(status, 409)
            self.assertEqual(data['code'], code)
            self.assertFalse(cookie)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT count(*) FROM google_identities').fetchone()[0], 0)

    def test_google_origin_and_csrf_fail_before_verification(self):
        allowed = f'http://127.0.0.1:{self.http.server_port}'
        for headers in [{}, {'Origin': allowed, 'X-Requested-With': 'XMLHttpRequest'},
                        {'Origin': 'https://evil.example', 'X-Requested-With': 'XMLHttpRequest'}]:
            with patch('server.verify_google_login') as verify:
                status, _, _ = self.request('POST', '/api/auth/google', {'credential': 'token'}, extra_headers=headers)
            self.assertEqual(status, 403)
            verify.assert_not_called()

    def test_invalid_google_token_cannot_issue_session(self):
        headers = {'Origin': f'http://127.0.0.1:{self.http.server_port}', 'X-Requested-With': 'XMLHttpRequest'}
        _, data, cookie = self.request('GET', '/api/auth/google/csrf', extra_headers=headers)
        with patch('server.verify_google_login', side_effect=ValueError('bad signature')):
            status, data, session = self.request('POST', '/api/auth/google', {'credential': 'forged'}, cookie, data['csrf'], headers)
        self.assertEqual(status, 401)
        self.assertFalse(session)
        self.assertNotIn('signature', data['error'])

    def test_authenticated_link_requires_existing_csrf_and_matching_email(self):
        cookie = self.signup()
        csrf = self.request('GET', '/api/account', cookie=cookie)[1]['csrf']
        headers = {'Origin': f'http://127.0.0.1:{self.http.server_port}', 'X-Requested-With': 'XMLHttpRequest'}
        identity = {'googleSub': 'google-123', 'email': 'player@example.com'}
        with patch('server.verify_google_login', return_value=identity):
            self.assertEqual(self.request('POST', '/api/auth/google/link', {'credential': 'token'}, cookie, '', headers)[0], 403)
            status, _, new_cookie = self.request('POST', '/api/auth/google/link', {'credential': 'token'}, cookie, csrf, headers)
        self.assertEqual(status, 200)
        self.assertNotEqual(cookie, new_cookie)
        self.assertEqual(self.google_request(identity)[0], 200)

    def test_google_login_is_rate_limited(self):
        with patch.object(server.Handler, 'auth_rate_limited', return_value=True), patch('server.verify_google_login') as verify:
            self.assertEqual(self.google_request({'googleSub': 'x', 'email': 'x@example.com'})[0], 429)
            verify.assert_not_called()


    def test_direct_local_launch_uses_saved_code_for_google_signup(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'ROOT', Path(directory)), patch.dict(os.environ):
            os.environ.pop('P60_SIGNUP_CODE', None)
            os.environ.pop('P60_HOST', None)
            (Path(directory) / 'data').mkdir()
            (Path(directory) / 'data/local-signup-code').write_text('saved-organizer-code')
            status, _, cookie = self.google_request(
                {'googleSub': 'saved-code-user', 'email': 'saved@example.com'},
                path='/api/auth/google/signup', fields={'name': 'Saved code user', 'signupCode': 'saved-organizer-code'})
            self.assertEqual(status, 200)
            self.assertTrue(cookie)

    def test_google_signup_requires_code_and_creates_identity_atomically(self):
        identity = {'googleSub': 'new-google', 'email': 'new@example.com'}
        for code in [None, '', 'wrong', '777 ', 777]:
            status, _, cookie = self.google_request(identity, path='/api/auth/google/signup',
                                                    fields={'name': 'New player', 'signupCode': code})
            self.assertEqual(status, 403)
            self.assertFalse(cookie)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT count(*) FROM google_identities').fetchone()[0], 0)
        status, _, cookie = self.google_request(identity, path='/api/auth/google/signup',
                                                fields={'name': 'New player', 'signupCode': '777'})
        self.assertEqual(status, 200)
        account = self.request('GET', '/api/account', cookie=cookie)[1]
        self.assertEqual(account['user']['email'], 'new@example.com')
        self.assertEqual(account['contestWallet']['remaining_cents'], 100000)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT user_id FROM google_identities WHERE google_sub=?', ('new-google',)).fetchone()[0], account['user']['id'])
            self.assertEqual(conn.execute('SELECT password_hash FROM users').fetchone()[0], '')
        self.assertEqual(self.google_request(identity)[0], 200)
        # Repeated signup never creates a duplicate user or resets credits.
        self.assertEqual(self.google_request(identity, path='/api/auth/google/signup')[0], 200)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 1)

    def test_signup_cannot_bypass_disabled_registration_or_merge_existing_email(self):
        identity = {'googleSub': 'new-google', 'email': 'new@example.com'}
        with patch.dict('os.environ', {'P60_SIGNUP_CODE': ''}):
            self.assertEqual(self.google_request(identity, path='/api/auth/google/signup', fields={'name': 'New', 'signupCode': '777'})[0], 503)
        self.signup()
        identity['email'] = 'player@example.com'
        status, data, _ = self.google_request(identity, path='/api/auth/google/signup', fields={'name': 'New', 'signupCode': '777'})
        self.assertEqual((status, data['code']), (409, 'LINK_REQUIRED'))
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM google_identities').fetchone()[0], 0)

    def test_link_rejects_signed_out_user_and_wrong_google_email(self):
        headers = {'Origin': f'http://127.0.0.1:{self.http.server_port}', 'X-Requested-With': 'XMLHttpRequest'}
        self.assertEqual(self.request('POST', '/api/auth/google/link', {'credential': 'token'}, extra_headers=headers)[0], 401)
        cookie = self.signup()
        csrf = self.request('GET', '/api/account', cookie=cookie)[1]['csrf']
        with patch('server.verify_google_login', return_value={'googleSub': 'other', 'email': 'other@example.com'}):
            self.assertEqual(self.request('POST', '/api/auth/google/link', {'credential': 'token'}, cookie, csrf, headers)[0], 409)
        with server.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM google_identities').fetchone()[0], 0)
        self.assertEqual(self.request('GET', '/google-link.html')[0], 302)
        self.assertIn('google=link', self.last_headers['Location'])

    def test_linking_and_google_login_preserve_predictions_credits_and_leaderboards(self):
        cookie = self.signup()
        csrf = self.request('GET', '/api/account', cookie=cookie)[1]['csrf']
        now = int(time.time()) // 3600 * 3600 + 300
        hour = now // 3600 * 3600
        order = {'coin': 'BTC', 'marketId': '60-0', 'side': 'up', 'startsAt': hour * 1000,
                 'requestId': 'google-preserve-prediction-001', 'budget': 125}
        with patch('server.time.time', return_value=now), patch('server.candle_close', return_value=100), patch('server.fresh_spot', return_value=101), patch('server.market_up', return_value=68):
            self.assertEqual(self.request('POST', '/api/predictions', order, cookie, csrf)[0], 201)
            with server.connect() as conn:
                user_id = conn.execute('SELECT id FROM users').fetchone()[0]
                period = server.contests.ensure_period(conn, 'hourly', hour - 3600)
                conn.execute('INSERT INTO contest_results VALUES(?,?,?,?,?)', (period['id'], user_id, 1, 25000, 3))
                conn.execute('UPDATE contests SET finalized_at=? WHERE id=?', (hour, period['id']))
            def records():
                with server.connect() as conn:
                    return {table: [tuple(row) for row in conn.execute('SELECT * FROM ' + table + ' ORDER BY rowid')]
                            for table in ['users', 'predictions', 'prediction_sources', 'settlements', 'contest_entries', 'contest_results', 'contests']}
            before = records()
            account_before = self.request('GET', '/api/account', cookie=cookie)[1]
            identity = {'googleSub': 'stable-google-id', 'email': 'player@example.com'}
            headers = {'Origin': f'http://127.0.0.1:{self.http.server_port}', 'X-Requested-With': 'XMLHttpRequest'}
            with patch('server.verify_google_login', return_value=identity):
                status, _, cookie = self.request('POST', '/api/auth/google/link', {'credential': 'token'}, cookie, csrf, headers)
            self.assertEqual(status, 200)
            self.assertEqual(records(), before)
            status, _, cookie = self.google_request(identity, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(records(), before)
            account_after = self.request('GET', '/api/account', cookie=cookie)[1]
            for key in ['user', 'predictions', 'contestWallet', 'lastHourContest']:
                self.assertEqual(account_after[key], account_before[key])
            self.assertEqual(account_after['contestWallet']['remaining_cents'], 87500)



class GoogleVerificationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from cryptography.hazmat.primitives.asymmetric import rsa
            from cryptography.hazmat.primitives import serialization
            from google.auth import crypt, jwt
        except ImportError:
            raise unittest.SkipTest('Install requirements.txt to run signed Google-token verification tests.')
        cls.jwt = jwt
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        public_pem = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        cls.signer = crypt.RSASigner.from_string(private_pem, key_id='test-key')
        cls.certs = json.dumps({'test-key': public_pem.decode()}).encode()

    def verify(self, tamper=False, **overrides):
        now = int(time.time())
        claims = {'iss': 'https://accounts.google.com', 'aud': google_login.DEFAULT_CLIENT_ID,
                  'sub': 'google-123', 'email': 'Player@example.com', 'email_verified': True,
                  'iat': now - 60, 'exp': now + 3600}
        claims.update(overrides)
        token = self.jwt.encode(self.signer, claims).decode()
        if tamper:
            head, body, signature = token.split('.')
            signature = ('A' if signature[0] != 'A' else 'B') + signature[1:]
            token = '.'.join([head, body, signature])
        response = SimpleNamespace(status=200, data=self.certs, headers={})
        with patch.dict('os.environ', {'GOOGLE_CLIENT_ID': google_login.DEFAULT_CLIENT_ID}), patch('google.auth.transport.requests.Request.__call__', return_value=response) as request:
            result = google_login.verify_google_login(token)
            self.assertEqual(request.call_args.kwargs['timeout'], 10)
            return result

    def test_valid_signed_token_normalizes_verified_identity(self):
        identity = self.verify()
        self.assertEqual(identity['googleSub'], 'google-123')
        self.assertEqual(identity['email'], 'player@example.com')

    def test_wrong_audience_issuer_expiry_and_unverified_claims_rejected(self):
        for claims in [{'aud': 'wrong-client'}, {'iss': 'https://evil.example'},
                       {'exp': 1}, {'email_verified': False}, {'sub': ''}, {'email': ''}]:
            with self.subTest(claims=claims), self.assertRaises(ValueError):
                self.verify(**claims)

    def test_missing_credential_rejected(self):
        for value in [None, 123, '', 'x' * 7001]:
            with self.assertRaises(ValueError):
                google_login.verify_google_login(value)

    def test_forged_signature_is_rejected(self):
        with self.assertRaises(ValueError):
            self.verify(tamper=True)
