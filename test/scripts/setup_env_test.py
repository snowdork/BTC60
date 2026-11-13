"""Exercise profile setup against temporary files with deployment commands mocked."""
import contextlib
import io
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import setup_env


class SetupEnvironmentTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        shutil.copytree(Path(__file__).resolve().parents[2] / 'deploy', self.root / 'deploy')
        self.root_patch = patch.object(setup_env, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.env_patch = patch.dict(os.environ, {}, clear=True)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def run_setup(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            status = setup_env.main(list(args))
        return status, output.getvalue()

    def test_local_creation_is_private_and_does_not_start_docker(self):
        with patch.object(setup_env.subprocess, 'run') as run:
            status, output = self.run_setup('--local', '--non-interactive')
        self.assertEqual(status, 0, output)
        run.assert_not_called()
        target = self.root / '.env.local'
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertIn('http://localhost:8085', output)
        self.assertFalse((self.root / '.env').exists())

    def test_local_chooses_separate_port_when_vps_profile_exists(self):
        (self.root / '.env').write_text('P60_PORT=8085\n')
        status, output = self.run_setup('--local', '--non-interactive')
        self.assertEqual(status, 0, output)
        self.assertIn('http://localhost:18085', output)

    def test_vps_requires_signup_code_without_writing_partial_file(self):
        status, output = self.run_setup('--vps', '--non-interactive')
        self.assertEqual(status, 1)
        self.assertIn('Signup code is required', output)
        self.assertFalse((self.root / '.env').exists())

    def test_vps_overrides_and_clears_example_alias_for_new_domain(self):
        with patch.dict(os.environ, {'P60_DOMAIN': 'example.test', 'P60_SIGNUP_CODE': 'private-test-code'}):
            status, output = self.run_setup('--vps', '--non-interactive')
        self.assertEqual(status, 0, output)
        values = setup_env.settings((self.root / '.env').read_text())
        self.assertEqual(values['P60_ADDITIONAL_ORIGINS'], '')
        self.assertIn('https://example.test', output)
        self.assertNotIn('private-test-code', output)

    def test_legacy_vps_settings_are_reused_without_modifying_legacy(self):
        legacy = 'P60_HOST=https://example.test\nP60_SIGNUP_CODE=legacy-code\n'
        (self.root / 'docker.env').write_text(legacy)
        status, output = self.run_setup('--vps', '--non-interactive')
        self.assertEqual(status, 0, output)
        self.assertEqual((self.root / 'docker.env').read_text(), legacy)
        self.assertEqual(setup_env.settings((self.root / '.env').read_text())['P60_DOMAIN'], 'example.test')

    def test_invalid_saved_profile_fails_check_and_start_without_changes(self):
        target = self.root / '.env.local'
        target.write_text('P60_SIGNUP_CODE=\nP60_PORT=8085\n')
        before = target.read_bytes()
        with patch.object(setup_env.subprocess, 'run') as run:
            for flags in (('--check',), ('--start',)):
                status, output = self.run_setup('--local', *flags)
                self.assertEqual(status, 1)
                self.assertIn('--update', output)
        run.assert_not_called()
        self.assertEqual(target.read_bytes(), before)

    def test_update_preserves_custom_settings_and_private_backup(self):
        target = self.root / '.env.local'
        previous = '# custom\nP60_PORT=18085\nP60_SIGNUP_CODE=old-code\nCUSTOM_SETTING=keep\n'
        target.write_text(previous)
        with patch.dict(os.environ, {'P60_SIGNUP_CODE': 'replacement-code'}):
            status, output = self.run_setup('--local', '--update', '--non-interactive')
        self.assertEqual(status, 0, output)
        self.assertIn('CUSTOM_SETTING=keep', target.read_text())
        backups = list(self.root.glob('.env.local.backup-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), previous)
        self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o600)
        self.assertNotIn('replacement-code', output)

    def test_check_does_not_write_or_deploy(self):
        self.run_setup('--local', '--non-interactive')
        target = self.root / '.env.local'
        target.chmod(0o640)
        before = target.stat().st_mtime_ns
        with patch.object(setup_env.subprocess, 'run') as run:
            status, output = self.run_setup('--local', '--check')
        self.assertEqual(status, 0, output)
        run.assert_not_called()
        self.assertEqual(target.stat().st_mtime_ns, before)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)

    def test_start_uses_selected_profile_and_propagates_deploy_failure(self):
        for mode, extra in (('--local', ['--local']), ('--vps', ['--recreate'])):
            with patch.dict(os.environ, {'P60_SIGNUP_CODE': 'test-code'}), patch.object(setup_env.subprocess, 'run') as run:
                run.return_value.returncode = 7
                flags = ['--recreate'] if mode == '--vps' else []
                status, output = self.run_setup(mode, '--non-interactive', '--start', *flags)
                self.assertEqual(status, 7, output)
                self.assertEqual(run.call_args.args[0], ['bash', str(self.root / 'scripts/restart-docker.sh'), *extra])
                self.assertNotIn('P60_SIGNUP_CODE', run.call_args.kwargs['env'])

    def test_symlink_target_is_rejected(self):
        other = self.root / 'other'
        other.write_text('unchanged')
        (self.root / '.env.local').symlink_to(other)
        status, output = self.run_setup('--local', '--non-interactive')
        self.assertEqual(status, 1)
        self.assertEqual(other.read_text(), 'unchanged')

    def test_invalid_domain_port_and_origins_leave_existing_file_untouched(self):
        with patch.dict(os.environ, {'P60_SIGNUP_CODE': 'test-code'}):
            self.run_setup('--vps', '--non-interactive')
        target = self.root / '.env'
        before = target.read_bytes()
        for key, value in (('P60_DOMAIN', 'https://example.test'), ('P60_PORT', '65536'),
                           ('P60_ADDITIONAL_ORIGINS', 'https://example.test/path')):
            with patch.dict(os.environ, {key: value}):
                status, output = self.run_setup('--vps', '--update', '--non-interactive')
            self.assertEqual(status, 1, output)
            self.assertEqual(target.read_bytes(), before)

    def test_check_requires_saved_file(self):
        status, output = self.run_setup('--local', '--check')
        self.assertEqual(status, 1)
        self.assertIn('missing', output)

    def test_incompatible_rollout_flags_fail_before_writing_files(self):
        for flags in (('--local', '--recreate'), ('--local', '--start', '--recreate'),
                      ('--vps', '--start', '--check'), ('--vps', '--check', '--update')):
            with self.subTest(flags=flags), self.assertRaises(SystemExit):
                self.run_setup(*flags)
        self.assertFalse((self.root / '.env').exists())
        self.assertFalse((self.root / '.env.local').exists())
