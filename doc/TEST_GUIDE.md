# Predict60 test guide

Run commands from the repository root. Use disposable accounts and data for
crash and restore checks; do not run destructive tests on the live service.

## Automated regression tests

Install Python 3.10+ and Node.js. The documentation coverage tests also need the
Acorn dependency (Sphinx is only needed to build the reference documentation):

```bash
npm install --prefix doc
python3 scripts/run_tests.py
```

The runner executes JavaScript tests, root Python application tests, and Python
script tests. It prints suite totals and saves a colored log under
`/tmp/test_results/test_result_<date_time>.log`; inspect it with `less -R`.
A missing `acorn` module means the documentation dependency must be installed.
Tests mock provider calls and do not prove live Coinbase or paid-feed access.

For focused checks:

```bash
python3 -m unittest server_test logging_test
python3 -m unittest discover -s scripts -p '*_test.py'
python3 -m unittest docs_test
node --test '*.test.js'
python3 server.py --help
git diff --check
```

Use `node --test *.test.js` if your Node version does not expand the quoted glob.
The help output should show `--bind` with default `127.0.0.1`. Docker overrides
that address with `0.0.0.0`; this does not publish the port on the VPS.

## Docker configuration and startup

Follow [Docker setup](../deploy/DOCKER.md) to configure a test domain in `.env`.
These checks require Docker Engine and the Compose plugin:

```bash
docker compose config --quiet
docker compose build app
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d
docker compose ps
docker compose logs --tail=100 app caddy
docker compose exec app python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).read().decode())"
```

Expect the app to become healthy, Caddy to serve the configured HTTPS domain,
and no published host port for the app. From another machine, confirm port 8000
is unreachable, HTTP redirects to HTTPS, and `/healthz` returns HTTP 200 through
HTTPS. Verify login/logout cookies include Secure, HttpOnly, and SameSite=Lax.

## Account and persistence checks

1. Create a test account, sign in, and choose Crypto.
2. Wait for fresh live prices, submit a prediction, and record its ID and balance.
3. Restart with `docker compose restart app`; confirm the saved prediction remains.
4. Force a container replacement with `docker compose up -d --force-recreate app`;
   confirm the account and prediction still exist in the named volume.
5. Check settlement across an interval boundary. If provider history is unavailable,
   expect awaiting settlement and later retry, not an invented result.
6. Log out, confirm account access requires authentication, and sign in again.

For upgrades from the old naming, expect a fresh sign-in and theme selection.
An existing local legacy database is retained by the local fallback, but Docker
explicitly selects `/app/data/p60.sqlite3`. Import a consistent backup to that
path before starting if testing existing accounts.

## Crash and reboot recovery

Only on a disposable deployment, wait at least ten seconds after startup, then:

```bash
docker compose exec app python3 -c 'import os, signal; os.kill(1, signal.SIGKILL)'
# The interrupted exec command may fail; allow time for Docker to restart the app.
docker compose ps
docker inspect --format '{{.RestartCount}}' "$(docker compose ps -q app)"
docker compose logs --tail=30 app
```

Expect an increased restart count, healthy HTTP responses, retained accounts,
and settlement retries. A deliberate `docker compose stop app` should leave it
stopped; resume with `docker compose up -d`. In a planned VPS maintenance window,
reboot with the stack running, reconnect, and repeat the health/persistence checks.
Docker must be enabled at boot. An unhealthy status alone does not trigger restart.

## Backup and restoration

Use the [Docker backup instructions](../deploy/DOCKER.md) to create a consistent
SQLite backup and copy it off the VPS. Restore into a separate disposable Compose
project or VPS with empty data storage, using a distinct test domain and no port
or subnet conflicts. Confirm the saved account, balances, and predictions match
the backup. Never overwrite a live database or delete the production volume to
perform this test. Keep both the pre-upgrade image and database backup for rollback.

## Validation status

Local app startup with `--bind 0.0.0.0`, temporary database initialization, the
health endpoint, and YAML parsing have been checked. Docker is not installed in
the development environment used to prepare these files, so image build,
container restart behavior, HTTPS issuance, and VPS reboot/restore checks remain
unverified. Record the release commit, host, commands, and results when running
these checks; do not treat mocked tests as a live-feed or capacity test.
