#!/usr/bin/env python3
"""Restart this checkout's BTC60 server on Linux, leaving it in the background."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def project_servers():
    """Match the actual script path, including servers started with relative paths."""
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            args = (entry / 'cmdline').read_bytes().split(b'\0')
            if not args or not Path(os.fsdecode(args[0])).name.startswith('python'):
                continue
            # server.py must be the Python script, not text in a -c command.
            index = 2 if len(args) > 1 and args[1] == b'-u' else 1
            script = Path(os.fsdecode(args[index]))
            if not script.is_absolute():
                script = (entry / 'cwd').resolve() / script
            if script.resolve() == ROOT / 'server.py':
                yield int(entry.name)
        except (OSError, IndexError, ValueError):
            continue


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    if not Path('/proc/self/cmdline').exists():
        parser.error('This restart script requires Linux /proc.')

    for pid in project_servers():
        print(f'Stopping BTC60 server (PID {pid})…', flush=True)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
    deadline = time.monotonic() + 10
    while list(project_servers()):
        if time.monotonic() >= deadline:
            raise SystemExit('Server did not stop within 10 seconds; restart cancelled.')
        time.sleep(0.1)

    log_path = ROOT / 'data' / 'server.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, 'ab') as log:
        process = subprocess.Popen(
            [sys.executable, '-u', str(ROOT / 'server.py'), '--port', str(args.port)],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            start_new_session=True,
        )
    address = f'http://127.0.0.1:{args.port}'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SystemExit(f'Server exited with status {process.returncode}. See {log_path}')
        try:
            with opener.open(address + '/api/coins', timeout=1) as response:
                if response.status == 200:
                    # Allow immediate startup failures to surface before reporting success.
                    time.sleep(0.1)
                    if process.poll() is None:
                        print(f'Server running (PID {process.pid}): {address}/index.html')
                        print(f'Log: {log_path}')
                        return
        except OSError:
            pass
        time.sleep(0.1)
    process.terminate()
    process.wait(timeout=5)
    raise SystemExit(f'Server readiness timed out. See {log_path}')


if __name__ == '__main__':
    main()
