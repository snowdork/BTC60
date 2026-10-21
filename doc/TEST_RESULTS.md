# Latest regression test results

**Result: PASS — 172 passed, 0 failed, 0 skipped.**

## Run identification

- Started: October 21, 2026 at 12:31:17 PM MDT (`America/Denver`, UTC−06:00).
- Command: `python3 scripts/run_tests.py`, from the repository root.
- Total suite duration: 20.59 seconds.
- Branch: `Phase-8`.
- Base commit: `8751daa1093213e3e76d87b53012192aa1b2d215`.
- Checkout: dirty worktree including the password-lock fix, updated wallet tests,
  account-test isolation, welcome/category presentation changes and renamed Docker
  restart helper, plus current-hour coin prediction markers. These results cover that working tree, not the base commit alone.
- Environment: local Linux, Python application/script tests and Node.js tests;
  temporary databases and mocked provider/network responses.

## Suite results

| Suite | Tests | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 84 | 84 | 0 | 0 | 0.10 s |
| Python application | 77 | 77 | 0 | 0 | 5.15 s |
| Python scripts | 11 | 11 | 0 | 0 | 15.34 s |
| **Total** | **172** | **172** | **0** | **0** | **20.59 s** |

## Review-specific verification

- Coin markers distinguish active Up, Down and mixed predictions, exclude settled,
  practice and previous-hour orders, expire at interval/hour boundaries, and
  refresh after account updates or logout. Color rendering remains a manual check.

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

The [archived full runner output](test-results/2026-10-21_12-31-17.txt) preserves
all emitted output with terminal color codes removed. The original colored log is
`/tmp/test_results/test_result_2026-10-21_12-31-17_318417.log`.

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

## Subsequent focused verification: host-service handoff

After the full run recorded above, `restart-docker.sh` was updated to stop an
installed `predict60.service` after a successful build and before starting Docker.
`python3 -m unittest discover -s scripts -p docker_restart_test.py` passed all
six tests (0 failures). Both local and VPS modes cover handoff ordering, absent
service behavior and aborting replacement after a failed service stop.
`bash -n scripts/restart-docker.sh` and `git diff --check` also passed. Docker and
systemctl were mocked; the complete suite was not rerun for this script change.

## Subsequent focused verification: hourly direction rings

`node --test bootstrap.test.js` passed all six tests after changing coin markers
to retain settled predictions for the displayed hour. Coverage includes mixed
Up/Down orders, hour rollover, historical-hour navigation, synthetic preview,
settlement retention and logout. The static export was rebuilt and
`git diff --check` passed. Separate outer direction rings and inner theme-aware
selection highlights still require rendered browser verification. The complete
suite was not rerun for this change.
