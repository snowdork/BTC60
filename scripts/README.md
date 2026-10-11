# Database maintenance

Run from the BTC60 folder. Commands work from other directories with an absolute script path too. Python 3 and Linux/macOS are required; no extra packages are needed.

```bash
# Create missing tables, apply catalog migrations, and seed a new database.
# Preserves existing users, balances, predictions, settlements, and coin edits.
python3 scripts/database.py init

# Read-only counts and integrity/foreign-key checks (no private account details).
python3 scripts/database.py status

# Consistent SQLite backup, including committed WAL data; safe while server runs.
python3 scripts/database.py backup

# Full reinitialization: automatic backup, then clear account/order data and
# restore coins from coins.seed.json. Requires this explicit flag.
python3 scripts/database.py reset --confirm-reset
```

Stop `server.py` and any other SQLite clients before `init` or `reset`; restart with `python3 server.py` afterward. Server and maintenance commands use an exclusive lock to prevent resetting an active server. Servers started before this maintenance update must also be stopped—the old process does not know about the lock.

By default the database is `data/btc60.sqlite3`, and backups go under `data/backups/`. Both are excluded from Git. Backup files have owner-only read/write permissions and UTC timestamps. The reset command always creates a backup when the target already exists, builds a fresh database first, and uses SQLite's backup API to replace it without manual WAL-file deletion.

Use `--db /path/to/test.sqlite3` for a separate database; `BTC60_DB` is also supported. For the backup command only, `--backup-dir /path/to/backups` changes the destination. These commands never push, deploy, or send data externally. TRUMP and AVAX remain disabled in the current default seed.

A reset invalidates all sessions and removes all users, prediction records, settlements, and custom coin edits. The backup retains the previous state. It is never run implicitly by `init` or server startup.
