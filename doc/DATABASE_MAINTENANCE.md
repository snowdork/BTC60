# Database maintenance

Run from the Predict60 folder. Commands work from other directories with an absolute script path too. Python 3 and Linux/macOS are required; no extra packages are needed.

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

Stop `src/backend/server.py` and any other SQLite clients before `init` or `reset`; restart with `python3 src/backend/server.py` afterward. Server and maintenance commands use an exclusive lock to prevent resetting an active server. Servers started before this maintenance update must also be stopped—the old process does not know about the lock.

By default the database is `data/p60.sqlite3`, and backups go under `data/backups/`. Both are excluded from Git. Backup files have owner-only read/write permissions and UTC timestamps. The reset command always creates a backup when the target already exists, builds a fresh database first, and uses SQLite's backup API to replace it without manual WAL-file deletion.

Use `--db /path/to/test.sqlite3` for a separate database; `PREDICT60_DB` is also supported. `P60_DB` is also supported, with legacy `BTC60_DB` as the final environment fallback. If no database path is configured and `data/p60.sqlite3` does not exist, an existing `data/btc60.sqlite3` remains in use. For the backup command only, `--backup-dir /path/to/backups` changes the destination. These commands never push, deploy, or send data externally. TRUMP remains disabled; LINK, AVAX and SUI join the original seven default crypto selections.

A reset invalidates all sessions and removes all users, prediction records, settlements, and custom coin edits. The backup retains the previous state. It is never run implicitly by `init` or server startup.

## Categories and Oil migration

Version 3 adds `categories`, and adds `category`, `feed`, and `unit` columns to the
legacy `coins` instrument table. Existing instruments become `crypto` / `coinbase`
/ `USD`. Five oil instruments are added once as `oil` / `simulated` / `USD/barrel`.
The migration preserves accounts, orders, balances, and previous settlements.

Enabled instrument limits apply per category (ten each). Category integrity is
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

## Ten-coin catalog upgrade

Startup migration 6 adds/enables LINK, AVAX and SUI within the ten-instrument
crypto limit, without resetting accounts, changing saved prediction sources or
disabling custom coins. A custom catalog may fill the limit before all additions
are enabled; inspect `python3 scripts/database.py status` and adjust explicitly
if needed. Later restarts do not re-enable coins you subsequently disable.
The browser and database both support ten selections; the five-column picker
therefore displays two complete rows for the default crypto set.
