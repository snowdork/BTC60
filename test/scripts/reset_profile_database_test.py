"""Verify profile isolation, image preflight and failure ordering with Docker entirely mocked."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import reset_profile_database as reset


class ProfileResetTest(unittest.TestCase):
    def info(self, local=False):
        return {'Id': 'selected-id', 'Image': 'sha256:old',
                'Name': '/p60-local' if local else '/prefixed_p60-app-1',
                'Config': {'Labels': {} if local else {'com.docker.compose.project': 'p60',
                                                     'com.docker.compose.service': 'app'}}}

    def test_confirmation_is_required_before_discovery(self):
        with patch.object(reset, 'select_app') as select, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                reset.main(['--vps'])
        select.assert_not_called()

    def test_local_selection_uses_only_named_local_container(self):
        with patch.object(reset, 'output', return_value=json.dumps([self.info(local=True)])) as output:
            info, fallback = reset.select_app(True)
        output.assert_called_once_with(['docker', 'inspect', 'p60-local'])
        self.assertEqual(info['Id'], 'selected-id')
        self.assertEqual(fallback, 'p60:local-dev')

    def test_local_rejects_vps_container_even_if_named_local(self):
        info = self.info()
        info['Name'] = '/p60-local'
        with patch.object(reset, 'output', return_value=json.dumps([info])):
            with self.assertRaises(ValueError):
                reset.select_app(True)

    def test_vps_selection_uses_checkout_compose_and_accepts_prefixed_name(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.env').write_text('P60_DOMAIN=example.test\n')
            with patch.object(reset, 'ROOT', root), patch.object(reset.subprocess, 'run') as run, \
                    patch.object(reset, 'output', side_effect=['selected-id', json.dumps([self.info()]),
                                                               json.dumps({'services': {'app': {'image': 'p60:local'}}})]) as output:
                info, fallback = reset.select_app(False)
            self.assertEqual(info['Name'], '/prefixed_p60-app-1')
            self.assertEqual(fallback, 'p60:local')
            command = output.call_args_list[0].args[0]
            self.assertEqual(command[-4:], ['ps', '--all', '--quiet', 'app'])
            self.assertIn(str(root / '.env'), command)
            self.assertEqual(command[command.index('--project-name') + 1], 'p60')
            run.assert_called_once()

    def test_vps_ambiguity_fails_before_any_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.env').touch()
            with patch.object(reset, 'ROOT', root), patch.object(reset.subprocess, 'run'), \
                    patch.object(reset, 'output', return_value='old-id new-id'):
                with self.assertRaisesRegex(ValueError, 'Expected one VPS'):
                    reset.select_app(False)

    def test_deleted_container_image_falls_back_to_available_profile_image(self):
        with patch.object(reset.subprocess, 'run', side_effect=[Mock(returncode=1), Mock(returncode=0)]) as run:
            self.assertEqual(reset.available_image(self.info(), 'p60:local'), 'p60:local')
        self.assertEqual(run.call_args_list[0].args[0][-1], 'sha256:old')
        self.assertEqual(run.call_args_list[1].args[0][-1], 'p60:local')

    def test_unavailable_images_prevent_reset_and_restart(self):
        with patch.object(reset, 'select_app', return_value=(self.info(), 'p60:local')), \
                patch.object(reset.subprocess, 'run', return_value=Mock(returncode=1)), \
                patch.object(reset, 'reset_docker') as clear, patch.object(reset, 'restart_and_check') as restart, \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(reset.main(['--vps', '--confirm-reset']), 1)
        clear.assert_not_called()
        restart.assert_not_called()

    def test_reset_failure_leaves_app_stopped(self):
        with patch.object(reset, 'select_app', return_value=(self.info(), 'p60:local')), \
                patch.object(reset, 'available_image', return_value='p60:local'), \
                patch.object(reset, 'reset_docker', side_effect=subprocess.CalledProcessError(1, ['maintenance'])), \
                patch.object(reset, 'restart_and_check') as restart, \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(reset.main(['--vps', '--confirm-reset']), 1)
        restart.assert_not_called()

    def test_success_resets_only_selected_container_before_restart(self):
        actions = []
        with patch.object(reset, 'select_app', return_value=(self.info(local=True), 'p60:local-dev')), \
                patch.object(reset, 'available_image', return_value='p60:local-dev'), \
                patch.object(reset, 'reset_docker', side_effect=lambda *args, **kw: actions.append('reset')) as clear, \
                patch.object(reset, 'restart_and_check', side_effect=lambda identifier: actions.append(identifier)), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(reset.main(['--local', '--confirm-reset']), 0)
        self.assertEqual(actions, ['reset', 'selected-id'])
        self.assertEqual(clear.call_args.args[0].container, 'selected-id')
        self.assertEqual(clear.call_args.kwargs['maintenance_image'], 'p60:local-dev')

    def test_restart_waits_for_health_of_the_selected_app_only(self):
        with patch.object(reset.subprocess, 'run', side_effect=[Mock(returncode=0), Mock(returncode=1), Mock(returncode=0)]) as run, \
                patch.object(reset.time, 'sleep') as sleep, contextlib.redirect_stdout(io.StringIO()):
            reset.restart_and_check('selected-id')
        self.assertEqual(run.call_args_list[0].args[0], ['docker', 'start', 'selected-id'])
        self.assertEqual(run.call_args.args[0][:3], ['docker', 'exec', 'selected-id'])
        sleep.assert_called_once_with(2)
