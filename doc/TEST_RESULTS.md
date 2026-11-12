# Latest regression test results

**PASS — 332 passed, 0 failed, 0 skipped.**

## Run identification

- Started November 12, 2026 at 02:29:40 PM MST (`America/Denver`, UTC−07:00).
- Command: `.venv/bin/python scripts/run_tests.py` from the repository root.
- Branch: `Phase-10`; base commit: `3d69370`; working tree includes the current
  chart, view-selection, local deployment, authentication, and documentation changes.
- Linux, Python 3.14.4, Node.js 24.22.2. HTTP and lifecycle tests use temporary
  databases, mocked providers, and isolated process/container fixtures.

## Suite results

| Suite | Tests | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 177 | 177 | 0 | 0 | 0.19 s |
| Python application | 116 | 116 | 0 | 0 | 4.57 s |
| Python scripts | 39 | 39 | 0 | 0 | 16.05 s |
| **Total** | **332** | **332** | **0** | **0** | **20.81 s** |

[Complete regression log](test-results/2026-11-12_14-29-40.txt), with ANSI colors removed.
Original local log: `/tmp/test_results/test_result_2026-11-12_14-29-40_579213.log`.
Restored summary tests cover exact candle alignment, invalid/missing data,
minute rollover, duration changes, and DOM reuse on price ticks. Expected negative cases produce provider,
health, and reset messages. Python 3.14 also reports resource warnings from
temporary test fixtures; no test failed. Historical logs remain in `doc/test-results/`.

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
