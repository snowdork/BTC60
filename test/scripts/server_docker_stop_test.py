"""Verify Docker shutdown gates host startup without requiring a Docker daemon."""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
spec = importlib.util.spec_from_file_location(
    'restart_server', Path(__file__).resolve().parents[2] / 'scripts/restart-server.py')
restart = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restart)


class ServerDockerStopTest(unittest.TestCase):
    def test_docker_not_installed(self):
        with patch.object(restart.shutil, 'which', return_value=None), \
                patch.object(restart.subprocess, 'run') as run:
            restart.stop_docker()
            run.assert_not_called()

    def test_stops_only_matching_containers_and_deduplicates(self):
        results = [Mock(stdout='local\n'), Mock(stdout='app\nproxy\n'),
                   Mock(stdout='local\n'), Mock()]
        with patch.object(restart.shutil, 'which', return_value='/bin/docker'), \
                patch.object(restart.subprocess, 'run', side_effect=results) as run:
            restart.stop_docker()
            self.assertEqual([call.args[0][-1] for call in run.call_args_list[:3]], [
                'name=^/p60-local$', 'label=com.docker.compose.project=p60',
                'label=com.docker.compose.project=p60-local'])
            self.assertEqual(run.call_args.args[0],
                             ['docker', 'stop', '--time', '30', 'app', 'local', 'proxy'])

    def test_no_running_containers(self):
        with patch.object(restart.shutil, 'which', return_value='/bin/docker'), \
                patch.object(restart.subprocess, 'run', return_value=Mock(stdout='')) as run:
            restart.stop_docker()
            self.assertEqual(run.call_count, 3)

    def test_query_or_stop_failure_prevents_host_restart(self):
        for fail_at in range(4):
            results = [Mock(stdout='app\n') for _ in range(fail_at)]
            results.append(subprocess.CalledProcessError(1, 'docker'))
            with self.subTest(fail_at=fail_at), \
                    patch.object(restart.shutil, 'which', return_value='/bin/docker'), \
                    patch.object(restart.subprocess, 'run', side_effect=results), \
                    patch.object(restart, 'stop_server') as stop, \
                    patch.object(restart.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(SystemExit, 'host server was not started'):
                    restart.start_server(argparse.Namespace(port=8000, log_level='normal'))
                stop.assert_not_called()
                launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
