"""Verify deployment database selection without changing real deployments."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('reset_deployment', Path(__file__).resolve().parents[2] / 'scripts/reset_database.py')
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)
from argparse import Namespace


class DeploymentResetTest(unittest.TestCase):
    def test_service_uses_its_environment_and_user(self):
        with tempfile.TemporaryDirectory() as folder:
            envfile = Path(folder) / 'service.env'
            envfile.write_text('PREDICT60_DB="/var/lib/predict60/live.sqlite3"\n')
            with patch.object(reset, 'output', side_effect=[
                    'loaded', 'predict60', '/opt/predict60/current', '',
                    str(envfile) + ' (ignore_errors=no)']), \
                    patch.object(reset.os, 'geteuid', return_value=0), \
                    patch.object(reset.subprocess, 'run') as run:
                reset.reset_service(Namespace(db=None))
                self.assertEqual(run.call_args_list[0].args[0], ['systemctl', 'stop', 'predict60.service'])
                self.assertEqual(run.call_args.args[0][:4], ['runuser', '-u', 'predict60', '--'])
                self.assertEqual(run.call_args.kwargs['env']['PREDICT60_DB'], '/var/lib/predict60/live.sqlite3')

    def test_docker_uses_existing_image_user_environment_and_volume(self):
        info = {'Name': '/p60-local', 'Id': 'container-id', 'Image': 'sha256:image',
                'Config': {'Env': ['PREDICT60_DB=/app/data/live.sqlite3'], 'User': '10001',
                           'WorkingDir': '/app', 'Labels': {}}}
        with patch.object(reset, 'output', return_value=json.dumps([info])), \
                patch.object(reset.subprocess, 'run') as run:
            reset.reset_docker(Namespace(container='p60-local', db=None))
            self.assertEqual(run.call_args_list[0].args[0], ['docker', 'stop', '--time', '30', 'container-id'])
            command = run.call_args.args[0]
            self.assertIn('PREDICT60_DB=/app/data/live.sqlite3', command)
            self.assertEqual(command[command.index('--volumes-from') + 1], 'container-id')
            self.assertEqual(command[command.index('--user') + 1], '10001')
            self.assertIn('sha256:image', command)

    def test_list_service_does_not_stop_or_reset(self):
        with patch.object(reset, 'output', side_effect=[
                'loaded', 'root', '/opt/predict60/current',
                'PREDICT60_DB=/var/lib/predict60/p60.sqlite3', '']), \
                patch.object(reset.os, 'geteuid', return_value=0), \
                patch.object(reset.subprocess, 'run') as run:
            reset.reset_service(Namespace(db=None), command_name='usernames')
            run.assert_called_once()
            self.assertEqual(run.call_args.args[0][-1], 'usernames')
            self.assertNotIn('--confirm-reset', run.call_args.args[0])
            self.assertEqual(run.call_args.kwargs['env']['PREDICT60_DB'],
                             '/var/lib/predict60/p60.sqlite3')

    def test_list_docker_does_not_stop_or_reset(self):
        info = {'Name': '/p60-local', 'Id': 'container-id', 'Image': 'sha256:image',
                'Config': {'Env': ['PREDICT60_DB=/app/data/live.sqlite3'], 'User': '10001',
                           'WorkingDir': '/app', 'Labels': {}}}
        with patch.object(reset, 'output', return_value=json.dumps([info])), \
                patch.object(reset.subprocess, 'run') as run:
            reset.reset_docker(Namespace(container='p60-local', db=None), command_name='usernames')
            run.assert_called_once()
            command = run.call_args.args[0]
            self.assertEqual(command[:2], ['docker', 'run'])
            self.assertEqual(command[-1], 'usernames')
            self.assertNotIn('--confirm-reset', command)
            self.assertIn('PREDICT60_DB=/app/data/live.sqlite3', command)

    def test_ambiguous_docker_selection_does_not_stop_anything(self):
        with patch.object(reset, 'output', return_value=''), patch.object(reset.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Expected one'):
                reset.reset_docker(Namespace(container=None, db=None))
            run.assert_not_called()
