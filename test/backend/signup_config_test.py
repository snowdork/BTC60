"""Saved local signup settings work in direct Python and debugger launches."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import server


class SignupConfigurationTest(unittest.TestCase):
    def test_saved_code_is_loaded_by_local_server_without_restart_helper(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'ROOT', Path(directory)), patch.dict(os.environ, {}, clear=True):
            (Path(directory) / 'data').mkdir()
            (Path(directory) / 'data/local-signup-code').write_text('test-organizer-code')
            self.assertEqual(server.configured_signup_code(), 'test-organizer-code')
            with patch.dict(os.environ, {'P60_SIGNUP_CODE': ''}):
                self.assertEqual(server.configured_signup_code(), '')
            with patch.dict(os.environ, {'P60_SIGNUP_CODE': 'environment-code'}):
                self.assertEqual(server.configured_signup_code(), 'environment-code')
            with patch.dict(os.environ, {'P60_HOST': 'https://predict60.com'}):
                self.assertEqual(server.configured_signup_code(), '')

    def test_missing_code_remains_disabled(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'ROOT', Path(directory)), patch.dict(os.environ, {}, clear=True):
            self.assertEqual(server.configured_signup_code(), '')

    def test_local_env_supports_both_registration_methods_and_preserves_overrides(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'ROOT', Path(directory)), patch.dict(os.environ, {}, clear=True):
            root = Path(directory)
            (root / '.env.local').write_text('P60_SIGNUP_CODE="local code" # organizer\n')
            server.validate_signup_code('local code')
            with self.assertRaises(server.AuthenticationError) as error:
                server.validate_signup_code('wrong')
            self.assertEqual(error.exception.status, 403)
            with patch.dict(os.environ, {'P60_SIGNUP_CODE': ''}):
                self.assertEqual(server.configured_signup_code(), '')
            with patch.dict(os.environ, {'P60_HOST': 'https://predict60.com'}):
                self.assertEqual(server.configured_signup_code(), '')
            (root / 'data').mkdir()
            (root / 'data/local-signup-code').write_text('saved-code')
            self.assertEqual(server.configured_signup_code(), 'saved-code')

    def test_local_env_empty_and_malformed_values_keep_signup_disabled(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'ROOT', Path(directory)), patch.dict(os.environ, {}, clear=True):
            for value in ('', '"unterminated', 'two words'):
                (Path(directory) / '.env.local').write_text('P60_SIGNUP_CODE=' + value)
                self.assertEqual(server.configured_signup_code(), '')
