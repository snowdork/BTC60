# Latest regression test results

**Result: PASS — 170 passed, 0 failed, 0 skipped.**

## Run identification

- Started: October 21, 2026 at 11:24:38 AM MDT (`America/Denver`, UTC−06:00).
- Command: `python3 scripts/run_tests.py`, from the repository root.
- Total suite duration: 20.49 seconds.
- Branch: `Phase-8`.
- Base commit: `8751daa1093213e3e76d87b53012192aa1b2d215`.
- Checkout: dirty worktree including the password-lock fix, updated wallet tests,
  account-test isolation, welcome/category presentation changes and renamed Docker
  restart helper. These results cover that working tree, not the base commit alone.
- Environment: local Linux, Python application/script tests and Node.js tests;
  temporary databases and mocked provider/network responses.

## Suite results

| Suite | Tests | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 82 | 82 | 0 | 0 | 0.11 s |
| Python application | 77 | 77 | 0 | 0 | 5.05 s |
| Python scripts | 11 | 11 | 0 | 0 | 15.33 s |
| **Total** | **170** | **170** | **0** | **0** | **20.49 s** |

## Review-specific verification

- Password hashing permits an independent SQLite writer during both scrypt calls.
- Concurrent credential replacement or session revocation rejects the stale
  password-change request with HTTP 409 and does not install its proposed password.
- New prediction assertions verify hourly contest credits, the 1,000-credit cap,
  rejection without spending, idempotent replay and once-only settlement payouts.
- Account HTTP tests use separate temporary databases, preventing time-advanced
  finalization in one scenario from contaminating a later scenario.
- Existing performance regressions pass: bounded request concurrency and reusable
  slots, explicit database closure/rollback, constant catalog query counts,
  read-only contest polling, coalesced history loads and retry deduplication.
- Docker helper tests use `scripts/restart-docker.sh`; build-failure preservation,
  VPS replacement ordering and local container restrictions pass with mocked Docker.

The log includes intentional HTTP 503 messages from negative health/feed tests;
these are expected test cases, not suite failures.

## Evidence

The [archived full runner output](test-results/2026-10-21_11-24-38.txt) preserves
all emitted output with terminal color codes removed. The original colored log is
`/tmp/test_results/test_result_2026-10-21_11-24-38_529150.log`.

Earlier in the review, the baseline run had three outdated practice-wallet
assertions. Those assertions were corrected to test the active contest wallet;
account-test isolation was also fixed before the successful run above.

## Not verified by this run

- Real Docker image build/startup, persistent-volume permissions and recovery.
- Public HTTPS, reverse-proxy behavior on the deployed host, VPS reboot or restore.
- Live provider availability, actual interval settlement and external rate limits.
- Rendered desktop/mobile layout, accessibility interactions or visual theme checks.
- Production throughput, p95 latency, memory use or large-history capacity.

Account responses still include complete prediction histories, and contest
leaderboards build full standings before trimming visible leaders. The passing
regressions do not establish capacity limits for either path.

Coverage and repeatable manual procedures are maintained in the
[test guide](TEST_GUIDE.md). Documentation-only edits after this run do not change
the recorded executable test results.
