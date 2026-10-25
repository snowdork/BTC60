"""Verify CLI runtime selection without accessing real databases or deployments."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import reset_database
spec = importlib.util.spec_from_file_location('list_usernames', SCRIPTS / 'list-usernames.py')
listing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(listing)


class DeploymentDefaultsTest(unittest.TestCase):
    def test_runtime_defaults_and_overrides(self):
        for module in (reset_database, listing):
            for flags, expected in (([], 'docker'), (['--docker'], 'docker'),
                                    (['--service'], 'service'), (['--local'], 'local'),
                                    (['--container', 'p60-local'], 'docker'),
                                    (['--db', '/chosen.sqlite3'], 'docker')):
                with self.subTest(module=module.__name__, flags=flags):
                    argv = ['command', *flags]
                    if module is reset_database:
                        argv.append('--confirm-reset')
                    with patch.object(sys, 'argv', argv), \
                            patch.object(module, 'reset_docker') as docker, \
                            patch.object(module, 'reset_service') as service, \
                            patch.object(module.subprocess, 'run') as local:
                        self.assertEqual(module.main(), 0)
                        self.assertEqual(docker.call_count, int(expected == 'docker'))
                        self.assertEqual(service.call_count, int(expected == 'service'))
                        self.assertEqual(local.call_count, int(expected == 'local'))

    def test_reset_requires_confirmation_before_selecting_runtime(self):
        with patch.object(sys, 'argv', ['reset']), \
                patch.object(reset_database, 'reset_docker') as docker:
            with self.assertRaises(SystemExit):
                reset_database.main()
            docker.assert_not_called()

    def test_runtime_flags_cannot_be_combined(self):
        for module in (reset_database, listing):
            for flags in (['--local', '--docker'], ['--service', '--docker'],
                          ['--local', '--container', 'p60-local']):
                with self.subTest(module=module.__name__, flags=flags), \
                        patch.object(sys, 'argv', ['command', *flags, '--confirm-reset']
                                     if module is reset_database else ['command', *flags]), \
                        patch('sys.stderr'):
                    with self.assertRaises(SystemExit):
                        module.main()
