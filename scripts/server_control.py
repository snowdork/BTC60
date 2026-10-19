"""Shared Linux process discovery and shutdown for this checkout."""
import os
from pathlib import Path
import signal
import time

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
STOP = DATA / 'server.stopped'


def project_processes(script_name):
    """Yield Python process IDs whose resolved script path belongs to this checkout."""
    expected_suffix = Path(script_name).parts
    # Resolve executable, script, and cwd paths so unrelated Python processes are never selected.
    # The cwd check also recognizes this checkout's processes after its directory is renamed:
    # Linux updates /proc/<pid>/cwd, while the already-started argv keeps the old absolute path.
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            args = (entry / 'cmdline').read_bytes().split(b'\0')
            if not args or not Path(os.fsdecode(args[0])).name.startswith('python'):
                continue
            index = 2 if len(args) > 1 and args[1] == b'-u' else 1
            script = Path(os.fsdecode(args[index]))
            if not script.is_absolute():
                script = (entry / 'cwd').resolve() / script
            script_matches = script.resolve() == ROOT / script_name
            renamed_checkout_matches = (
                (entry / 'cwd').resolve() == ROOT
                and script.parts[-len(expected_suffix):] == expected_suffix
            )
            if script_matches or renamed_checkout_matches:
                yield int(entry.name)
        except (OSError, IndexError, ValueError):
            continue


def stop_server():
    """Disable supervision and terminate checkout processes, waiting up to fifteen seconds for shutdown."""
    DATA.mkdir(parents=True, exist_ok=True)
    STOP.touch(mode=0o600)
    # Disable supervision before stopping its child, including during retry delays.
    for script in ('scripts/watchdog-server.py', 'server.py'):
        for pid in project_processes(script):
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 15
    # Wait for both supervisor and child to exit, but keep a bounded shutdown deadline.
    while any(list(project_processes(script)) for script in
              ('scripts/watchdog-server.py', 'server.py')):
        if time.monotonic() >= deadline:
            raise SystemExit('Predict60 did not stop within 15 seconds; stop marker retained.')
        time.sleep(0.1)
