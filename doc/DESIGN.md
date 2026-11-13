# Predict60 design

## Workspace and visual language

The title bar contains the stacked P60/Predict60 brand, selected coin icon,
current USD price, hourly dollar and percentage change, contest credits,
UTC/local clocks, and **Interval | Hour** controls. Interval is the default and
shows one 5-, 15-, 30-, or 60-minute play. Hour shows one 60-minute card, two
30-minute cards, four 15-minute cards, and twelve 5-minute cards. One-minute
candles are data resolution, not a tradable duration.

The title-bar controls and card-body double-clicks change modes. Double-clicking
an Hour card opens its exact start and duration; double-clicking an Interval card
returns to Hour. A past interval returns to its containing UTC hour. Interactive
buttons/links/form fields do not trigger the shortcut. Entering Hour clears
duration and segment selection highlights. Choosing a duration or segment while in Hour keeps it visible and
prepares the selected interval; selecting Interval then opens it. In Interval,
left/right arrows move by one play and Back to live resumes following. In Hour,
left/right arrows move by one UTC hour and Back to now restores the live hour.

Both graph backgrounds stay black in either theme and across live, completed,
and upcoming states. Hour has a white price line and green/red candles.
Interval's line, grid, and endpoint use the duration palette: 60 purple, 30 blue,
15 pink, and 5 amber. Alternating red/yellow dotted markers show current time;
orange dashed markers show prediction cutoffs 5 seconds before the end. Historical views hide current
time markers. The theme applies to the surrounding controls and cards, not the
black plot background.

The Hour graph and unwrapped duration rows share their left/right bounds. On
phones, 15-minute cards wrap into two rows; 5-minute cards scroll independently.
Those cards use a local time marker rather than projecting a full-hour marker
onto a different scale. Time markers span the full graph or card height. Coin
controls remain pinned above the scrolling playfield.

## Segment layout and refresh

`segment-card.js` supplies the shared card markup. `responsive.css` owns the
final state and viewport layout. Keep new state/viewport rules with their existing section
instead of appending competing overrides.

Cards include UTC range, coin, status, starting and live/closing prices, actual
movement, available model estimates, saved bet amount/execution percentage, and
the relevant action. Hour cards place the coin below the time. Actual movement
is `(current - starting price) / starting price`; it is separate from Up/Down
probabilities. Completed results have an outcome-colored heading arrow only
when both exact settlement benchmarks are available. Missing values remain
placeholders. Live cards use a duration tint, completed cards use a light gray
surface, and upcoming cards use light yellow.

`renderMarkets` rebuilds structural state on market/view changes and preserves
horizontal scroll. `renderChances` reuses indexed nodes and avoids rewriting
unchanged values. Disconnected or paused live quotes clear live comparisons;
completed comparisons retain their exact historical close. Explicit Hour card
selection is kept in the grid's dataset and survives a structural refresh, but
is cleared on entering Hour or changing the displayed instrument/hour.

## Compact charts

`market-model.js` projects valid minute OHLC bars at each minute's midpoint and
closes at minute ends. It merges those closes with observed one-second prices.
The live endpoint uses display time so quote arrival timing does not pull the
line backwards. Missing observations leave gaps; synthetic and incomplete data
do not replace settlement candles.

Both views inherit `--price-chart-height` from the workspace: 180 pixels on
desktop and 150 pixels at widths of 700 pixels or less. The Hour cursor uses
that same height so it spans the entire plot. Time labels sit directly below
the chart and its compact minute summary. Header probability estimates remain
available.

`minute-trend.js` renders a 16-pixel summary row beneath each graph. Its arrows
align with candle midpoints and use the same OHLC validity rules as `minutePlot`.
Completed minutes are green Up when close is at least open, otherwise red Down.
Current minutes use an amber dash; missing/upcoming minutes remain neutral.
The renderer caches candle identity, interval bounds, minute, and historical
state so price ticks reuse the row. Common arrow styles live in `styles.css`;
`responsive.css` aligns the row with the corresponding chart gutters.

The title-bar hourly movement uses the exact close before the UTC hour starts.
Live views compare a valid quote with that benchmark; historical views compare
the selected hour's close. The percentage is `100 * dollar change / opening
benchmark`, displayed with two to four decimals. Quotes refresh the model
immediately; displayed prices coalesce to one-second updates. Missing quotes or
opening benchmarks leave the change unavailable.

## Market state and navigation

Selecting a segment highlights it and updates the ticket without changing views.
Predict opens the review workflow for an available live interval; Result and
Details inspect completed or upcoming intervals. The five-minute row's Now
control scrolls to the current card and Select chooses its duration. Neither
control changes the chart view. Historical navigation preserves the selected
instrument and does not switch modes. Dates distinguish midnight boundaries.
Missing candles leave affected benchmarks or results unavailable.

Crypto is the only active category. Oil and Weather render as non-navigable
**Coming soon** cards. Direct Oil/Weather terminal requests are redirected, and
server-side validation rejects their orders. Oil feed adapters remain available
for diagnostics until a verified feed can support prediction settlement.

The database catalog supplies selectable coins, Coinbase products, precision, icons, and synthetic base prices. The default seed enables BTC, ETH, SOL, XRP, DOGE, ADA, LTC, LINK, AVAX and SUI. Up to ten instruments per category may be enabled. Migration 6 adds/enables the three additions once, preserves saved source mappings and respects existing custom selections. Predictions retain their original coin independently of current selection; account balance is shared across coins.

## Data and readiness

`btc-chart.js` uses Coinbase Exchange public ticker WebSocket updates and REST minute candles. The status strip distinguishes spot freshness, history availability, and order readiness. The browser blocks orders for historical/synthetic views, paused charts, disconnected feeds, source timestamps older than 15 seconds or more than 5 seconds in the future, history errors, missing opening benchmarks, missing quote configuration, and closed intervals.

Demo preview explicitly uses animated synthetic data and cannot save predictions. Pause freezes chart rendering and blocks orders; UTC interval availability continues advancing. Reconnect reloads live data. The backend independently checks the interval, retrieves the benchmark, fetches a fresh Coinbase ticker, and recomputes pricing before accepting an order.

Benchmark reads first search same-product history snapshots for the exact
preceding minute. Cold reads use three attempts at most, with 3-second socket
timeouts and 0.5/1-second delays, widening the start by 0/120/300 seconds while
keeping the same end/target minute. This is bounded recovery, not a hard overall
HTTP deadline. Empty/malformed/truncated responses and transient network errors
retry; HTTP 429 and 5xx retry, while other 4xx errors fail immediately. Only
numeric, finite, positive exact-minute closes are accepted. No nearby minute,
ticker or browser-provided benchmark is substituted. Failed reads are not cached,
and prediction POSTs are not automatically replayed by this recovery path.

## Prediction pane context

The ticket shows a compact UTC-hour bar highlighting the selected interval, time remaining, a spot/source timestamp, distance from the opening benchmark, and explicit Up/Down closing-price thresholds. Selected-side rules receive emphasis. Historical/completed intervals use their closing benchmark; upcoming intervals wait for an opening benchmark. Live comparisons require a connected fresh feed; synthetic context is labeled. This context lives in the ticket and does not add overlays to the hourly graph.

## Estimates and demo pricing

Open-market probabilities use zero expected log return and a normal terminal log-return distribution. Minute variance blends equal weights of EWMA estimates with 10- and 60-minute half-lives, using completed consecutive returns from a trailing 24-hour history. Missing history blocks quotes; a numerical variance floor of 1e-12 prevents division by zero. These initial parameters are candidates for historical validation, not fitted constants.

```text
variance = 0.5 × fastEWMA + 0.5 × slowEWMA
z = log(spot / benchmark) / sqrt(variance × minutes to settlement)
rawUp = NormalCDF(z)
calibratedUp = sigmoid(slope × logit(rawUp) + intercept)  # when available
Up = clamp(round(100 × probability), 1, 99)
Down = 100 − Up
```

The first second responds to live price movement. The 5-second betting cutoff does not change time to settlement. Ties resolve Up. Upcoming cards hide probabilities; completed cards show confirmed 100/0 outcomes. Quotes remain simulated prices, not exchange order-book prices.

The server caches 24 hours of Coinbase candles per product per minute. Cold loads fetch six batches with three concurrent requests and eight-second request timeouts; subsequent minutes fetch only the missing delta from a recent snapshot. Each batch stays below Coinbase's 300-candle request limit. The browser uses this history alongside its chart history. Python and JavaScript implement equivalent algorithms, with parity tests. Execution recalculates using authoritative live prices, so a displayed quote can move before confirmation.

Run `python3 scripts/calibrate-odds.py BTC candles.json` using chronological Coinbase-format minute candles (`[timestamp, low, high, open, close, volume]`, timestamp in seconds). The fitter samples each 15/30/60-minute window at its midpoint, derives labels from the actual settlement rule, and uses the first 70% of time for calibration fitting and the remainder for validation. Whole-hour splits prevent outcomes crossing the split. It requires at least 500 fitting and 200 validation windows and exports only when both held-out Brier score and log loss improve. The artifact records metrics and time bounds in `data/odds-calibration.json`; `/api/coins` distributes coefficients to the browser. Reload the terminal after calibration changes. Midpoint validation does not establish accuracy at every time remaining; validate more granular observations before extending claims.

Without a validated artifact for a coin, the normal-CDF model remains explicitly uncalibrated. Historical outcomes have not been supplied with this repository. Do not fabricate calibration coefficients or claim measured accuracy improvements. Keep a subsequent untouched period for independent evaluation after model selection.

## Review and execution

Users select a side and a budget of at least $1 within their available demo balance. Fractional shares use the full budget; fees are zero. Stakes with sub-cent precision round up to the next cent. Winning payouts use integer arithmetic to round up to the next cent: `(cost_cents * 100 + price_cents - 1) // price_cents`. A winning contract returns $1 and a losing contract returns $0. Potential profit is winning return minus cost.

Review remains live as spot, benchmark, and model prices change. It shows contract price, count, cost, potential return, profit, and interval countdown. Confirmation authorizes execution at the server's current model price within the selected budget. The server does not enforce the browser quote or benchmark, and there is no 2¢ tolerance. Final quantity and return can differ from review. Expired intervals, unavailable authoritative data, and insufficient balance prevent saving.

The server validates coin availability, side, request ID, budget, and current UTC start. It computes the authoritative opening benchmark, spot, model price, fractional share count, and cost. A transaction atomically debits funds and inserts the prediction. Per-account unique request IDs make retries idempotent. Saved terms remain fixed after execution.

## Settlement and portfolio

The opening proxy is the close of the minute candle immediately before the interval start; the closing proxy is the close immediately before its end. This is not a 60-second average. Closing price greater than or equal to opening resolves Up; a lower close resolves Down. There is no tie band. All durations use this demo rule; no official Kalshi or CF Benchmarks settlement is claimed.

A worker checks due predictions every 30 seconds. Visible signed-in pages request settlement every 15 seconds and on focus/visibility changes; these requests process only that account. Missing history leaves orders awaiting settlement for retry, including after restart. Settlement insertion and winning credits are atomic and idempotent.

The terminal lists unsettled predictions with countdowns and marks account wagers on market cards. Portfolio history includes pending, awaiting settlement, wins, and losses. Realized profit/loss includes settled returns minus their costs; pending costs are shown separately. Win rate counts settled predictions only.

## Architecture and storage

| Component | Responsibility |
| --- | --- |
| `bootstrap.js`, `coins.js` | Catalog loading, coin controls, startup errors |
| `market-model.js` | Pure quote, estimate, volatility, readiness, and minute-plot logic |
| `market-detail.js` | Explicit view controls, interval selection, and range-history loading |
| `minute-trend.js` | Shared candle-aligned summary arrows with cached DOM updates |
| `segment-card.js` | Shared interval cards and observed price-movement labels |
| `app.js` | Market selection, ticket, live review, wager displays |
| `btc-chart.js` | Feed, candle history, chart, UTC market lifecycle |
| `account.js`, `auth.js`, `password.js` | Session/account API, authentication UI, and password changes |
| `portfolio.js`, `portfolio-model.js` | Account history, filters, summary calculations |
| `theme.js`, shared CSS | Persisted theme and responsive presentation |
| `src/backend/server.py` | Static serving, catalog/account API, orders, settlements |
| `scripts/database.py` | Explicit initialization, status, backup, reset |

SQLite stores users, hashed sessions, predictions, settlements, coins, and migration versions. Each player receives 1,000 contest credits per hour, with a fresh balance at each GMT hour boundary independently of prior settlements. Passwords use salted scrypt; sessions use HttpOnly/SameSite cookies and CSRF tokens. Account data persists across browser sessions and server restarts. Local storage holds presentation preferences rather than balances or saved orders.

Authenticated `POST /api/change-password` requires the session CSRF token and
`currentPassword`, `newPassword`, and `confirmPassword` fields. It verifies the
current password (8–128 characters), validates the new password (8–16 characters)
and confirmation, then atomically replaces the salted scrypt hash and revokes
all other sessions. Login, signup, and password changes share a per-client-IP
limit of 20 attempts per minute. Password recovery remains unavailable.

Account requests carry a local generation counter so responses started before
a completed logout cannot restore signed-in state. Logout treats an already
expired session as success, clears account and contest-wallet state, and returns
to the welcome page. Settlement requests pause while logout is in progress.

UI/chart updates run once per second; incoming prices update the model immediately. The controller caches controls, delegates market selection, and avoids rebuilding unchanged rows and totals. Volatility is cached until candles change or a minute closes. Hidden tabs skip rendering and account polling. Static text assets support gzip and ETag revalidation; account/API responses are uncached.

The local server is a demo development service. Production hosting needs HTTPS, a production server, Secure cookies, and account recovery/email verification. See [README.md](../README.md) for development and [the maintenance guide](DATABASE_MAINTENANCE.md) for database operations.

Historical downloads use `scripts/download-odds-history.py` with progress and atomic per-batch checkpoints. The fitter uses damped Newton optimization (at most 80 iterations), reports each preparation stage, and preserves existing coefficients on unsuccessful validation. Network failures stop with a resumable checkpoint instead of silently waiting indefinitely.
