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

## VPS and local Docker reset scripts

From the checkout root, choose one profile explicitly:

```bash
# VPS production app only
sudo bash scripts/reset-vps-database.sh --confirm-reset

# Local Docker testing app only (plain Docker or local Compose)
sudo bash scripts/reset-local-database.sh --confirm-reset
```

Each script takes an integrity-checked safety backup, empties account/game data,
retains the required catalog defaults, starts the selected app and checks its
HTTP readiness. No backup is restored. Environment files and existing backups
remain intact. Run during a maintenance window; active sessions are cleared.

The VPS script resolves this checkout's `p60` Compose app, including containers
with a generated name prefix. The local script selects `p60-local` and its
volume. Both check image availability before stopping anything. If the original
image was deleted, maintenance uses the available built profile image
(`p60:local-dev` locally or the configured VPS image). If neither image exists,
build it with the matching restart helper before retrying. The reset leaves the
app stopped if maintenance fails; inspect the error before restarting it.

The local script requires an existing local Docker deployment. For a direct
Python development server, stop that server and use the existing
`bash scripts/reset-database.sh --local --confirm-reset` instead; that command
leaves the Python server stopped.

## Manual VPS Docker reset procedure

Run these commands from the checkout root during a maintenance window. A full
reset removes accounts, sessions, predictions, contests, signup/IP counters and
custom catalog edits, then restores seeded data. It preserves environment files
and existing backup files. For routine schema upgrades, restart normally instead
of resetting; startup applies migrations while preserving data.

1. Identify the current Compose app and save a consistent backup while it runs:

   ```bash
   app_container=$(sudo docker compose --env-file .env -f compose.yaml ps -q app)
   sudo docker inspect --format '{{.Name}} {{.State.Status}}' "${app_container:?No running app found}"
   sudo docker exec "$app_container" python3 scripts/database.py status
   sudo docker exec "$app_container" python3 scripts/database.py backup
   ```

   Record the printed backup filename. Copy it out of the volume to a private
   backup location, ideally off-host, before proceeding. Backups contain private
   account data. Use `docker cp CONTAINER:/app/data/backups/FILENAME DESTINATION`
   with the selected container and printed filename.

2. Ensure the deployment uses an available maintenance image. If the running
   container's image was deleted or its image ID is stale after a rebuild, run:

   ```bash
   sudo bash scripts/restart-docker.sh --recreate
   ```

   This builds the current source and explicitly replaces the app container,
   preserving the data volume. It causes a brief service interruption. Skip this
   step if the current container image is already available and appropriate.

3. Select the current app again after any recreation, then explicitly reset it:

   ```bash
   app_container=$(sudo docker compose --env-file .env -f compose.yaml ps -q app)
   sudo docker inspect --format '{{.Name}} {{.State.Status}}' "${app_container:?No running app found}"
   sudo bash scripts/reset-database.sh --container "$app_container" --confirm-reset
   ```

   The helper stops only that app, takes another integrity-checked backup, and
   resets its database. It leaves the app stopped. If reset reports an error,
   inspect that error before proceeding.

4. After reset succeeds, start and verify the same app:

   ```bash
   sudo docker start "$app_container"
   sudo docker exec "$app_container" python3 scripts/database.py status
   sudo docker exec "$app_container" python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=5).status)"
   ```

   Expect integrity `ok`, zero users/sessions/predictions/settlements and HTTP
   `200`. Check the public HTTPS endpoint and confirm the signup page loads.
   Registration testing creates a new account, so use an intentional test account.

### More than one app container found

The reset helper searches stopped containers too. A stopped `p60-local` plus a
running VPS app is ambiguous even when `docker ps` shows just one Predict60 app.
List all candidates with `sudo docker ps -a --filter name=p60` and use
`--container` explicitly. A Compose-generated prefix on the container name does
not prevent selection: either its actual name or container ID works. Keep local
test and VPS data volumes separate; do not delete either volume to fix discovery.

### Maintenance image missing

`reset_database.py` launches maintenance using the selected container's exact
image ID. A running container can keep working after that image is deleted,
while a new maintenance container cannot start. Follow step 2 and reselect the
app before resetting. Rebuilding without recreation does not guarantee that the
running container switches to the newly built image.

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
