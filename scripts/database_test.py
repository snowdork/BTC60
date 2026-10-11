import fcntl
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('database.py')


class MaintenanceTest(unittest.TestCase):
    def test_init_backup_reset_and_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / 'test.sqlite3'
            def run(*args):
                return subprocess.run([sys.executable, str(SCRIPT), *args, '--db', str(db)], cwd='/tmp', capture_output=True, text=True)
            self.assertEqual(run('init').returncode, 0)
            with sqlite3.connect(db) as conn:
                conn.execute("INSERT INTO users(name,email,password_hash,salt,created_at) VALUES('Test','test@example.com','hash','salt',0)")
                conn.execute("UPDATE coins SET name='Edited' WHERE symbol='BTC'")
            self.assertEqual(run('init').returncode, 0)
            with sqlite3.connect(db) as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 1)
                self.assertEqual(conn.execute("SELECT name FROM coins WHERE symbol='BTC'").fetchone()[0], 'Edited')
            self.assertEqual(run('status').returncode, 0)
            self.assertNotEqual(run('reset').returncode, 0)
            with open(str(db) + '.lock', 'a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertNotEqual(run('reset', '--confirm-reset').returncode, 0)
                self.assertNotEqual(run('init').returncode, 0)
                self.assertEqual(run('backup').returncode, 0)
            self.assertEqual(run('reset', '--confirm-reset').returncode, 0)
            with sqlite3.connect(db) as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT name FROM coins WHERE symbol='BTC'").fetchone()[0], 'Bitcoin')
                self.assertEqual(conn.execute("SELECT enabled FROM coins WHERE symbol='TRUMP'").fetchone()[0], 0)
                self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            backups = list((Path(folder) / 'backups').glob('*.sqlite3'))
            self.assertEqual(len(backups), 2)
            for saved in backups:
                self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
                with sqlite3.connect(saved) as conn:
                    self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
