"""Local signup settings survive shell changes without exposing the code."""
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('local_restart', Path(__file__).resolve().parents[2] / 'scripts/restart-server.py')
restart = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restart)


class LocalSignupConfigTest(unittest.TestCase):
    def test_prompt_saves_private_code_and_next_shell_restores_it(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(restart, 'DATA', Path(directory)), patch.dict(os.environ, {}, clear=True), patch('sys.stdout', new_callable=io.StringIO) as output:
            with patch.object(restart.getpass, 'getpass', return_value='local-test-code'):
                restart.configure_signup_code(True)
            code_file = Path(directory) / 'local-signup-code'
            self.assertEqual(code_file.stat().st_mode & 0o777, 0o600)
            os.environ.pop('P60_SIGNUP_CODE')
            restart.configure_signup_code()
            self.assertEqual(os.environ['P60_SIGNUP_CODE'], 'local-test-code')
            self.assertNotIn('local-test-code', output.getvalue())

    def test_empty_environment_disables_signup_and_empty_prompt_preserves_saved_code(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(restart, 'DATA', Path(directory)), patch.dict(os.environ, {'P60_SIGNUP_CODE': ''}, clear=True), patch('sys.stdout', new_callable=io.StringIO):
            code_file = Path(directory) / 'local-signup-code'
            code_file.write_text('existing-code')
            restart.configure_signup_code()
            self.assertEqual(os.environ['P60_SIGNUP_CODE'], '')
            with patch.object(restart.getpass, 'getpass', return_value=''), self.assertRaises(SystemExit):
                restart.configure_signup_code(True)
            self.assertEqual(code_file.read_text(), 'existing-code')
