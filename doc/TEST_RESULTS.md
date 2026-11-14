# Latest regression test results

**November 14, 2026 — 400 assertion cases passed; zero failures or skips.**

## Current scope and environment

Phase-10, base `144a808`, with the Interval/Hour layout changes, explicit Docker
recreation option and cleanup. The follow-up gives Hour the same clock/coin/range
identity and combines Interval prices/movement with its countdown beside the range.
Linux, Python 3.14.4 in `.venv`, Node.js 24.22.2;
timestamps use America/Denver. Providers and Docker lifecycle calls are mocked;
accounts/databases are temporary. No real deployment was restarted or updated.

## Current automated results

Command: `.venv/bin/python scripts/run_tests.py`.
Started November 14 at 09:13:19 MST; completed in 22.18 seconds.

| Group | Assertion cases | Result | Duration |
| --- | ---: | --- | ---: |
| JavaScript (17 files) | 195 | PASS | 0.21 s |
| Python application | 126 | PASS | 4.82 s |
| Python scripts | 79 | PASS | 17.14 s |
| **Total** | **400** | **PASS; no skips** | **22.18 s** |

Full log: `/tmp/test_results/test_result_2026-11-14_09-13-19_445369.log`.
The earlier sandbox run could not create loopback sockets; the final complete
run allowed those temporary HTTP/watchdog fixtures. It passed without resource
warnings after HTTP error streams and test SQLite connections were closed.

New coverage includes selector image fallbacks, duration identity, shared Hour
scrolling/Now behavior, cached price formatting, stable header ticks and account/
time-boundary invalidation. Docker mocks cover restart versus `--recreate`, build
failure before stopping, missing containers, health checks and setup delegation.
Provider checks preserve retries/checkpoints while verifying response closure.

## Current browser and performance checks

Following the HUD edits, fresh offline Firefox fixtures using current renderers
passed at 1440 and 390 pixels for both views, plus 320 pixels in light theme for
Interval. Hour cards retain matching chart/row bounds and all twelve five-minute
clocks, with no visible repeated ticker labels. Interval keeps both prices and
movement inside one block, puts the countdown beside the range on desktop, and
has no footer countdown. All checked sizes have no page overflow or clipped card
buttons. Small-phone price type was reduced to preserve spacing, then rechecked.
Fixtures, screenshots and measurement logs are in `/tmp/btc60-consistent-hud/`.

Offline Firefox fixtures load the real styles and Hour card markup with synthetic
values. After CSS cleanup, checks passed at 1440 and 390 pixels in dark theme:
60/15/30/5 row order, 1/4/2/12 cards, matching chart/row bounds, no clipped buttons
or page overflow, and pinned phone labels after horizontal scroll. Desktop chart
width was 1,278 pixels; the phone shared axis was 1,090 pixels inside the 1,200-pixel
timeline. The earlier layout pass also checked 1280 pixels.

Artifacts: `/tmp/btc60-hour-qa/hour.html`, `desktop-cleanup.png`,
`phone-cleanup.png` and their corresponding logs in the same directory.
These temporary fixtures do not exercise live sign-in, providers or order submission.

Price formatting median for 10,000 values: **110.194 → 3.863 ms** (about 28.5×
faster in this local microbenchmark), with equal output strings. Across 30 stable
header ticks, a 1,000-order settled history changed from 30,000 item reads to zero;
duration accessibility-attribute writes changed from 120 to zero. See
[performance details and reproduction](VPS_PERFORMANCE.md#november-14-2026-pre-vps-cleanup).

The static export was regenerated and all nine changed frontend copies match
their sources. Shell syntax, local documentation paths/heading links,
`git diff --check`, and Docker Compose configuration validation passed. Compose validation used `config --quiet`
with the selected `.env`; it neither started containers nor printed credentials.

## Remaining deployment verification

Follow the [VPS handoff](DEPLOYMENT_REVIEW.md#next-vps-update-not-yet-executed):
preserve a backup, validate the VPS configuration and use `--recreate` to apply
the updated source. Container startup, public HTTPS, live sign-in/provider/order
checks and production load remain to be verified there. Sphinx HTML was not
rebuilt; source documentation coverage is included in the passing suite.

---

## Archived regression report: November 13, 2026

**November 13, 2026 — 389 assertion cases passed; zero unresolved failures or skips.**

### Scope and environment

Phase-10, base `62efaea`, with the existing edited worktree plus this runtime and
documentation cleanup. Python 3.14.4 in the project virtual environment, Node.js
24.22.2, Linux; user-facing dates use America/Denver. Providers, accounts and
order data are fixtures or temporary databases. No real database was reset and
no running deployment was restarted.

### Automated results

| Group | Cases | Result | Evidence |
| --- | ---: | --- | --- |
| JavaScript | 188 across 17 files | PASS | `/tmp/btc60-cleanup-frontend-cases.log` |
| Python application | 128 | PASS, no skips | `/tmp/btc60-cleanup-backend-venv.log` |
| Python scripts without socket watchdog | 72 | PASS | `/tmp/btc60-cleanup-scripts-isolated.log` |
| Temporary watchdog lifecycle | 1 | PASS | `/tmp/btc60-cleanup-watchdog.log` |
| **Total** | **389** | **PASS** | Separate isolated runs described below |

JavaScript files ran in separate Node processes with
`--test --test-isolation=none --test-reporter=tap` to count assertions accurately.
The normal `node --test test/frontend/*.test.js` invocation also passed; its
reporter counted 17 files in this environment, rather than 188 assertions.

Application tests ran using:

```bash
PYTHONPATH=src/backend:scripts:test/backend .venv/bin/python -m unittest discover -s test/backend -p '*_test.py'
```

The system-Python baseline skipped Google verification dependencies. Repeating
in `.venv` ran that coverage and passed all 128 cases. Script discovery initially
hit the sandbox's socket restriction in the watchdog fixture; the other 72 cases
were rerun successfully in the sandbox. The single watchdog case passed
separately where loopback sockets were allowed:

```bash
PYTHONPATH=src/backend:scripts:test/scripts .venv/bin/python -m unittest server_control_test.WatchdogTest
```

That fixture copies a tiny dummy server and lifecycle scripts into temporary
storage, substitutes a fake Docker executable and stops only its test processes.
The real deployment is not part of that test. These are composed results from
separate runs, not a claim that one unrestricted full-run command was executed.

Coverage includes the optional signup-code policy, persistent shared IP budgets,
concurrent account capacity, local/VPS setup/reset selection, chart and navigation
behavior, main/direction readiness gates, settlement idempotence, writer-lock
avoidance, and unchanged-DOM/history-index checks.

### Browser and performance evidence

Offline Firefox fixtures used the actual detail renderer, local assets and
synthetic account/market data at 1366, 390 and 320 pixels in both themes. Checks
passed for zero MutationObserver records on unchanged refresh, changed-price
updates, disabled main/direction controls on disconnect, correct Down selection
events, no card content overflow and action heights of at least 44 pixels.
These are fixture checks, not a complete signed-in end-to-end order flow.

Screenshot artifacts in the working environment:
`/tmp/btc60-cleanup-browser-{laptop,phone,small-phone}.png` and the corresponding
`/tmp/btc60-cleanup-browser-light-*.png` files. The fixture source is
`/tmp/btc60-cleanup-browser.html`; artifacts under `/tmp` are temporary.

Chart preparation median: **0.3927 → 0.3185 ms** per interval, about 19% lower,
using 1,440 candles and 3,600 seconds over the four durations. Complete output
objects compared equal; a separate deterministic 1,000-case comparison matched.
Unchanged detail refreshes reduced 45 tracked writes/26 field lookups to zero;
idle settlement writer transactions reduced from one to zero. See
[VPS performance evidence](VPS_PERFORMANCE.md#november-13-2026-runtime-and-local-development-cleanup)
for fixtures, commands and limitations.

### Remaining release verification

Rebuild the Docker image before expecting new source behavior in a deployment.
Confirm its private environment, intended volume, container health and public
HTTPS, then perform controlled live-provider/sign-in/order checks. Production
load, p95 HTTP latency, peak RSS and live Google/provider availability were not
measured in this pass. Sphinx HTML was not rebuilt because Sphinx is absent;
source documentation coverage and generation of 93 reference pages passed, and
28 local guide paths/heading links were checked.

Follow the [test engineer checklist](QA_CHECKLIST.md) and
[setup guide](../deploy/SETUP.md). Preserve backups and use disposable storage for
reset/restore experiments. Older verification below applies only to its own
stated commit, worktree and environment.

---

## Archived regression report: November 12, 2026

**PASS — 333 passed, 0 failed, 0 skipped.**

### Run identification

- Started November 12, 2026 at 8:22:09 PM MST (`America/Denver`, UTC−07:00).
- Command: `.venv/bin/python scripts/run_tests.py` from the repository root.
- Branch: `Phase-10`; base commit: `42b718b`; working tree includes the splash,
  account layouts, circular interval controls, segment odds, and five-second cutoff.
- Linux, Python 3.12.3, Node.js 24.22.1. HTTP tests use temporary databases;
  provider calls are mocked. Google signed-token verification tests are included.

### Suite results

| Suite | Tests | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 178 | 178 | 0 | 0 | 0.44 s |
| Python application | 116 | 116 | 0 | 0 | 9.26 s |
| Python scripts | 39 | 39 | 0 | 0 | 17.99 s |
| **Total** | **333** | **333** | **0** | **0** | **27.68 s** |

Local log: `/tmp/test_results/test_result_2026-11-12_20-22-09_614191.log`.

### Deployment verification

- Removed unused generated background variants and obsolete preview/estimate styles.
  Refreshed `dist/` from the public source allowlist.
- Five-second cutoff assertions cover the browser boundary for all four durations,
  the server hour boundary, and all twelve five-minute intervals.
- Chromium checked welcome, login, signup, and terminal layouts at 1440×900,
  1366×768, 390×844, and 320×720. No horizontal page overflow; interval circles
  remain 72×72 pixels; coin buttons stay within the viewport. Demo opens and closes
  with Escape. These layout checks block external services and use coin fixtures;
  they do not verify live quotes or a real Google account flow.
- `docker compose --env-file deploy/docker.env.example config --quiet` passes.
  Restart/start/stop scripts pass Bash syntax checks.
- Built `p60:deployment-check` (image `a6ae5f60baa8`). An automatically removed,
  unprivileged container passes `/healthz` and serves the updated account pages,
  splash script/styles and both new backgrounds. It uses a read-only filesystem,
  temporary data, no external network, and no published ports.
- No running deployment was restarted. Before a VPS rollout, preserve the current
  database backup, verify that host's private `.env`, then use the normal restart
  script. Confirm public HTTPS, live quote freshness, and sign-in after rollout.

The following sections describe earlier browser/operational checks; they were not
repeated as part of the deployment verification above.

### Compact chart and interaction checks

[Summary browser check log](test-results/2026-11-12_restored-summary.txt).
Earlier [compact-graph and navigation checks](test-results/2026-11-12_compact-graphs.txt)
remain archived.
Playwright/Chromium served the current frontend source with mocked account and
price data. These checks validate rendered layout and interactions, not a real
provider connection or an account order. Repeatable acceptance steps are in the
[test guide](TEST_GUIDE.md#chart-and-view-acceptance-checks).

- Both plots are 180 pixels high at desktop width and 150 pixels high on phones.
  Checked at 1440, 390, and 320 pixels in both themes for Hour and all four
  interval lengths. Restored green up/red down arrows align with completed
  candle centers in a compact 16-pixel summary row. The plots retain their
  reduced heights, and UTC labels follow the summary.
- Past intervals show completed summaries; upcoming intervals stay neutral.
  Current-minute markers advance with the clock. The shared renderer loads
  through bootstrap and is included in the public allowlist and static export.
- Thin alternating red/yellow time dots retain 12-pixel spacing, full-height
  coverage, time-coordinate alignment, and clock movement across both views,
  aligned rows, and wrapped/scrolled card markers. Historical markers remain
  hidden and orange prediction cutoffs keep their dashed appearance.
- Single-click selection stays in Hour. Double-clicking a card opens its exact
  interval; double-clicking Interval returns to the containing hour, including
  browsed past intervals. Hour clears duration/card highlights. Interactive
  action buttons do not invoke the shortcut.

### Documentation and build checks

Sphinx 8.2.3 built with warnings treated as errors:

```bash
python -m sphinx -W --keep-going -b html doc doc/_build/html
```

The build succeeded without warnings, including the generated reference for
the restored summary renderer. Open `doc/_build/html/index.html` locally. Generated HTML
and source-reference files remain ignored by Git. The README, user guide,
design/architecture notes, contribution guide, and acceptance guide describe the
compact layout and remaining chart indicators.

`python3 scripts/build-static.py` regenerated the public frontend export. The
local development image was rebuilt and `http://localhost:18085/healthz` returned
HTTP 200; served chart assets and `dist/` match the current source.

Provider availability, paid feeds, live prediction execution, VPS capacity and
recovery, and prize delivery were not established by this run.
