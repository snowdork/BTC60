"""Exercise restart-only defaults and explicit recreation without a Docker daemon."""
import os
import fcntl
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class DockerRestartTest(unittest.TestCase):
    def run_restart(self, fail_build=False, local=False, service_present=True, fail_stop=False,
                    published_ports='', local_port='8085', start=False, args=(), lock_held=False,
                    container_present=True, fail_restart=False, fail_health=False, local_env=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'deploy').mkdir()
            shutil.copy2((Path(__file__).resolve().parents[2] / 'scripts/restart-docker.sh'), root / 'scripts')
            shutil.copy2((Path(__file__).resolve().parents[2] / 'deploy/start-docker.sh'), root / 'deploy')
            (root / '.env').write_text('P60_DOMAIN=example.test\n')
            if local_env:
                (root / '.env.local').write_text(f'P60_SIGNUP_CODE=test\nP60_PORT={local_port}\n')
            docker = root / 'docker'
            docker.write_text('''#!/usr/bin/env python3
import os, sys
with open(os.environ['DOCKER_TEST_LOG'], 'a') as log:
    log.write(' '.join(sys.argv[1:]) + '\\n')
if 'build' in sys.argv and os.environ.get('DOCKER_TEST_FAIL') == '1':
    sys.exit(1)
if sys.argv[1:3] == ['container', 'inspect']:
    sys.exit(0 if os.environ['CONTAINER_PRESENT'] == '1' else 1)
if 'ps' in sys.argv and '--quiet' in sys.argv and os.environ['CONTAINER_PRESENT'] == '1':
    print('existing-app')
if 'restart' in sys.argv and os.environ['RESTART_FAIL'] == '1':
    sys.exit(1)
if 'exec' in sys.argv and os.environ['HEALTH_FAIL'] == '1':
    sys.exit(1)
if sys.argv[1] == 'ps' and '--format' in sys.argv:
    print(os.environ['PUBLISHED_PORTS'])
''')
            docker.chmod(0o755)
            systemctl = root / 'systemctl'
            systemctl.write_text('''#!/usr/bin/env python3
import os, sys
with open(os.environ['DOCKER_TEST_LOG'], 'a') as log:
    log.write('systemctl ' + ' '.join(sys.argv[1:]) + '\\n')
if sys.argv[1] == 'show':
    print('loaded' if os.environ['SERVICE_PRESENT'] == '1' else 'not-found')
if sys.argv[1] == 'stop' and os.environ['SERVICE_STOP_FAIL'] == '1':
    sys.exit(1)
''')
            systemctl.chmod(0o755)
            sleep = root / 'sleep'
            sleep.write_text('#!/bin/sh\nexit 0\n')
            sleep.chmod(0o755)
            log = root / 'calls'
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       DOCKER_TEST_LOG=str(log), DOCKER_TEST_FAIL=str(int(fail_build)),
                       SERVICE_PRESENT=str(int(service_present)), SERVICE_STOP_FAIL=str(int(fail_stop)),
                       PUBLISHED_PORTS=published_ports, CONTAINER_PRESENT=str(int(container_present)),
                       RESTART_FAIL=str(int(fail_restart)), HEALTH_FAIL=str(int(fail_health)))
            env.pop('P60_PORT', None)
            entrypoint = root / ('deploy/start-docker.sh' if start else 'scripts/restart-docker.sh')
            with (root / '.docker-restart.lock').open('w') as lock:
                if lock_held:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = subprocess.run(['bash', str(entrypoint),
                                         *(['--local'] if local else []), *args], env=env,
                                        capture_output=True, text=True, timeout=10)
            return result, log.read_text().splitlines() if log.exists() else []

    def test_overlapping_restart_exits_before_any_docker_or_service_calls(self):
        for local in (False, True):
            for start in (False, True):
                with self.subTest(local=local, start=start):
                    result, calls = self.run_restart(local=local, start=start, lock_held=True)
                    self.assertEqual(result.returncode, 75, result.stderr)
                    self.assertIn('already running', result.stderr)
                    self.assertEqual(calls, [])

    def test_failed_build_leaves_running_services_untouched(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(fail_build=True, local=local, args=('--recreate',))
                self.assertNotEqual(result.returncode, 0)
                for call in calls:
                    self.assertFalse(set(call.split()) & {'down', 'stop', 'rm', 'up', 'run'})

    def test_vps_recreate_builds_before_forced_replacement_without_tearing_down_proxy(self):
        result, calls = self.run_restart(args=('--recreate',))
        self.assertEqual(result.returncode, 0, result.stderr)
        build = next(i for i, call in enumerate(calls) if 'build app' in call)
        up = next(i for i, call in enumerate(calls) if 'up -d' in call)
        self.assertLess(build, up)
        self.assertIn('--no-build --no-deps --force-recreate --wait', calls[up])
        self.assertTrue(calls[up].endswith(' app'))
        self.assertFalse(any('down' in call.split() for call in calls))

    def test_default_restarts_existing_containers_without_building_or_recreating(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(local=local, fail_build=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                restart = next(i for i, call in enumerate(calls) if 'restart' in call.split())
                self.assertIn('restart --time 30 p60-local' if local else 'restart --timeout 30 app', calls[restart])
                self.assertLess(calls.index('systemctl stop predict60.service'), restart)
                self.assertTrue(any('exec' in call.split() for call in calls[restart + 1:]))
                self.assertFalse(any(set(call.split()) & {'build', 'rm', 'up', 'run', 'down', '--force-recreate'} for call in calls))

    def test_missing_container_requires_recreate_before_stopping_host_service(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(local=local, container_present=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('--recreate', result.stderr)
                self.assertFalse(any(set(call.split()) & {'systemctl', 'build', 'restart', 'rm', 'up', 'run'} for call in calls))

    def test_recreate_and_initial_start_can_create_a_missing_container(self):
        for local in (False, True):
            for start in (False, True):
                with self.subTest(local=local, start=start):
                    result, calls = self.run_restart(local=local, start=start, container_present=False,
                                                     args=() if start else ('--recreate',))
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertTrue(any('build' in call.split() for call in calls))
                    self.assertTrue(any(('run' if local else 'up') in call.split() for call in calls))

    def test_local_restart_uses_existing_configuration(self):
        for options in ({'local_env': False}, {'local_port': 'not-a-port'},
                        {'local_port': '18085', 'published_ports': 'other|127.0.0.1:18085->8000/tcp'}):
            with self.subTest(options=options):
                result, calls = self.run_restart(local=True, **options)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('restart --time 30 p60-local', calls)
                self.assertFalse(any(call.startswith('ps ') for call in calls))

    def test_restart_failure_does_not_fall_back_to_recreation(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(local=local, fail_restart=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(set(call.split()) & {'build', 'rm', 'up', 'run', 'exec'} for call in calls))

    def test_restart_reports_failed_health_without_recreating(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(local=local, fail_health=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('did not become ready', result.stderr)
                self.assertEqual(sum('exec' in call.split() for call in calls), 30)
                self.assertFalse(any(set(call.split()) & {'build', 'rm', 'up', 'run'} for call in calls))

    def test_unknown_flag_fails_before_docker_or_service_changes(self):
        result, calls = self.run_restart(args=('--unknown',))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[--local]', result.stderr)
        self.assertEqual(calls, [])

    def test_local_container_has_bounded_logs_and_read_only_root(self):
        result, calls = self.run_restart(local=True, args=('--recreate',))
        self.assertEqual(result.returncode, 0, result.stderr)
        run = next(call for call in calls if call.startswith('run '))
        for flag in ('--read-only', '--tmpfs /tmp:size=64m', '--log-driver local',
                     '--log-opt max-size=10m', '--log-opt max-file=5',
                     '--cap-drop ALL', '--security-opt no-new-privileges:true'):
            self.assertIn(flag, run)
        self.assertTrue(run.endswith(' p60:local-dev'))
        self.assertIn('build -t p60:local-dev .', calls)
        self.assertLess(calls.index('build -t p60:local-dev .'), calls.index('stop p60-local'))
        self.assertLess(calls.index('stop p60-local'), calls.index('rm p60-local'))
        self.assertLess(calls.index('rm p60-local'), calls.index(run))

    def test_local_port_conflict_fails_before_build_or_service_changes(self):
        result, calls = self.run_restart(local=True, published_ports='p60-app-1|127.0.0.1:8085->8000/tcp', args=('--recreate',))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('P60_PORT', result.stderr)
        self.assertIn('p60-app-1', result.stderr)
        self.assertFalse(any(set(call.split()) & {'build', 'stop', 'rm', 'run'} for call in calls))

    def test_existing_local_container_and_a_different_host_port_do_not_conflict(self):
        for ports in ('p60-local|127.0.0.1:8085->8000/tcp', 'other|127.0.0.1:18085->8085/tcp'):
            with self.subTest(ports=ports):
                result, _ = self.run_restart(local=True, published_ports=ports, args=('--recreate',))
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_local_custom_port_sets_binding_and_google_origin_together(self):
        result, calls = self.run_restart(local=True, local_port='18085', args=('--recreate',))
        self.assertEqual(result.returncode, 0, result.stderr)
        run = next(call for call in calls if call.startswith('run '))
        self.assertIn('127.0.0.1:18085:8000', run)
        self.assertIn('P60_HOST=http://localhost:18085', run)

    def test_initial_start_and_restart_follow_the_same_build_failure_rules(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(local=local, start=True, fail_build=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(set(call.split()) & {'stop', 'rm', 'run', 'up'} for call in calls))

    def test_host_service_stops_after_build_before_docker_replacement(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(local=local, args=('--recreate',))
                self.assertEqual(result.returncode, 0, result.stderr)
                build = next(i for i, call in enumerate(calls) if 'build' in call.split())
                stop = calls.index('systemctl stop predict60.service')
                replacement = next(i for i, call in enumerate(calls) if set(call.split()) & {'up', 'run', 'rm'})
                self.assertLess(build, stop)
                self.assertLess(stop, replacement)

    def test_missing_host_service_does_not_block_docker(self):
        for local in (False, True):
            with self.subTest(local=local):
                result, calls = self.run_restart(local=local, service_present=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('systemctl stop predict60.service', calls)

    def test_failed_service_stop_prevents_docker_replacement(self):
        for local in (False, True):
            for args in ((), ('--recreate',)):
                with self.subTest(local=local, args=args):
                    result, calls = self.run_restart(local=local, fail_stop=True, args=args)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('systemctl stop predict60.service', calls)
                    self.assertFalse(any(set(call.split()) & {'restart', 'up', 'run', 'rm'} for call in calls))
                    self.assertIn('sudo', result.stderr)
