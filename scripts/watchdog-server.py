#!/usr/bin/env python3
"""Supervise Predict60; use restart-server.py to start and stop-server.sh to stop."""
import argparse
import fcntl
import logging
import os
import signal
import subprocess
import sys
import threading
from server_control import DATA, ROOT, STOP

sys.path.insert(0, str(ROOT / 'src/backend'))
from p60_logging import configure, write_or_rotate


def main():
    """Supervise the child server and restart unexpected exits until an intentional stop is requested."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--log-level', choices=('normal', 'debug', 'warning', 'error'), default='normal')
    args = parser.parse_args()
    configure(args.log_level, file=True)
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    DATA.mkdir(parents=True, exist_ok=True)
    stopped = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    with (DATA / 'server-watchdog.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('A Predict60 watchdog is already running.')
        logging.info('Watchdog started; log level=%s', args.log_level)
        while not stopped.is_set() and not STOP.exists():
            child = subprocess.Popen(
                [sys.executable, '-u', str(ROOT / 'src/backend/server.py'), '--port', str(args.port)],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, errors='replace',
                # Apply the original selection to every replacement child.
                env={**os.environ, 'PREDICT60_LOG_LEVEL': args.log_level},
            )
            def capture_output(stream):
                """Forward supervised child output to the shared rotating log until its stream closes."""
                with stream:
                    for line in stream:
                        # Child records already include their severity and timestamp.
                        write_or_rotate(line.rstrip('\n'))

            reader = threading.Thread(target=capture_output, args=(child.stdout,), daemon=True)
            reader.start()
            logging.info('Watchdog started server PID %s', child.pid)
            try:
                while child.poll() is None:
                    if stopped.wait(0.2) or STOP.exists():
                        break
            finally:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
            reader.join(timeout=5)
            if stopped.is_set() or STOP.exists():
                break
            logging.warning('Server exited (%s); restarting in 3 seconds.', child.returncode)
            stopped.wait(3)
        logging.info('Watchdog stopped; automatic restarts disabled')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        logging.exception('Watchdog failed')
        raise
