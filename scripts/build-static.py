"""Refresh the static hosting directory from the server's public file list.

Run from any directory: python3 scripts/build-static.py
This copies frontend files and artwork only; it never copies account data or keys.
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import PUBLIC_FILES


def main():
    """Copy allowlisted frontend files and artwork into the static hosting directory."""
    destination = ROOT / 'dist'
    destination.mkdir(exist_ok=True)
    # Use the server allowlist rather than copying repository contents or credentials.
    for name in sorted(PUBLIC_FILES):
        shutil.copy2(ROOT / name, destination / name)
    for folder in ('coins', 'previews', 'backgrounds'):
        source = ROOT / 'assets' / folder
        target = destination / 'assets' / folder
        target.mkdir(parents=True, exist_ok=True)
        for asset in source.iterdir():
            if asset.is_file() and asset.suffix in {'.svg', '.png', '.webp'}:
                shutil.copy2(asset, target / asset.name)
    print(f'Static frontend refreshed in {destination}')


if __name__ == '__main__':
    main()
