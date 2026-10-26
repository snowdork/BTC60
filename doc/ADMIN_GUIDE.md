# Predict60 administrator guide

Run commands below from the checkout root, using Python 3.10+ on Linux.
The lifecycle scripts require `/proc` and manage only this checkout's Python
server and watchdog. Run them as the same operating-system user that owns the
server. They do not install boot-time startup, restart a crashed watchdog, or
check HTTP health after startup.

For boot-time startup and HTTPS on an existing VPS checkout, see the
[systemd setup helper](../deploy/README.md#enable-https-for-an-existing-checkout).
Once installed, manage that service with `sudo systemctl restart predict60` and
`sudo systemctl stop predict60`; inspect logs with `journalctl -u predict60`.
Stop it with systemctl before database operations requiring a stopped server.
The watchdog commands below apply to deployments supervised by the development
scripts.

## Start, restart, and stop

```bash
python3 scripts/restart-server.py
python3 scripts/restart-server.py --port 8080 --log-level debug
scripts/stop-server.sh
```

`restart-server.py` stops the existing watchdog and server, clears the intentional
stop marker, and launches a detached watchdog. It checks `/api/coins` for readiness
for up to ten seconds and reports the address and log path. A readiness timeout
stops the new processes; inspect the log before retrying. The default port is
8000; supply `--port` again on manual restarts when using another port.

The initial log level is **normal**. A successful start saves the selected level
in `data/server-log-level`. Later manual restarts without `--log-level` reuse that
selection, including after an intentional stop. To change it explicitly:

```bash
python3 scripts/restart-server.py --log-level normal
python3 scripts/restart-server.py --log-level debug
```

Every automatic server restart uses the watchdog's original port, log level,
and environment. A crash does not reset debug logging to normal. Changing the
saved level file alone does not change a running watchdog; use the restart script.
An explicit level overrides the saved selection. Failed starts do not save a new
selection.

`stop-server.sh` creates `data/server.stopped` before stopping both processes.
The marker prevents automatic restarts, including during the three-second retry
pause. Running stop repeatedly is supported. If shutdown times out, the command
fails and retains the marker. Use `restart-server.py` to resume operation.

`watchdog-server.py` is the foreground supervisor used by the restart script.
It starts the server, captures stdout/stderr, and retries three seconds after a
server exit. It supports `--port` and `--log-level`; direct invocation defaults to
8000 and normal and does not read the saved manual-restart setting. It honors the
stop marker and allows one watchdog per checkout. Use `restart-server.py` for
routine startup, since it handles marker removal and readiness checks.

## Log levels and rotation

| Level | Recorded events |
| --- | --- |
| `normal` | User POST actions and response status; successful authentication, predictions, settlements; lifecycle events and important failures. Routine GET requests and polling are omitted. |
| `debug` | Normal events plus HTTP request logs and diagnostic tracebacks, including deferred settlement details. |
| `warning` | Warnings and errors, including server exits that trigger a restart. |
| `error` | Errors only from level-based logging. |

Unexpected server stdout/stderr and uncaught tracebacks are captured at every
level. Application logs omit request bodies, passwords, and session cookies.
Successful settlement records include prediction ID, user ID, instrument,
outcome, and payout in cents. Deferred settlements remain pending for retry.

The default log is `/tmp/p60/server.log`. Logs automatically rotate before a
write would take a nonempty file past **10 MiB**. Five numbered backups are kept:
`server.log.1` is newest and `server.log.5` is oldest. Rotation discards older
backups. Log files are created with mode 0600, and a new log directory with 0700.
A shared lock coordinates the writer and manual rotation; no cron job is needed.

```bash
# Follow the current log; -F follows a replacement file after rotation.
tail -F /tmp/p60/server.log
# Apply the size policy without forcing a smaller file to rotate.
python3 scripts/rotate-logs.py
# Rotate a nonempty log immediately while the server runs.
python3 scripts/rotate-logs.py --force
```

The next restart imports the legacy `data/server.log` under the same retention
policy and removes the old file after its writers have stopped. `/tmp` may be
cleared on reboot. To use another directory, set `PREDICT60_LOG_DIR` consistently
for restart and rotation commands:

```bash
export PREDICT60_LOG_DIR=/tmp/p60
python3 scripts/restart-server.py
python3 scripts/rotate-logs.py --force
```

Check the printed log path when diagnosing startup failures. Logs from multiple
checkouts using the same directory share one rotation policy; give them separate
`PREDICT60_LOG_DIR` values if needed.

## Environment and state

The restart command passes its environment to the watchdog and all replacement
servers. Set `PREDICT60_DB`, `TWELVE_DATA_API_KEY` (or `TWELVEDATA_API_KEY`), and
`OILPRICE_API_KEY` before starting when needed. OilPriceAPI also supports the
ignored server-side `data/oilpriceapi.key` file, but a protected service environment
is preferred. Never commit credentials. See the [README](../README.md) for feed
configuration. Restart after changing environment variables or credentials.

Production proxy settings are `P60_HOST`, `P60_SECURE_COOKIES`, and
`P60_TRUSTED_PROXIES`. Startup rejects malformed values. An HTTPS `P60_HOST`
always enables Secure cookies. Trust forwarded addresses only from a proxy that
overwrites `X-Forwarded-For`; the supplied Caddy configuration does so.

| Path | Purpose |
| --- | --- |
| `data/p60.sqlite3` | Default for new installations; existing legacy databases remain in use. Override with `PREDICT60_DB`. |
| `data/server.stopped` | Intentional-stop marker. |
| `data/server-log-level` | Log level selected by the last successful manual start. |
| `data/server-control.lock` | Serializes manual start/stop operations. |
| `data/server-watchdog.lock` | Prevents duplicate watchdogs. |
| `/tmp/p60/rotation.lock` | Coordinates log writes and rotation. |

Lock files can remain after shutdown; their presence alone does not mean a
process is running. Do not remove lock files to bypass a running process.
`server_control.py` supplies shared process discovery and shutdown functions;
it is an internal module rather than an administrator command.

To stop all Predict60 runtimes, use `scripts/stop.sh` (or
`sudo bash scripts/stop.sh` when required). This stops Docker containers, the
installed systemd service, and the checkout watchdog, preserving data volumes.

## Database maintenance

For deployed databases, use `sudo scripts/reset-database.sh --service --confirm-reset`
or `scripts/reset-database.sh --docker --confirm-reset`. Each stops the selected
app, backs up and resets its database, and leaves the app stopped. Docker supports
`--container NAME` when multiple app containers exist. See
[deployment reset options](../deploy/LOCAL.md#reset-a-deployed-database).

```bash
python3 scripts/database.py status
python3 scripts/database.py backup
scripts/stop-server.sh
python3 scripts/database.py init
python3 scripts/restart-server.py
```

`status` checks integrity and reports table/catalog counts. `backup` uses SQLite's
backup API and checks the copy; it can run while the server is active. Its default
destination is a `backups` folder beside the database. `init` creates or migrates
the database without deleting existing account data and requires a stopped server.

Options include `--db PATH` and, for backup, `--backup-dir PATH`. Use the same
database path in maintenance commands and `PREDICT60_DB` for server startup.

`scripts/reset-database.sh --confirm-reset` resets Docker by default. Use
`--service` for systemd or `--local` for the checkout database. The local form
is also available as `python3 scripts/database.py reset --confirm-reset`. Reset
is destructive: it backs up an existing
database, clears accounts, sessions, predictions, and settlements, and restores
seed catalogs. Stop the server first. See
[Database maintenance](DATABASE_MAINTENANCE.md) for the detailed procedure.

## Historical data and calibration

```bash
python3 scripts/download-odds-history.py BTC-USD data/btc-candles.json --days 30
python3 scripts/calibrate-odds.py BTC data/btc-candles.json
```

`download-odds-history.py PRODUCT OUTPUT --days N` downloads Coinbase minute
candles; days defaults to 30 and accepts 10–365. Rerun the same command after
interruption to resume its `.partial` checkpoint. Network access to Coinbase is
required. Use the instrument's Coinbase product ID.

`calibrate-odds.py COIN CANDLES --output PATH` fits and validates calibration.
The default output is `data/odds-calibration.json`.
It exports only when both held-out Brier score and log loss improve; otherwise
it preserves the existing model. Reload the terminal after a successful export.
See [Design](DESIGN.md) for model assumptions.

## Troubleshooting and validation

For `Benchmark history is unavailable`, check provider availability rather than
resetting the database or asking users to sign in again. The server reuses exact
same-product cached candles and retries cold reads up to three times, widening
the window each time while preserving the required minute. If recovery fails,
logs include `Benchmark unavailable coin=... product=... minute=... after 3 attempts`.
The minute is the candle's Unix timestamp in seconds, immediately before the
interval boundary. Each 15/30/60-minute segment needs its own opening minute.
A missing exact candle blocks a new order and defers settlement; a nearby candle
or current ticker is never substituted. Look for rate limits, upstream failures,
and missing history for that product/minute. Restart/rebuild the backend after
installing benchmark code changes; refreshing browser assets alone cannot apply
them. See [deployment modes](../deploy/README.md#choose-an-operating-mode).


If the server repeatedly exits, inspect `server.log` for a port conflict,
database lock, or startup exception. Use the stop script to pause the retry loop
while correcting the problem. If stop reports a timeout, check the remaining
processes before running maintenance. A running watchdog responds to process
exit; an unresponsive but live server requires a manual restart.

For foreground development, `python3 src/backend/server.py --port 8000 --log-level debug`
logs to the console without supervision or file rotation. Stop the supervised
server before using the same port/database.

```bash
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest server_test.py logging_test.py
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest discover -s test/scripts -p '*_test.py'
```

The scripts suite covers database operations and isolated watchdog lifecycle,
including log-level retention across crashes and manual restarts. Integration
tests require permission to bind local loopback sockets. Any command's `--help`
prints its supported parameters.

## List usernames and password storage

```bash
scripts/list-usernames.py  # Docker by default
scripts/list-usernames.py --local --db /path/to/p60.sqlite3
sudo scripts/list-usernames.py --service
scripts/list-usernames.py --docker
scripts/list-usernames.py --docker --container p60-local
# For a running Docker app (replace the container name if needed):
docker exec p60-local python3 scripts/database.py usernames
```

The command prints account display names, one per line, using a read-only
connection. Login uses email addresses; display names are not unique login IDs.
It does not print emails, hashes, salts, or session tokens. An empty database
prints no names. A missing database produces an error without creating a file.
`--service` reads the service configuration and runs as its user. `--docker`
uses the app container image and volumes; select `--container NAME` if multiple
app containers exist. Both flags leave the app running (or stopped) as it was.
Use sudo when needed for Docker or service configuration access. Docker images must be rebuilt to include the new
`database.py usernames` command. Docker is the default when no deployment flag
is supplied. Use `--local` for the checkout database and current environment;
`--db` alone still selects a path inside Docker. `--service`, `--docker`, and
`--local` are mutually exclusive. Docker supports stopped containers as well as running ones.

Passwords are stored as scrypt hashes (`n=16384`, `r=8`, `p=1`) with a unique
random 16-byte salt per password. Signup and password changes store the hash
and salt; login verifies the derived hash with a constant-time comparison.
Original passwords cannot be retrieved by these tools. This protects password
values; it does not encrypt the whole SQLite database.
