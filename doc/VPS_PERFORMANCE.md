# VPS performance review

The latest review is November 14, 2026. Earlier dated sections are retained as
historical evidence. Measurements below use temporary databases and synthetic
or mocked provider data; they do not establish production VPS capacity.

## November 14, 2026 pre-VPS cleanup

Reviewed the Phase-10 worktree based on `144a808`, including the Interval/Hour
layout and explicit Docker recreation changes. This pass removes repeated browser
work and closes HTTP error streams; it does not change pricing or settlement rules.

- `coins.js` caches `Intl.NumberFormat` by precision within each catalog rather
  than constructing one for each displayed price. The cache has at most 13 entries.
- The header indexes unsettled predictions on account/user replacement or an
  `account-update` event. Stable ticks skip history scans; start/end boundaries
  and backwards clock movement recompute markers. Duration attributes are written
  only when their accessible label changes. Coin/hour/demo navigation still works.
- Candle benchmark retries and the resumable history downloader explicitly close
  HTTP error responses before retrying or propagating an error. Regression checks
  cover permanent rejection, throttling, server errors and retry exhaustion.
  Test database fixtures also close their SQLite connections deterministically.
- Removed obsolete separate five-minute scrolling rules and duplicate responsive
  control styles. Hour now has one scrolling timeline and pinned duration labels.

### Local measurements

Node.js 24.22.2 and Python 3.14.4 on this development machine. The comparison uses
the implementation at `144a808` and the current worktree, with fixture inputs.

| Check | Before | After |
| --- | ---: | ---: |
| Median time to format 10,000 prices | 110.194 ms | 3.863 ms |
| Settled-history item reads across 30 stable header ticks | 30,000 | 0 |
| Duration accessibility-attribute writes across those ticks | 120 | 0 |

Price formatting was about 28.5× faster in this microbenchmark. Seven runs follow
warm-up and cover the default ten-coin catalog, fractional/negative/large values
and missing prices. Outputs compared equal. Regression tests additionally cover
all supported precisions. Header operation counts use 1,000 settled orders plus
active/future predictions, with unchanged account data between ticks. An account
update still scans the snapshot once; this does not reduce the API response size.

```bash
git show 144a808:src/frontend/coins.js > /tmp/btc60-before-coins.js
node scripts/benchmark-coin-format.cjs /tmp/btc60-before-coins.js
node --test test/frontend/coins.test.js test/frontend/bootstrap.test.js
```

The backend review retains bounded request concurrency, coalesced history loads,
read-only idle settlement and bounded finalized leaderboard reads. Full account
history payloads and live standings aggregation remain growth limits; changing
those APIs is separate work. No production CPU, memory, request latency or load
capacity was measured. See [verification](TEST_RESULTS.md) and the
[VPS rollout handoff](DEPLOYMENT_REVIEW.md). No deployment was performed.

## November 13, 2026 runtime and local development cleanup

Reviewed the Phase-10 worktree based on `62efaea`, including the existing local
setup, reset, registration and compact-segment changes. Focused on reducing
repeated browser work and idle SQLite contention without changing quote or
settlement semantics.

- `minutePlot` rejects out-of-range candles before OHLC checks, validates rows
  without per-candle slices, deduplicates seconds in one pass, and reduces the
  price range without temporary flattened arrays. Exact-boundary closes,
  duplicate/unsorted input behavior, gaps and incomplete-candle rejection remain.
- The detail view caches stable elements and card fields separately. Identical
  properties and serialized attributes are not rewritten. Saved predictions are
  indexed once per account snapshot/event instead of scanning complete history
  on each price update. Account events invalidate the index, including in-place
  fixture changes; freshness and cutoff gates still run every refresh.
- The main Predict field is separate from direction shortcuts, so it receives
  the correct disabled state. Overview updates also avoid unchanged disabled,
  image-alt, summary and movement writes and share one wall-clock sample.
- Finalization first reads whether an ended hourly contest has no unsettled
  entries. Idle passes and unresolved contests do not take the SQLite writer
  lock. Actual finalization rechecks and commits normally, retaining empty
  contests, ties, pending-data recovery and payout idempotence.
- Player instructions, design invariants and the test engineer checklist now
  match optional signup codes, the 100-account policy, compact segments, separate
  local/VPS settings and destructive reset semantics.

### Local evidence

Node.js 24.22.2 and Python 3.14.4; values are local computations on this machine.
The baseline is the source snapshot before this cleanup, not a public endpoint.

| Check | Before | After |
| --- | ---: | ---: |
| Median chart preparation per interval | 0.3927 ms | 0.3185 ms |
| DOM writes on an identical detail refresh | 45 | 0 |
| Detail element/field lookups on that refresh | 26 | 0 |
| SQLite `BEGIN IMMEDIATE` on an idle settlement pass | 1 | 0 |

The chart fixture has 1,440 minute candles and 3,600 recorded seconds, cycling
through 5/15/30/60-minute intervals. Seven runs of 400 plots follow warm-up;
medians improved about 19%. Complete outputs compared equal. A separate 1,000-case
deterministic mixed-data comparison also preserved complete outputs, including
unsorted/duplicate samples and invalid/missing observations. A 1,000-order detail
fixture shows no repeated history scan between account updates.

The DOM counts use instrumented fixtures; the actual browser renderer also
passed a MutationObserver check for zero unchanged mutations. Offline Firefox
fixtures passed at 1366, 390 and 320 pixels in dark and light themes, checking
changed prices, disconnected controls, direction events, fit and 44-pixel action
heights. They do not exercise live Google login, provider calls or accepted orders.

Reproduce the chart comparison from the repository root:

```bash
git show 62efaea:src/frontend/market-model.js > /tmp/btc60-before-market-model.js
node scripts/benchmark-market-model.cjs /tmp/btc60-before-market-model.js
```

Use operation-count regressions as correctness gates rather than CI time limits.
Keep one app process, the existing 32-handler default and SQLite durability
settings. Full account-history responses and live standings remain growth
limits. Public p95 latency, memory and production throughput were not measured.
No production service was rebuilt/restarted and no real database was reset.

See [current verification](TEST_RESULTS.md), [test commands](TEST_GUIDE.md), and
[release acceptance](QA_CHECKLIST.md). The older Docker-availability notes below
refer to their dated reviews, not the current environment.

## Earlier backend improvements (historical)

- Catalog reads now batch instrument/provider metadata: `/api/coins` uses one
  SELECT and `/api/categories` uses two, regardless of the instrument count.
  No catalog cache is added, so administrator edits remain visible immediately.
  Regression checks cover the seeded catalog and 30 additional instruments.
- Database scopes now commit/roll back and close connections deterministically.
  Python's SQLite context manager alone does not close connections; the old code
  relied on garbage collection. Backup/status/reset commands also close handles.
- HTTP concurrency defaults to 32 handlers. Excess requests receive HTTP 503
  with Retry-After rather than creating unlimited threads. Set P60_MAX_REQUESTS
  from 1 to 256 to tune after measuring the host. A disconnected or failed
  handler returns its slot. This limit includes health-check requests.
- Concurrent price-history loads for the same product share the cached result.
  Fixed lock stripes bound lock memory; unrelated products can fetch concurrently
  unless they share a stripe. Failed loads remain retryable, without invented data.
- Settlement joins frozen provider snapshots in its initial query and resolves
  instrument metadata once per coin. A failed benchmark is requested only once
  per settlement pass, rather than once per prediction. Later passes retry.
- Existing contest periods are read without attempting an INSERT on each poll.
  Prize pools are fetched in one query for all displayed periods. The API finishes
  the database scope before sending the dashboard response to the client.
- Indexes support due predictions, per-user interval exposure, session expiry,
  recent/open contests, final rankings, and a user's prize records. Startup adds
  them idempotently; existing accounts and predictions remain intact.
- Health checks read the users table, so an empty/missing application schema does
  not pass merely because SQLite can evaluate SELECT 1.
- Docker's temporary filesystem is limited to 64 MiB. Database/certificate
  volumes and bounded logs remain configured. Rebuild the image after deployment.

Reference: [Python SQLite context managers](https://docs.python.org/3.13/library/sqlite3.html)
and [SQLite query planning](https://www.sqlite.org/queryplanner.html).

## Local measurements

Synthetic dashboard data: 200 players, 60 finalized hourly periods, 12,000 stored
ranking rows. Seven dashboard calls per variant, on the same indexed database.
The baseline reconstructs the previous per-period prize queries and unconditional
period INSERT attempts, isolating the query changes rather than comparing releases.

| Check | Before | After |
| --- | ---: | ---: |
| SQL statements per dashboard call | 130 | 67 |
| Write attempts per existing-period dashboard call | 2 | 0 |
| Median local dashboard computation | 12.54 ms | 9.75 ms |
| Provider requests for eight simultaneous cold history loads | 48 | 6 |

October 20 catalog cleanup, measured against the previous handlers using the same
temporary seeded database: coin catalog SELECTs fell from **16 to 1**, and category
catalog SELECTs from **5 to 2**. Both endpoint responses compared equal. These are
query counts, not a claim about end-to-end production latency.

History requests were mocked with a short delay to exercise concurrent cold
misses. These counts do not establish real provider latency or availability.
One hundred updated database scopes retained zero additional file descriptors
with cyclic garbage collection disabled. Timings depend on the machine and
cache state; the request/query reductions are the more useful evidence.

## Verification and deployment

```bash
PYTHONPATH=src/backend:scripts:test/backend python3 -m unittest performance_test
python3 scripts/run_tests.py
docker compose config --quiet
sudo bash scripts/restart-docker.sh --recreate
docker compose ps
docker compose logs --tail=100 app
```

Back up before deploying. Creating indexes on a large database can extend the
first startup. This earlier review did not have Docker available. The November 14
pass validated the Compose configuration with Docker but did not build or start
an image. Runtime validation remains part of the VPS rollout.

Resource tests cover connection commit/rollback/closure, contest reads while
another connection owns the writer lock, history request coalescing and retries,
settlement retry deduplication, and overload recovery.

## Remaining limits

The app still uses ThreadingHTTPServer behind Caddy and one SQLite writer. The
concurrency bound is not a production-server refactor or a capacity guarantee.
SQLite connections are scoped rather than pooled. Account snapshots still return
complete prediction history, and live contest standings aggregate current entries
before limiting displayed rows. Finalized standings already use bounded reads,
including complete tied winners and the caller's rank. Account pagination and
narrower live standings queries are the next changes if histories or participation
become large.

Slow external providers still consume request slots. Authentication hashing also
uses CPU/memory, so test login bursts as well as reads. Monitor 503 responses,
p95 latency, RSS, CPU, open descriptors, SQLite contention, provider rate limits,
and settlement lag through HTTPS on the real VPS before raising concurrency.
Keep the single app replica: its settlement worker and database lock rely on it.

## October 21, 2026 maintenance review

- VPS rebuilds now build before replacing the app, preserving the running site
  on build failure. The restart helper no longer tears down Caddy/the network
  before building. Single-instance replacement still causes a brief interruption.
- Plain-Docker local operation now uses the same read-only root, 64 MiB tmpfs,
  dropped capabilities, and bounded local logs as Compose. The data volume
  remains writable and persistent.
- Removed unused welcome-page illustration CSS after removing that pane.
  Regenerated the static export from root source to eliminate stale copies.
- Retained the existing concurrency limit, database indexes, and history-fetch
  coalescing. No unmeasured increase in worker count or SQLite replicas was made.

Validation: the complete runner reported 165 passes and three failures out of
168 tests. All three failures also reproduce from a clean archive of committed
HEAD: `test_account_prediction_settlement_lifecycle`,
`test_prediction_credit_cap_is_enforced_without_debiting_rejections`, and
`test_win_loss_settlement_credits_once_and_is_user_scoped`. Their expectations
assert debits/payouts on the practice balance while the current endpoint places
contest orders. Resolve the intended wallet behavior and align those tests before
claiming a fully green release. This review did not change credit accounting.
Three additional focused restart-script tests pass, covering build failure,
service replacement ordering, and local container restrictions.

Docker Engine's client is present, but daemon access and the Compose plugin are
unavailable in this environment. No live container rollout or VPS load test was
performed. Verify the public health endpoint and a complete prediction/settlement
cycle after deployment. The deployment docs now separate local Python, local
Docker/Compose, and VPS Docker/systemd workflows.

### Follow-up code and performance review

- Password changes now read credentials and perform both scrypt operations before
  acquiring SQLite's writer lock. The short update transaction checks the original
  password hash/salt and the live session before replacing credentials and revoking
  other sessions. A concurrent password change or logout rejects the stale update.
  Responses are sent after releasing the database transaction.
- Added regression checks that acquire an independent writer lock during each
  hash, and simulate password replacement/session revocation during hashing.
- Updated the three legacy practice-balance assertions to verify hourly contest
  spending, payouts, and idempotent retries. Account tests now use a fresh database
  per scenario: advancing time to finalize a contest no longer contaminates later
  tests. Order tests use a fixed open point within the hour to avoid cutoff timing.
- Remaining scaling concerns are unchanged: account polling returns all saved
  predictions, and contest dashboards build full standings before trimming leaders.
  These need pagination/query changes if account history or participation grows.

Validation: `python3 scripts/run_tests.py` passes all 170 tests. This is local
regression coverage with mocked market providers, not a live Docker/VPS load test.

### Hourly interface and deployment follow-up

See the [October 21 deployment review](DEPLOYMENT_REVIEW.md) for the latest
findings, fixes, validation, and remaining VPS checks. The browser now uses the
hourly wallet and a per-prediction cap without scanning account history for each
quote. Prediction creation avoids two redundant ID lookups. The complete local
suite passes 180 tests, with TAP totals now included correctly in the reporter.
Full account-history payloads and complete dashboard standings remain the main
identified growth limits; no VPS capacity or Docker runtime claim is made.

## October 22, 2026 code review

Finalized dashboard standings now load the first 100 leaders and the caller's
rank directly from indexed results. Aggregate queries retain participant/winner
counts, and all tied winners are still returned even when there are more than
100. Live/provisional standings continue to use the complete score calculation.

Pending countdowns now iterate a list rebuilt only on account updates, rather
than filtering the full prediction history every second. Settlements and logout
clear the list as appropriate; historical results remain indexed for segment views.

Account requests, including JSON body reads, have a 30-second timeout so stalled
settlement requests release their in-flight guard. A timed-out prediction is not
automatically replayed. Returning through the browser's page cache restarts the
chart transport and clock after the existing page-hide cleanup.

Live banner prices update at most every two seconds; clocks and betting
countdowns still tick each second. Coin selection and unavailable-data states
remain immediate. Incoming quotes continue to be validated as they arrive.

Synthetic comparison: 5,000 players, 24 finalized stored hours (23 included in
the dashboard beside the current hour), seven measured calls per variant on
the same temporary indexed database. The baseline is the committed dashboard
implementation before this review; complete response objects compare equal.
Python allocation peaks were measured separately with `tracemalloc`.

| Dashboard measurement | Before | After |
| --- | ---: | ---: |
| Median local computation | 174.25 ms | 11.38 ms |
| Peak traced Python allocation | 5,031,164 bytes | 883,935 bytes |

The regression fixture with 250 unique-ranked players materializes 101 ranking
rows: 100 leaders plus a caller below the displayed list. Cases with 125 or 250
tied winners preserve all winners, alongside empty and absent-player cases.
Timings measure local computation, not public HTTP latency or VPS capacity.

Validation on October 22, 2026 (America/Denver), based on commit `9d0a469` with
an edited worktree and existing Rotate-button changes retained:
`python3 scripts/run_tests.py` passes **208 tests** (115 JavaScript,
78 Python application, 15 Python scripts), with zero failures/skips. The log is
`/tmp/test_results/test_result_2026-10-22_15-30-03_485221.log`.
Providers are mocked. The static export is regenerated from `src/frontend/`.
No VPS rollout or live-provider load test was performed.

Remaining growth limits are full account-history responses, complete live or
provisional standings, and potentially large lists when many players tie for
first. Pagination requires an API/UI change; it was not introduced in this review.


## October 25, 2026 segment and benchmark maintenance

Reviewed the current Phase-9 worktree based on `c76c6a7`. Consolidated the final
segment stylesheet into one state/viewport section, removing superseded header,
price and action rules. Pending/upcoming rows are omitted at render time instead
of building hidden price/odds/countdown nodes. Shared node references avoid
re-querying those elements during the live refresh. Quote freshness is computed
once per refresh, and unchanged direction classes, attributes, text and accessible
labels are not written again. A regression verifies zero tracked DOM writes on
an identical refresh; it does not claim a browser-frame-time improvement.

Benchmark cache candidates are filtered by product under the history lock,
then sorted/validated after releasing it. A shared validator handles both cached
and fetched candles; malformed rows and partial JSON are recoverable misses.
Thirty-two concurrent benchmark reads across four cached interval boundaries
issue **zero provider requests** in the mocked regression. Existing eight-way
history-load coalescing still requires six provider batches on a cold load.
No separate unbounded benchmark cache or extra background polling was added.

Cold benchmark recovery remains at most three requests, each with a three-second
socket timeout, and 0.5/1-second backoff delays. Wider start windows change the
request while preserving the exact minute. Socket timeouts are not a hard total
order deadline: spot/history requests and slow provider reads can still consume
handler slots, so these checks are not a production latency or capacity claim.
Failures are never cached as successful history; orders still require exact data.

Validation: **235 tests passed** (117 JavaScript, 86 application, 32 script), no
failures/skips, 25.91 seconds. See [latest test results](TEST_RESULTS.md) for the
committed log and browser-fixture limits. Source references and static export were
regenerated. No live feed, deployment or production load test was performed.
Account-history response size and live standings remain growth considerations;
retain the existing single-process model and measure before changing concurrency.
