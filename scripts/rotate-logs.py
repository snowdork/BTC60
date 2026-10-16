#!/usr/bin/env python3
"""Apply Predict60's 10 MiB / five-backup log policy; --force rotates immediately."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from btc60_logging import BACKUPS, LOG_PATH, MAX_BYTES, write_or_rotate


def main():
    """Parse rotation options and apply the shared log retention policy."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    write_or_rotate(force=args.force)
    print(f'Rotation policy applied: {LOG_PATH}, {MAX_BYTES} bytes, {BACKUPS} backups.')


if __name__ == '__main__':
    main()
