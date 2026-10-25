# Latest regression test results

**PASS — 235 passed, 0 failed, 0 skipped.**

## Run identification

- Started October 25, 2026 at 11:48:24 AM MDT (`America/Denver`, UTC−06:00).
- Command: `python3 scripts/run_tests.py` from the repository root.
- Branch: `Phase-9`; base commit: `c76c6a7ba80ac9a4fd9dd5bcb39a84c533c305b5`.
- Dirty worktree: segment rendering/CSS cleanup, exact-candle validation and retry
  hardening, regression additions, maintenance-script docstrings and documentation.
- Linux, Python 3.12 and Node.js 18.19.1; temporary databases, mocked providers.

## Suite results

| Suite | Tests | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 117 | 117 | 0 | 0 | 0.64 s |
| Python application | 86 | 86 | 0 | 0 | 7.95 s |
| Python scripts | 32 | 32 | 0 | 0 | 17.32 s |
| **Total** | **235** | **235** | **0** | **0** | **25.91 s** |

[Complete sanitized test log](test-results/2026-10-25_11-48-24.txt).
Original local log: `/tmp/test_results/test_result_2026-10-25_11-48-24_263109.log`.
The run includes expected error messages from negative provider/health/reset tests.

## Checks added and reviewed

- Pending/upcoming segments omit unavailable prices, probabilities and countdowns.
- Identical segment refreshes cause no tracked price/text/class/label writes;
  disconnected live comparisons clear while completed results remain visible.
- Benchmark recovery rejects malformed rows, retries truncated JSON and keeps the
  same product/minute through wider requests. Permanent HTTP 404 is not retried.
- Thirty-two parallel cached benchmark reads across four boundaries use zero
  provider requests; exact values remain isolated by product and minute.
- All five missing maintenance-script procedure docstrings found by the first
  full run are fixed; source documentation coverage now passes.

## Build and browser checks

- `python3 scripts/build-static.py` refreshed the public-only static export.
- `python3 doc/conf.py` regenerated Python/JavaScript source references.
- `git diff --check` passed.
- Headless Firefox standalone segment fixtures inspected at 1366×768 (dark and
  light), 390×844 and 320×844. Checked wrapped headers, readable prices/status,
  44-pixel phone buttons, and movement labels above arrows. Fixture prices and
  probabilities are illustrative; these are not full app or live-order tests.

Sphinx HTML was not built: the optional Sphinx dependency is not installed in
this environment. Generated source references and documentation coverage were
checked. No live Coinbase/paid feed test, container rollout, VPS load test or
production restart was performed. Socket timeout settings bound individual
provider operations, not total end-to-end order latency.

See [test procedures](TEST_GUIDE.md) and [performance review](VPS_PERFORMANCE.md)
for repeatable checks and remaining capacity limits. Earlier logs remain in
`doc/test-results/` for historical evidence.
