"""Exercise watchdog lifecycle in an isolated checkout with a tiny HTTP server."""
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest


class WatchdogTest(unittest.TestCase):
    def test_crash_restart_and_intentional_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'checkout'
            root.mkdir()
            scripts = root / 'scripts'
            scripts.mkdir()
            # Keep lifecycle tests isolated from real Docker containers and permissions.
            docker = scripts / 'docker'
            docker.write_text('#!/bin/sh\nexit 0\n')
            docker.chmod(0o755)
            (root / 'src/backend').mkdir(parents=True)
            for name in ('server_control.py', 'docker_control.py', 'restart-server.py', 'stop-server.sh',
                         'watchdog-server.py'):
                shutil.copy(Path(__file__).resolve().parents[2] / 'scripts' / name, scripts / name)
            (root / 'src/backend/server.py').write_text('''import argparse, os
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
p = argparse.ArgumentParser()
p.add_argument('--port', type=int)
a = p.parse_args()
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
    def log_message(self, *args): pass
server = HTTPServer(('127.0.0.1', a.port), Handler)
Path('level').write_text(os.environ['PREDICT60_LOG_LEVEL'])
with Path('starts').open('a') as f: f.write(str(os.getpid()) + '\\n')
server.serve_forever()
''')
            shutil.copy(Path(__file__).resolve().parents[2] / 'src/backend/p60_logging.py', root / 'src/backend/p60_logging.py')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]

            def run(name, *args):
                return subprocess.run([('bash' if name.endswith('.sh') else sys.executable), str(scripts / name), *args],
                                      capture_output=True, text=True, timeout=25,
                                      env={**os.environ, 'PREDICT60_LOG_DIR': str(root / 'logs'),
                                           'PATH': str(scripts) + os.pathsep + os.environ['PATH']})

            def starts():
                return (root / 'starts').read_text().splitlines()

            try:
                result = run('restart-server.py', '--port', str(port))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((root / 'level').read_text(), 'normal')
                self.assertTrue((root / 'logs/server.log').exists())
                self.assertFalse((root / 'data/server.log').exists())
                # Restart must still find processes whose argv retained the pre-rename path.
                renamed_root = root.with_name('renamed-checkout')
                root.rename(renamed_root)
                root = renamed_root
                scripts = root / 'scripts'
                result = run('restart-server.py', '--port', str(port))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(starts()), 2)
                os.kill(int(starts()[-1]), signal.SIGKILL)
                deadline = time.monotonic() + 8
                while len(starts()) < 3 and time.monotonic() < deadline:
                    time.sleep(0.1)
                self.assertEqual(len(starts()), 3)
                self.assertEqual((root / 'level').read_text(), 'normal')
                result = run('stop-server.sh')
                self.assertEqual(result.returncode, 0, result.stderr)
                time.sleep(3.5)
                self.assertEqual(len(starts()), 3)
                self.assertTrue((root / 'data/server.stopped').exists())
                self.assertEqual(run('stop-server.sh').returncode, 0)
                self.assertEqual(run('restart-server.py', '--port', str(port),
                                     '--log-level', 'debug').returncode, 0)
                self.assertEqual((root / 'level').read_text(), 'debug')
                self.assertEqual(len(starts()), 4)
                # A crash must retain an explicitly selected debug level.
                os.kill(int(starts()[-1]), signal.SIGKILL)
                deadline = time.monotonic() + 8
                while len(starts()) < 5 and time.monotonic() < deadline:
                    time.sleep(0.1)
                self.assertEqual(len(starts()), 5)
                self.assertEqual((root / 'level').read_text(), 'debug')
                # A manual restart without a level retains the previous selection.
                self.assertEqual(run('restart-server.py', '--port', str(port)).returncode, 0)
                self.assertEqual((root / 'level').read_text(), 'debug')
                self.assertEqual(len(starts()), 6)
                # Stop while the watchdog is waiting to restart a crashed child.
                os.kill(int(starts()[-1]), signal.SIGKILL)
                self.assertEqual(run('stop-server.sh').returncode, 0)
                time.sleep(3.5)
                self.assertEqual(len(starts()), 6)
            finally:
                run('stop-server.sh')


if __name__ == '__main__':
    unittest.main()
