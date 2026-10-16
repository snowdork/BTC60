"""One locked writer and rotation policy shared by the watchdog and rotation tool."""
import fcntl
import logging
import os
from pathlib import Path

LOG_DIR = Path(os.environ.get('PREDICT60_LOG_DIR') or os.environ.get('BTC60_LOG_DIR', '/tmp/btc60'))
LOG_PATH = LOG_DIR / 'server.log'
MAX_BYTES = 10 * 1024 * 1024
BACKUPS = 5


def _rotate(path):
    """Move numbered log backups from oldest to newest so source files are not overwritten prematurely."""
    # Move oldest backups first so a later rename cannot overwrite its source.
    for index in range(BACKUPS, 0, -1):
        source = path if index == 1 else path.with_name(f'{path.name}.{index - 1}')
        target = path.with_name(f'{path.name}.{index}')
        if source.exists():
            source.replace(target)


def write_or_rotate(message=None, force=False):
    """Append a UTF-8 log record or rotate under a shared filesystem lock with private file permissions."""
    LOG_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(LOG_DIR / 'rotation.lock', os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        size = LOG_PATH.stat().st_size if LOG_PATH.exists() else 0
        payload = (message + '\n').encode('utf-8', errors='replace') if message is not None else b''
        # Rotate before appending so a complete record stays in one log file.
        if size and (force or size + len(payload) > MAX_BYTES):
            _rotate(LOG_PATH)
        if message is not None:
            fd = os.open(LOG_PATH, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
            with os.fdopen(fd, 'ab') as stream:
                stream.write(payload)


class PolicyHandler(logging.Handler):
    """Adapt standard Python logging records to the shared locked rotation policy."""
    def emit(self, record):
        """Format and append a log record, delegating write failures to the logging error handler."""
        try:
            write_or_rotate(self.format(record))
        except Exception:
            self.handleError(record)


def configure(level='normal', file=False):
    """Replace root logging handlers with the selected level and console or rotating-file destination."""
    handler = PolicyHandler() if file else logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    logging.basicConfig(level={'normal': logging.INFO, 'debug': logging.DEBUG,
                              'warning': logging.WARNING, 'error': logging.ERROR}[level],
                        handlers=[handler], force=True)
