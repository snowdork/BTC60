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
