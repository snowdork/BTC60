"""One locked writer and rotation policy shared by the watchdog and rotation tool."""
import fcntl
import logging
import os
from pathlib import Path

LOG_DIR = Path(os.environ.get('BTC60_LOG_DIR', '/tmp/btc60'))
LOG_PATH = LOG_DIR / 'server.log'
MAX_BYTES = 10 * 1024 * 1024
BACKUPS = 5


def _rotate(path):
    for index in range(BACKUPS, 0, -1):
        source = path if index == 1 else path.with_name(f'{path.name}.{index - 1}')
        target = path.with_name(f'{path.name}.{index}')
        if source.exists():
            source.replace(target)


def write_or_rotate(message=None, force=False):
    LOG_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(LOG_DIR / 'rotation.lock', os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        size = LOG_PATH.stat().st_size if LOG_PATH.exists() else 0
        payload = (message + '\n').encode('utf-8', errors='replace') if message is not None else b''
        if size and (force or size + len(payload) > MAX_BYTES):
            _rotate(LOG_PATH)
        if message is not None:
            fd = os.open(LOG_PATH, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
            with os.fdopen(fd, 'ab') as stream:
                stream.write(payload)


class PolicyHandler(logging.Handler):
    def emit(self, record):
        try:
            write_or_rotate(self.format(record))
        except Exception:
            self.handleError(record)


def configure(level='normal', file=False):
    handler = PolicyHandler() if file else logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    logging.basicConfig(level={'normal': logging.INFO, 'debug': logging.DEBUG,
                              'warning': logging.WARNING, 'error': logging.ERROR}[level],
                        handlers=[handler], force=True)
