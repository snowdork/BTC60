#!/usr/bin/env python3
"""Stop this checkout's server and watchdog, preventing automatic restarts."""
import fcntl
from server_control import DATA, stop_server


def main():
    """Stop the checkout server and watchdog intentionally, preserving the stop marker."""
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / 'server-control.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        stop_server()
    print('BTC60 server and watchdog stopped. Run scripts/restart-server.py to start again.')


if __name__ == '__main__':
    main()
