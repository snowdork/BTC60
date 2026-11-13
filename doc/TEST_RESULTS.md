# Latest regression test results

**PASS — 333 passed, 0 failed, 0 skipped.**

## Run identification

- Started November 12, 2026 at 8:22:09 PM MST (`America/Denver`, UTC−07:00).
- Command: `.venv/bin/python scripts/run_tests.py` from the repository root.
- Branch: `Phase-10`; base commit: `42b718b`; working tree includes the splash,
  account layouts, circular interval controls, segment odds, and five-second cutoff.
- Linux, Python 3.12.3, Node.js 24.22.1. HTTP tests use temporary databases;
  provider calls are mocked. Google signed-token verification tests are included.

## Suite results

| Suite | Tests | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 178 | 178 | 0 | 0 | 0.44 s |
| Python application | 116 | 116 | 0 | 0 | 9.26 s |
| Python scripts | 39 | 39 | 0 | 0 | 17.99 s |
| **Total** | **333** | **333** | **0** | **0** | **27.68 s** |

Local log: `/tmp/test_results/test_result_2026-11-12_20-22-09_614191.log`.

## Deployment verification

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

## Compact chart and interaction checks

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

## Documentation and build checks

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
