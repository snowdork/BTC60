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

## Categories and Oil migration

Version 3 adds `categories`, and adds `category`, `feed`, and `unit` columns to the
legacy `coins` instrument table. Existing instruments become `crypto` / `coinbase`
/ `USD`. Five oil instruments are added once as `oil` / `simulated` / `USD/barrel`.
The migration preserves accounts, orders, balances, and previous settlements.

Enabled instrument limits apply per category (eight each). Category integrity is
enforced by triggers so populated legacy SQLite tables can migrate without a
rebuild. Categories containing instruments cannot be deleted or renamed by ID.
An instrument with orders cannot change category, product, feed, or demo base.
Disable it instead and use a new symbol for a different source.

`categories.seed.json` supplies default category presentation and `oil.seed.json`
supplies the initial crude catalog. Restarting does not overwrite administrator
changes. Back up with the maintenance command before migrating a working database.

## Live Oil source migration (version 4)

`instrument_sources` overrides the legacy feed for new prices and orders.
`prediction_sources` saves the provider and exact product for each newly placed
order. Old predictions without a snapshot use their original `coins.feed` and
`coins.product`, including simulated Oil. Changing a live mapping affects future
orders only; saved source snapshots continue to settle against the old product.

WTI maps to `WTI/USD`; Brent maps to `XBR/USD`. Other requested crude types retain
empty live mappings and cannot place orders. Do not map them to an unrelated
instrument merely to populate a quote. Credentials belong in the server environment,
never SQLite, source files, or browser code.

Version 5 allows OilPriceAPI source overrides in instrument_sources. Existing prediction_sources snapshots remain unchanged. Credentials stay outside SQLite in a server-only ignored file or environment variable.
