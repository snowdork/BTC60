#!/usr/bin/env python3
"""Restart this checkout's Predict60 server with a background watchdog on Linux."""
import argparse
import os
from pathlib import Path
import fcntl
import subprocess
import sys
import time
import urllib.request

from server_control import ROOT, DATA, STOP, stop_server

sys.path.insert(0, str(ROOT))
from p60_logging import LOG_PATH, write_or_rotate


def main():
    """Validate restart options and serialize checkout lifecycle changes under the control lock."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--log-level', choices=('normal', 'debug', 'warning', 'error'), default=None,
                        help='Use this level; otherwise reuse the last successful start (initially normal)')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    if not Path('/proc/self/cmdline').exists():
        parser.error('This restart script requires Linux /proc.')

    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / 'server-control.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        level_file = DATA / 'server-log-level'
        if args.log_level is None:
            args.log_level = level_file.read_text().strip() if level_file.exists() else 'normal'
            if args.log_level not in ('normal', 'debug', 'warning', 'error'):
                parser.error('Saved log level is invalid; specify --log-level explicitly.')
        start_server(args)
        fd = os.open(level_file, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(args.log_level + '\n')


def start_server(args):
    """Stop checkout processes, import legacy logs, and launch the watchdog with the requested configuration."""
    stop_server()
    # Import the old log only after its writers have stopped.
    legacy_log = DATA / 'server.log'
    if legacy_log.exists() and legacy_log.resolve() != LOG_PATH.resolve():
        with legacy_log.open(errors='replace') as stream:
            for line in stream:
                write_or_rotate(line.rstrip('\n'))
        legacy_log.unlink()
    STOP.unlink(missing_ok=True)

    log_path = LOG_PATH
    process = subprocess.Popen(
        [sys.executable, '-u', str(ROOT / 'scripts' / 'watchdog-server.py'),
         '--port', str(args.port), '--log-level', args.log_level],
        cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True,
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
                        print(f'Server running with watchdog (PID {process.pid}): {address}/index.html')
                        print(f'Log: {log_path}')
                        return
        except OSError:
            pass
        time.sleep(0.1)
    stop_server()
    raise SystemExit(f'Server readiness timed out. See {log_path}')


if __name__ == '__main__':
    main()
