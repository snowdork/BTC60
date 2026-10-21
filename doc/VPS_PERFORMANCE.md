# VPS performance review

Reviewed October 19, 2026. Changes were checked locally with temporary databases
and mocked providers; this is not a production VPS load test.

## Implemented improvements

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
python3 -m unittest performance_test
python3 scripts/run_tests.py
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

Back up before deploying. Creating indexes on a large database can extend the
first startup. Docker build/runtime validation still requires a Docker-capable
host; Docker is not installed in the development environment used for this review.

Resource tests cover connection commit/rollback/closure, contest reads while
another connection owns the writer lock, history request coalescing and retries,
settlement retry deduplication, and overload recovery.

## Remaining limits

The app still uses ThreadingHTTPServer behind Caddy and one SQLite writer. The
concurrency bound is not a production-server refactor or a capacity guarantee.
SQLite connections are scoped rather than pooled. Account snapshots still return
complete prediction history, and the contest dashboard computes all recent
standings before limiting displayed rows. Pagination and narrower leaderboard
requests are the next changes if accumulated histories become large.

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
