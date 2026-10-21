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

## Credit limits

The API and quote-model tests cover acceptance at 1,000 credits and rejection
above the cap, including fractional overages and unchanged balances after a
rejection. In the browser, check that MAX selects the smaller of 1,000 and the
available balance. Confirm account/portfolio values show credits while live
crypto prices and settlement benchmarks still show USD. Existing amounts are
preserved in hundredths of a credit. Contest tests cover allowance limits, concurrent entries, UTC rollover, score
finalization, ties, prize allocation retries, and private-reference isolation.
External gift-card delivery is not implemented. Gift cards are the only supported
prize type; tests reject other types on both new and existing database schemas.

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

## Contest and sponsor acceptance checks

Run `python3 -m unittest contests_test` for backend and HTTP checks. In a browser,
use two disposable accounts and confirm:

1. The terminal uses Hourly contest only. There is no play mode selector, and
   the API rejects new practice predictions.
2. A 600-credit contest entry leaves 400 across all instruments and intervals.
   Settled payouts refill the balance and can be reused that hour. MAX reflects
   the balance and interval cap; overspending through the API is rejected.
3. The portfolio displays contest history and the current hourly balance.
4. Closed hourly periods show final winners only after all entries
   settle; ties retain equal rank. Old practice predictions never appear.
5. At the hour boundary, missing settlement blocks new contest entries and the
   reset. After finalization, the allowance is 1,000 and the new tally is zero.
   Verify Last hour, older history pages, and a GMT date/hour lookup.
6. Sponsor configuration renders a labeled HTTPS link. With no configuration or
   a failed sponsor request, the game remains usable and no banner is inserted.
7. Only the signed-in user's prize records appear. Funding references, delivery
   references, email addresses, and audit notes are absent from dashboard output.
8. Using a temporary database, reserve a future pool via the CLI and check that
   it appears as upcoming, is allocated once, and cannot skip prize review.

Do not use real ad tags or send real gift cards during automated tests. No
browser was connected during implementation; rendered desktop/mobile layout and
these manual interface checks still require a browser-capable environment.

## Signup access code

New account creation requires the organizer's signup code. API tests cover
missing, incorrect, non-string, and whitespace-altered codes, ensuring rejected
requests create neither an account nor a session. Login remains code-free.
The signup form sends the code to the server; it does not embed the expected
value in browser assets.

New signup passwords accept 8–16 characters and require a matching verification
value on both client and server. Check exact length boundaries, mismatches, and
Show/Hide controls for each password/code field. Existing accounts with longer
passwords can still log in; login requires neither confirmation nor signup code.

## VPS resource regressions

`python3 -m unittest performance_test` checks database closure/rollback, read-only
contest polling under a writer lock, concurrent history request sharing, failed
settlement deduplication, and HTTP overload recovery. These use temporary data
and mocked providers; see [local performance measurements](VPS_PERFORMANCE.md).

Signup tests configure `P60_SIGNUP_CODE` explicitly, verify code changes, and
verify that missing/empty configuration disables signup without blocking login.

## Password changes and logout

Run the focused browser regressions with:

```bash
node --test account.test.js password.test.js
python3 -m unittest server_test.AccountsTest.test_change_password_validation_and_session_revocation
```

Browser tests cover CSRF submission, confirmation mismatch, retry after an
incorrect password, a settlement response arriving after logout, and logout
after another tab ends the session. API coverage checks authentication, CSRF,
password lengths, confirmation, current-password verification, other-session
revocation, old/new login credentials, and throttling.

On a disposable installation, sign in with two separate browser profiles. Open
**Change password** in one and submit a valid change. Confirm that this profile
stays signed in, the other must log in again, the old password fails, and the new
password succeeds. Check the link from Markets, the terminal, and the portfolio.
