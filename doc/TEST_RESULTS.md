# Latest regression test results

**PASS — 240 passed, 0 failed, 0 skipped.**

## Run identification

- Started October 25, 2026 at 12:28:33 PM MDT (`America/Denver`, UTC−06:00).
- Command: `python3 scripts/run_tests.py` from the repository root.
- Branch: `Phase-9`; base commit: `5187373fd6f198e8ef1479fd200149d98517c175`.
- Dirty worktree: ten-coin catalog and migration 6, updated capacity checks, new SUI
  artwork, catalog documentation and the latest segment UI refinements.
- Linux, Python 3.12 and Node.js 18.19.1; temporary databases, mocked providers.

## Suite results

| Suite | Tests | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 120 | 120 | 0 | 0 | 0.64 s |
| Python application | 88 | 88 | 0 | 0 | 8.01 s |
| Python scripts | 32 | 32 | 0 | 0 | 17.38 s |
| **Total** | **240** | **240** | **0** | **0** | **26.04 s** |

[Complete sanitized test log](test-results/2026-10-25_12-28-33.txt).
Original local log: `/tmp/test_results/test_result_2026-10-25_12-28-33_909994.log`.
The run includes expected error messages from negative provider/health/reset tests.

## Checks added and reviewed

- Ten-coin defaults, local artwork, category-isolated picker capacity and rejection
  of an eleventh enabled instrument. Migration 6 upgrades old catalogs once, keeps
  saved data and custom coins, and preserves later administrator edits.
- Mixed Win/Loss labels retain independent colors without slash/unit text, and
  the NO CREDITS banner tracks restored balances and read-only interval states.

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
- Earlier maintenance review: headless Firefox standalone segment fixtures inspected at 1366×768 (dark and
  light), 390×844 and 320×844. Checked wrapped headers, readable prices/status,
  44-pixel phone buttons, and movement labels above arrows. Fixture prices and
  probabilities are illustrative; these are not full app or live-order tests.

Sphinx HTML was not built: the optional Sphinx dependency is not installed in
this environment. Generated source references and documentation coverage were
checked. Public Coinbase product metadata was checked for LINK-USD, AVAX-USD and SUI-USD:
all reported online with trading enabled. This does not establish live prediction
or settlement behavior. No paid feed test, container rollout, VPS load test or
production restart was performed. Socket timeout settings bound individual
provider operations, not total end-to-end order latency.

See [test procedures](TEST_GUIDE.md) and [performance review](VPS_PERFORMANCE.md)
for repeatable checks and remaining capacity limits. Earlier logs remain in
`doc/test-results/` for historical evidence.
