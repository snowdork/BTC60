# Test engineer release checklist

Use this checklist with the [test commands and coverage map](TEST_GUIDE.md).
The [player guide](USER_GUIDE.md) describes the intended experience; the
[design notes](DESIGN.md) describe state, data and transaction invariants.
Record actual results in a dated report, including unperformed checks.

## 1. Establish the target

| Target | Settings | Data | Expected use |
| --- | --- | --- | --- |
| Local Python | Current environment; optional `.env.local` signup fallback | Checkout `data/p60.sqlite3` or explicit DB override | Fast debugging and isolated HTTP fixtures |
| Local Docker | `.env.local`; URL printed by setup | `p60-local-data` | Disposable integration and persistence checks |
| VPS Docker | `.env`; production HTTPS domain and loopback port | Compose `p60-data` | Deployment smoke checks and monitored runtime |

Run `scripts/setup-local.sh --check` and `scripts/setup-vps.sh --check` for
saved-file validation. A successful check does not establish daemon access,
port availability, DNS, TLS, Google authorization or provider connectivity.
Do not infer the profile from the browser port alone: inspect its container and
volume. Keep local and VPS ports distinct when both are running.

Record branch, commit, modified files, Python/Node versions, timezone,
selected profile, and whether providers/accounts are fixtures. Never attach
environment files, signup codes, Google tokens, or database backups to a report.

## 2. Run automated regressions

Use the project virtual environment and installed documentation dependencies:

```bash
.venv/bin/python scripts/run_tests.py
node scripts/benchmark-market-model.cjs
python3 scripts/build-static.py
git diff --check
```

Expected: all executed suites pass; any skip has a recorded reason. If the
Google verifier suite skips, install the project requirements and repeat it.
If loopback sockets are restricted, distinguish that environment error from an
assertion failure; repeat the affected temporary fixtures where sockets work.

For an assertion-level Node report, use a separate process for each test file:
`node --test --test-isolation=none --test-reporter=tap FILE`. Count assertions
and files separately. Preserve raw logs, not just the final pass label.

## 3. Registration and session acceptance

Use disposable databases/accounts for registration and abuse cases.

| Case | Expected result |
| --- | --- |
| Default password signup | No organizer-code field; matching 8–16-character passwords create one account. |
| Default Google signup | Verified identity and display name create an account; no code is requested. |
| Optional code gate | With `SIGNUP_CODE_REQUIRED=True`, both methods require the correct server-side code. Missing configuration fails closed. |
| Removed account cap | Password and Google signup work beyond 100 accounts, including concurrent requests. |
| Removed network budgets | Old signup-event records and more than three registrations or ten attempts do not activate the removed hourly/daily signup budgets. General authentication throttling still applies. |
| Bot trap | A nonempty hidden website field creates no account; Google verification is not attempted for that trap. |
| IP trust | Untrusted forwarding headers cannot choose another IP for general authentication throttling. |
| Sessions | Logout clears state; an older response cannot sign the user back in. Password changes revoke other sessions. |

General authentication throttling does not establish identity. Password-email
ownership is not verified; do not claim this as a
CAPTCHA, email-confirmation or one-person-per-account guarantee.

## 4. Segment and chart acceptance

Check 1366×768, 390×844 and 320×720 in both themes. Record the browser and
whether the data is mocked. Use current, completed, pending and upcoming plays.

- The title, duration controls and coin selector stay pinned together as one
  HUD while scrolling. It groups player, C$ balance, UTC clock and view/menu
  controls. Names show at most ten characters, with a full-name tooltip. Clock
  stays beside the player panel; fixed-width digital digits follow wall time across
  midnight and historical views without a clock icon, flip animations or layout shifts. The C$ amount equals the current
  contest wallet, not a separate currency balance.
- The selected coin price is at the graph's top-left in both views. Switching
  coins updates its icon, price and movement. Coin/duration controls stay above
  the graph; no Current time / Prediction cutoff legend bar remains.
- The segment shows coin, UTC range, status, live/closing price, starting price,
  actual movement, Up/Down estimates, relevant action and countdown. Prices use
  USD; stakes and payouts use credits. Probabilities and execution prices remain
  distinct. Missing prices are placeholders, never zero or fabricated values.
- Controls fit without page-level overflow. Narrow cards stack prices/actions;
  all prediction controls retain at least 44-pixel touch height. The five-minute
  row can scroll. Historical cards retain their date across midnight.
- Up/Down shortcuts preselect a side and open review. They do not place orders.
  Main Predict and both shortcuts disable on stale/disconnected/paused feeds,
  unavailable benchmarks, or the five-second cutoff. Read-only Result/Details
  remain usable.
- Single-click selection keeps the view; card-body double-click switches it.
  Buttons do not trigger that shortcut. Hour clears old highlights; Interval
  opens the exact selected absolute start, including across midnight.
- Quotes arriving between second ticks do not retract the playhead. Returning
  to a coin/page preserves its observed trail. Valid minute backfills reconnect
  gaps; unavailable history and incomplete candles remain unconfirmed.
- Changing data updates the UI, while an identical update causes no detail-view
  DOM mutations. Replacing account data updates saved prediction tags; logout
  clears them. All four durations and minute/hour rollovers remain correct.

## 5. Orders, settlement and performance

Use mocked provider fixtures for deterministic cutoff, outage and retry cases.
Use a separate end-to-end check for live provider and public HTTPS behavior.

- Confirm accepts 1–1,000 credits within the remaining hourly balance. Replaying
  the same request ID does not create/spend twice. A late, stale or invalid order
  has no wallet effect. Inspect authoritative saved execution terms.
- Exact preceding-minute closes determine outcomes; ties resolve Up. Missing
  benchmarks leave orders pending and retryable. Winning payouts credit once.
- Current-hour returns can be reused; the next GMT hour receives a fresh
  allowance independently of prior pending settlements. Final ranks/prizes wait
  for every entry, and equal scores share ranks.
- Idle settlement and contests awaiting benchmarks do not acquire SQLite's
  writer lock. A closed empty contest still finalizes. Provider work happens
  outside writer transactions. Concurrency/overload slots remain bounded.
- Record chart benchmark inputs, medians and equality with an earlier version.
  Use operation-count regressions for CI; machine-dependent timings alone are
  not pass/fail gates or evidence of VPS capacity.

For VPS load evaluation, measure public HTTP p50/p95 latency, 503 rate, CPU/RSS,
open file descriptors, SQLite contention, provider failures and settlement lag.
Retain one app process and measure before changing `P60_MAX_REQUESTS`.

## 6. Disposable runtime and release checks

On an isolated local deployment, test startup, restart, persistence, deliberate
stop and a backup/restore round trip. Preserve the selected profile and volume
in the report. A backup is not proven until it has been restored into separate
test storage and its account/prediction data checked.

The profile reset commands require explicit `--confirm-reset` and permanently
empty the selected database's game/account state after saving a safety backup.
They retain catalog defaults and restart only after success. Test image fallback,
missing image and maintenance failure with mocks or disposable containers.
Use [database procedures](DATABASE_MAINTENANCE.md), never production storage for
reset/recovery experiments.

For a deployment smoke check, confirm the intended image/profile, container
health, public HTTPS, existing-user login, current prices and one controlled
prediction/settlement cycle. A health check alone does not prove Google login,
market-data availability, production throughput or correct public proxy routing.

## 7. Write the handoff

Include commands and logs, assertion/file totals, failures and skips, fixture
versus live coverage, browser sizes/themes, performance baseline/dataset, and
checks still outstanding. Include the image identifier for Docker verification
and the rollback backup location in a private operations record. Link the
player/design guides when behavior changed; do not label a deployment verified
when only unit or offline browser fixtures ran.
