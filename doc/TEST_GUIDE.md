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
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest server_test logging_test
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest discover -s test/scripts -p '*_test.py'
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest docs_test
node --test test/frontend/*.test.js
python3 src/backend/server.py --help
git diff --check
```

The help output should show `--bind` with default `127.0.0.1`. Docker overrides
that address with `0.0.0.0`; this does not publish the port on the VPS.

## Automated coverage map

The JavaScript suites execute browser logic with mocked DOM/network state; they
are not rendered browser or end-to-end tests. Python HTTP tests start a loopback
server against temporary SQLite databases. Provider calls are mocked unless a
manual procedure explicitly says to use a live feed.

| Suite files | Coverage |
| --- | --- |
| `test/frontend/account.test.js`, `test/frontend/auth.test.js`, `test/frontend/password.test.js` | Restored/expired sessions, protected navigation, signup and login validation, password visibility, password changes, logout races, CSRF recovery and bounded retries. |
| `test/frontend/bootstrap.test.js`, `test/frontend/coins.test.js`, `test/frontend/categories.test.js` | Catalog-first startup, offline/static-server failures, instrument selection, category configuration, coming-soon availability and displayed-hour coin prediction rings (direction, settled retention, hour navigation and logout). |
| `test/frontend/btc-chart.test.js` | Minute history and heat maps, current/historical-hour navigation, stale response rejection, benchmark/quote freshness and oil-feed error states. |
| `test/frontend/market-model.test.js`, `test/frontend/portfolio-model.test.js` | Interval layout, Up/Down outcomes, probability and volatility calculations, cutoff rules, credit limits, payout rounding, settled P/L and numeric history sorting. |
| `test/frontend/community.test.js`, `test/frontend/contests.test.js`, `test/frontend/sponsor.test.js` | Community polling recovery, hourly score states, contest history and lookup, pending resets, safe sponsor links and absent/failed sponsor configuration. |
| `server_test.py` | HTTP accounts, signup code, password changes, CSRF/origin/proxy/cookie rules, credit cap, idempotent predictions, settlement, health, catalog, community, protected pages and static allowlist/compression/HEAD. |
| `contests_test.py` | Shared hourly wallet, concurrent spending, reusable winnings, hour boundaries, independent resets, finalization, ties, history, migration, gift-card pools and private-reference isolation. |
| `categories_test.py` | Idempotent catalog migrations and preservation of legacy simulated settlement sources. |
| `odds_test.py` | Browser/server parity, volatility response, calibration, settlement horizon and resumable/deduplicated history downloads. |
| `live_oil_test.py`, `oilprice_api_test.py`, `weather_test.py` | Provider timestamps, exact observation boundaries, unavailable/stale/mismatched data, credential/error handling and dormant category behavior. These tests do not enable Oil or Weather trading. |
| `performance_test.py` | Bounded HTTP concurrency, database lifecycle, constant catalog query counts, history coalescing and settlement retry deduplication. |
| `logging_test.py`, `docs_test.py` | Log levels/rotation and source documentation coverage/control-flow ownership. |
| `test/scripts/build_static_test.py`, `test/scripts/database_test.py` | Public-only static builds, preservation after a missing source, database initialization/backup/reset and process locking. |
| `test/scripts/server_control_test.py`, `test/scripts/docker_restart_test.py` | Watchdog crash/stop lifecycle and Docker restart command ordering/container options. Docker calls are mocked. |
| `test/scripts/run_tests_test.py` | Timestamped result filenames and Node/Python summary parsing. |

## Account test isolation and deterministic time

Each `server_test.AccountsTest` scenario initializes its own temporary database
and clears authentication-attempt state. The HTTP server is shared by the class,
but accounts, contests and finalized results are not shared between scenarios.
This prevents a settlement test that advances time and finalizes an hourly
contest from closing the contest used by a later test. The original database
selection is restored when the class finishes.

Order scenarios use a mocked open point within the hour where appropriate.
Keep cutoff-specific cases separate: an order is accepted before the final
30 seconds and rejected at the cutoff. Do not make a successful-order assertion
depend on the wall clock being outside the last 30 seconds of the hour.

## Credit limits

The API and quote-model tests cover acceptance at 1,000 credits and rejection
above the cap, including fractional overages and unchanged balances after a
rejection. In the browser, check that MAX selects the smaller of 1,000 and the
available balance. Confirm account/portfolio values show credits while live
crypto prices and settlement benchmarks still show USD. Existing amounts are
preserved in hundredths of a credit.

The HTTP regression assertions use `contestWallet.remaining_cents` and
`contestWallet.spent_cents` for new orders. A successful contest prediction must
not debit the legacy `user.balance_cents` practice balance. Replaying the same
request ID must preserve both the wallet and the single saved prediction. Winning
payouts are checked once, losing payouts are zero, and settlement is user-scoped.
A rejected over-cap order must create no prediction and spend no contest credits.

Contest tests cover allowance limits, concurrent entries, UTC rollover, score
finalization, ties, prize allocation retries, and private-reference isolation.
External gift-card delivery is not implemented. Gift cards are the only supported
prize type; tests reject other types on both new and existing database schemas.

## Docker restart helper regressions

Run without a Docker daemon:

```bash
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest discover -s test/scripts -p 'docker_restart_test.py'
```

The tests substitute a fake Docker executable and exercise
`scripts/restart-docker.sh` in local and VPS modes. Expected behavior:

- A failed build leaves the running deployment untouched: no stop, remove,
  recreate or run command occurs afterward.
- VPS mode builds before `up -d --no-build --wait` and never calls `down`.
- Both modes stop an installed `predict60.service` after the build and before
  replacing/starting Docker. An absent service is skipped; a failed service stop
  aborts Docker replacement. The systemctl commands are mocked.
- Local mode includes a read-only root, 64 MiB temporary filesystem, dropped
  capabilities, no-new-privileges and bounded local logs.

These assertions verify generated commands and ordering. Real image builds,
volume ownership, readiness and recovery require the manual Docker checks below.

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

## Recording a test run

Keep execution results in a separate report, not in this guide. Record the date
and timezone, repository/commit and dirty-worktree status, commands, suite totals,
failures/skips, complete log location and checks not performed. For performance
measurements, also record the dataset, concurrency, environment and whether
providers were mocked. A successful mocked run does not establish live-feed
availability, rendered layout, Docker recovery or production capacity.

## Contest and sponsor acceptance checks

Run `PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest contests_test` for backend and HTTP checks. In a browser,
use two disposable accounts and confirm:

1. The terminal uses Hourly contest only. There is no play mode selector, and
   the API rejects new practice predictions.
2. A 600-credit contest entry leaves 400 across all instruments and intervals.
   Settled payouts refill the balance and can be reused that hour. MAX reflects
   the balance and 1,000-credit per-prediction cap; overspending through the API is rejected.
3. The portfolio displays contest history and the current hourly balance.
4. Closed hourly periods show final winners only after all entries
   settle; ties retain equal rank. Old practice predictions never appear.
5. At the hour boundary, each player receives 1,000 fresh credits and a zero tally,
   even if prior settlements are pending. Late payouts update only their original
   hour. Final first-place results display the Winner trophy in Last hour.
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

`PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest performance_test` checks database closure/rollback, read-only
contest polling under a writer lock, concurrent history request sharing, failed
settlement deduplication, and HTTP overload recovery. These use temporary data
and mocked providers; see [local performance measurements](VPS_PERFORMANCE.md).

Signup tests configure `P60_SIGNUP_CODE` explicitly, verify code changes, and
verify that missing/empty configuration disables signup without blocking login.

## Password changes and logout

Run the focused browser regressions with:

```bash
node --test test/frontend/account.test.js test/frontend/password.test.js
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest server_test.AccountsTest.test_change_password_validation_and_session_revocation
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest server_test.AccountsTest.test_password_hashing_allows_other_database_writers
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest server_test.AccountsTest.test_password_change_rejects_concurrent_credentials_or_session_change
```

Browser tests cover CSRF submission, confirmation mismatch, retry after an
incorrect password, a settlement response arriving after logout, and logout
after another tab ends the session. API coverage checks authentication, CSRF,
password lengths, confirmation, current-password verification, other-session
revocation, old/new login credentials, and throttling.

The database-contention regression acquires an independent SQLite writer lock
during each of the two scrypt operations. Both acquisitions must succeed: password
hashing must not own the writer lock. The race regression changes the stored
password or revokes the caller's session during hashing. The stale password-change
request must return HTTP 409, and its proposed new password must not become valid.
The final credential update and other-session revocation remain atomic.

On a disposable installation, sign in with two separate browser profiles. Open
**Change password** in one and submit a valid change. Confirm that this profile
stays signed in, the other must log in again, the old password fails, and the new
password succeeds. Check the link from Markets, the terminal, and the portfolio.

## Welcome and category visual acceptance

Use a rendered browser at desktop and narrow mobile widths, in both themes:

1. Open the welcome page while signed out. Confirm crypto/oil/weather artwork
   fills the background and text/actions remain readable.
2. Confirm the playfield image is a smaller, uncropped preview with its caption,
   beside the welcome copy on desktop and below it on mobile. It must not cause
   horizontal scrolling or obscure signup/login actions.
3. Sign in and open category selection. Confirm the market artwork is present,
   the playfield preview is absent, and Crypto remains usable while Oil/Weather
   remain coming soon.
4. Verify keyboard focus, theme switching and signed-in redirection. Rebuild the
   Docker image after source edits; regenerate `dist/` with
   `python3 scripts/build-static.py` when validating the static export.

Static-hosting checks cover exported presentation only; account and game flows
require the Python API. Automated DOM tests do not replace these visual checks.

## Coin prediction outlines

Run `node --test test/frontend/bootstrap.test.js` for marker-state regressions. Contest
predictions are grouped by the hour of their interval start, including settled
orders. The outer ring describes the hour displayed in the playfield, across all
coins; it does not disappear when a shorter interval ends or settles. Tests cover
Up, Down and mixed directions, exclusion of practice orders, new orders, settlement
retention, logout, hour rollover, historical navigation and synthetic preview.

In the rendered terminal, verify an outside green ring for Up, red for Down and a
split green/red ring when both directions were predicted in that hour. Selecting
a coin adds a separate inside white highlight in dark mode or black highlight in
light mode. The outer direction ring must remain visible while selected. Switch
coins, themes and hours; previous-hour marks should reappear only when that hour
is displayed. Check horizontal scrolling on mobile so the outside ring is not
clipped, and verify hover/focus do not hide the direction ring. Tooltips and
accessible labels should describe predictions in the displayed hour. Synthetic
preview must not show real prediction rings.

Test files are grouped in `test/backend`, `test/frontend`, and `test/scripts`; application sources live in `src/backend`, `src/frontend`, and `src/seeds`. Run the commands above from the repository root.
