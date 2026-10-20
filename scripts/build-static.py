"""Refresh the static hosting directory from the server's public file list.

Run from any directory: python3 scripts/build-static.py
This copies frontend files and artwork only; it never copies account data or keys.
"""
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import PUBLIC_ASSETS, PUBLIC_FILES


def main():
    """Stage public files before refreshing output and removing obsolete build artifacts."""
    destination = ROOT / 'dist'
    public = PUBLIC_FILES | PUBLIC_ASSETS | {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / 'assets' / 'coins').glob('*.svg')
        if path.is_file()
    }
    # A missing source must not destroy the last successful build.
    with tempfile.TemporaryDirectory(prefix='p60-static-') as directory:
        staging = Path(directory)
        for name in sorted(public):
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        destination.mkdir(exist_ok=True)
        shutil.copytree(staging, destination, dirs_exist_ok=True)
        for path in sorted(destination.rglob('*'), reverse=True):
            if path.is_file() and path.relative_to(destination).as_posix() not in public:
                path.unlink()
            elif path.is_dir() and not any(path.iterdir()):
                path.rmdir()
    print(f'Static frontend refreshed in {destination}')


if __name__ == '__main__':
    main()
