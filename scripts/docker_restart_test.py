"""Exercise restart ordering and build failure without a Docker daemon."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class DockerRestartTest(unittest.TestCase):
    def run_restart(self, fail_build=False, local=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            shutil.copy2(Path(__file__).with_name('restart-docker.sh'), root / 'scripts')
            (root / '.env').write_text('P60_DOMAIN=example.test\n')
            (root / '.env.local').write_text('P60_SIGNUP_CODE=test\n')
            docker = root / 'docker'
            docker.write_text('''#!/usr/bin/env python3
import os, sys
with open(os.environ['DOCKER_TEST_LOG'], 'a') as log:
    log.write(' '.join(sys.argv[1:]) + '\\n')
if 'build' in sys.argv and os.environ.get('DOCKER_TEST_FAIL') == '1':
    sys.exit(1)
''')
            docker.chmod(0o755)
            log = root / 'calls'
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       DOCKER_TEST_LOG=str(log), DOCKER_TEST_FAIL=str(int(fail_build)))
            result = subprocess.run(['bash', str(root / 'scripts/restart-docker.sh'),
                                     *(['--local'] if local else [])], env=env,
                                    capture_output=True, text=True, timeout=10)
            return result, log.read_text().splitlines()

    def test_failed_build_leaves_running_services_untouched(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(fail_build=True, local=local)
                self.assertNotEqual(result.returncode, 0)
                for call in calls:
                    self.assertFalse(set(call.split()) & {'down', 'stop', 'rm', 'up', 'run'})

    def test_vps_builds_before_recreating_without_tearing_down_proxy(self):
        result, calls = self.run_restart()
        self.assertEqual(result.returncode, 0, result.stderr)
        build = next(i for i, call in enumerate(calls) if 'build app' in call)
        up = next(i for i, call in enumerate(calls) if 'up -d' in call)
        self.assertLess(build, up)
        self.assertIn('--no-build --wait', calls[up])
        self.assertFalse(any('down' in call.split() for call in calls))

    def test_local_container_has_bounded_logs_and_read_only_root(self):
        result, calls = self.run_restart(local=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        run = next(call for call in calls if call.startswith('run '))
        for flag in ('--read-only', '--tmpfs /tmp:size=64m', '--log-driver local',
                     '--log-opt max-size=10m', '--log-opt max-file=5',
                     '--cap-drop ALL', '--security-opt no-new-privileges:true'):
            self.assertIn(flag, run)
