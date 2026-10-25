#!/usr/bin/env python3
"""Predict60 SQLite maintenance. Run with --help for commands."""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import fcntl
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src/backend'))
import server


@contextmanager
def maintenance_lock(path):
    """Acquire an exclusive nonblocking database maintenance lock for the duration of the context."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path) + '.lock', 'a') as lock:
        os.chmod(lock.name, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('The Predict60 server or another maintenance command is running. Stop it before init/reset.')
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def readonly(path):
    """Open an existing SQLite database in read-only mode for inspection or backup."""
    if not path.is_file():
        raise ValueError(f'Database does not exist: {path}. Run init first.')
    return sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)


def backup(path, directory=None):
    """Create a consistent SQLite backup with private permissions without modifying the source database."""
    directory = directory or path.parent / 'backups'
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    target = directory / f'{path.stem}-{stamp}-{secrets.token_hex(3)}.sqlite3'
    # SQLite's backup API includes committed WAL data, unlike copying the file.
    with closing(readonly(path)) as source:
        with closing(sqlite3.connect(target)) as destination:
            os.chmod(target, 0o600)
            source.backup(destination)
            if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Backup integrity check failed; reset was not performed.')
    return target


def status(path):
    """Print database integrity, table counts, and enabled instruments for administrator inspection."""
    with closing(readonly(path)) as conn:
        integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
        print(f'Database: {path}\nIntegrity: {integrity}')
        for table in ['users', 'sessions', 'categories', 'coins', 'instrument_sources', 'predictions', 'prediction_sources', 'settlements']:
            print(f'{table}: {conn.execute("SELECT count(*) FROM " + table).fetchone()[0]}')
        for category, count in conn.execute('SELECT category,count(*) FROM coins WHERE enabled=1 GROUP BY category ORDER BY category'):
            print(f'Enabled {category} instruments: {count} / 10')
        if integrity != 'ok' or conn.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Database integrity or foreign-key check failed.')


def list_usernames(path):
    """Print display names only, using a read-only connection."""
    with closing(readonly(path)) as conn:
        for (name,) in conn.execute('SELECT name FROM users ORDER BY name COLLATE NOCASE, id'):
            # Keep each stored name on one output line, including unusual input.
            print(str(name).replace('\r', r'\r').replace('\n', r'\n'))


def reset(path):
    """Back up the database before clearing account state and restoring seeded catalogs."""
    with maintenance_lock(path):
        if not path.is_file():
            raise ValueError(f'Database does not exist: {path}. Use --db to select the deployed database, or init to create one.')
        print(f'Resetting database: {path}', flush=True)
        # Build and validate the replacement before touching the existing database.
        with tempfile.TemporaryDirectory(prefix='p60-reset-', dir=path.parent) as folder:
            original = server.DB
            fresh = Path(folder) / 'fresh.sqlite3'
            try:
                server.DB = fresh
                server.initialize()
            finally:
                server.DB = original
            if path.exists():
                saved = backup(path)
                print(f'Backup saved: {saved}')
            with closing(sqlite3.connect(fresh)) as source, closing(sqlite3.connect(path)) as destination:
                source.backup(destination)
                for table in ('users', 'sessions', 'predictions', 'settlements'):
                    count = destination.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
                    if count:
                        raise ValueError(f'Reset verification failed: {table} still contains {count} rows.')
                    print(f'{table}: {count}')
            os.chmod(path, 0o600)
    print('Database reset. Users, sessions, predictions, and settlements cleared; category and instrument seeds restored.')


def main():
    """Parse maintenance commands and enforce locks and explicit reset confirmation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'backup', 'status', 'reset', 'usernames'])
    parser.add_argument('--db', type=Path, default=server.DB, help='SQLite path (default: PREDICT60_DB or project data/p60.sqlite3)')
    parser.add_argument('--confirm-reset', action='store_true', help='Required for reset; clears all account/order data after backup')
    parser.add_argument('--backup-dir', type=Path, help='Optional destination for the backup command')
    args = parser.parse_args()
    path = args.db.expanduser().resolve()
    server.DB = path
    try:
        # Initialization is idempotent; destructive reset follows a separate explicit confirmation path.
        if args.command == 'init':
            with maintenance_lock(path):
                server.initialize()
            print(f'Initialized/migrated without deleting existing data: {path}')
        elif args.command == 'backup':
            print(f'Backup saved: {backup(path, args.backup_dir.expanduser().resolve() if args.backup_dir else None)}')
        elif args.command == 'status':
            status(path)
        elif args.command == 'usernames':
            list_usernames(path)
        elif args.command == 'reset':
            if not args.confirm_reset:
                raise ValueError('Reset clears users, sessions, predictions, and settlements. Re-run with --confirm-reset to back up and reset.')
            reset(path)
    except (ValueError, sqlite3.Error, OSError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
