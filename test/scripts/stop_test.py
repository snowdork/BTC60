"""Check combined shutdown without touching running services."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class StopTest(unittest.TestCase):
    def run_stop(self, service='loaded', docker_fail=False, service_fail=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copy2(Path(__file__).resolve().parents[2] / 'scripts/stop.sh', root)
            for name, body in {
                'stop-docker.sh': 'echo docker >> "$CALLS"\nexit "$DOCKER_FAIL"',
                'stop-server.sh': 'echo watchdog >> "$CALLS"',
                'systemctl': '''if [[ $1 == show ]]; then
  echo "$SERVICE"
else
  echo service >> "$CALLS"
  exit "$SERVICE_FAIL"
fi''',
            }.items():
                script = root / name
                script.write_text('#!/usr/bin/env bash\n' + body + '\n')
                script.chmod(0o755)
            calls = root / 'calls'
            result = subprocess.run(['bash', str(root / 'stop.sh')], cwd='/',
                                    env={**os.environ, 'PATH': str(root) + ':' + os.environ['PATH'],
                                         'CALLS': str(calls), 'SERVICE': service,
                                         'DOCKER_FAIL': str(int(docker_fail)),
                                         'SERVICE_FAIL': str(int(service_fail))},
                                    capture_output=True, text=True, timeout=10)
            return result, calls.read_text().splitlines()

    def test_stops_all_runtimes_from_any_directory(self):
        result, calls = self.run_stop()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['docker', 'service', 'watchdog'])

    def test_missing_service(self):
        result, calls = self.run_stop(service='not-found')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['docker', 'watchdog'])

    def test_failures_do_not_skip_other_runtimes(self):
        for docker_fail, service_fail in [(True, False), (False, True), (True, True)]:
            with self.subTest(docker_fail=docker_fail, service_fail=service_fail):
                result, calls = self.run_stop(docker_fail=docker_fail, service_fail=service_fail)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, ['docker', 'service', 'watchdog'])
                self.assertIn('shutdown incomplete', result.stderr)
